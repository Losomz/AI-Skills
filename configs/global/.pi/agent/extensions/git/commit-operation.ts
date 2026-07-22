import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../subagent/agents.js";
import type {
	AgentProcessOptions,
	AgentProcessResult,
	AgentProcessUpdate,
} from "../subagent/agent-runner.js";

const COMMIT_AGENT = "General";
const COMMIT_WIDGET_KEY = "git-commit";
const CORE_STANDARD_PLACEHOLDER = "{{CORE_STANDARD}}";
const DEFAULT_CORE_STANDARD = "无额外要求，请根据实际改动决定提交范围并生成提交信息。";

export interface CommitOperationDependencies {
	discoverAgents: (cwd: string) => AgentConfig[];
	findAgentByName: (agents: AgentConfig[], name: string) => AgentConfig | undefined;
	runAgentProcess: (options: AgentProcessOptions) => Promise<AgentProcessResult>;
	validateAgentProfile?: (profile: AgentConfig, ctx: ExtensionContext) => string | undefined;
	loadPromptTemplate?: () => string | Promise<string>;
	writeHeadless?: (message: string) => void;
}

interface ActiveCommitRun {
	token: symbol;
	agent: string;
	startedAt: number;
	pid?: number;
	timer?: NodeJS.Timeout;
}

interface CommitOutcome {
	status: "completed" | "failed" | "aborted";
	output: string;
	startedAt: number;
	endedAt: number;
	pid?: number;
	exitCode?: number;
}

let activeCommitRun: ActiveCommitRun | undefined;

function writeHeadlessDefault(message: string): void {
	process.stderr.write(`${message}\n`);
}

function readPromptTemplate(): string {
	const extensionDir = path.dirname(fileURLToPath(import.meta.url));
	return fs.readFileSync(path.join(extensionDir, "prompts", "commit.md"), "utf8");
}

export function buildCommitTask(coreStandard: string, promptTemplate: string): string {
	if (!promptTemplate.includes(CORE_STANDARD_PLACEHOLDER)) {
		throw new Error(`Git commit 提示词缺少 ${CORE_STANDARD_PLACEHOLDER} 占位符`);
	}
	const requirement = coreStandard.trim() || DEFAULT_CORE_STANDARD;
	return promptTemplate.trim().replaceAll(CORE_STANDARD_PLACEHOLDER, requirement);
}

function formatDuration(durationMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function firstOutputLine(output: string): string {
	return output
		.trim()
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find(Boolean) ?? "(no output)";
}

/**
 * Extract the structured commit brief the background commit agent is asked to
 * return at the end of its run. Falls back to the first useful output line
 * when the agent did not follow the requested `提交：...\n状态：...` shape.
 */
export function extractCommitBrief(output: string): string {
	const lines = output.replace(/\r\n/g, "\n").split("\n");
	let startIndex = -1;
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i].trim().startsWith("提交：")) {
			startIndex = i;
			break;
		}
	}
	if (startIndex === -1) return firstOutputLine(output);

	const brief: string[] = [];
	for (let i = startIndex; i < lines.length; i++) {
		const line = lines[i].trimEnd();
		brief.push(line);
		if (line.trim().startsWith("状态：")) break;
	}
	const text = brief.join("\n").trim();
	return text || firstOutputLine(output);
}

function setCommitWidget(ctx: ExtensionContext, run: ActiveCommitRun | undefined): void {
	if (!ctx.hasUI) return;
	try {
		if (!run) {
			ctx.ui.setWidget(COMMIT_WIDGET_KEY, undefined);
			return;
		}
		const pid = run.pid === undefined ? "启动中" : String(run.pid);
		const elapsed = formatDuration(Date.now() - run.startedAt);
		ctx.ui.setWidget(
			COMMIT_WIDGET_KEY,
			[`Git 提交中 · ${run.agent} · PID ${pid} · ${elapsed}`],
			{ placement: "aboveEditor" },
		);
	} catch {
		// UI teardown must not affect the background process.
	}
}

function notifyOrLog(ctx: ExtensionContext, writeHeadless: (message: string) => void, message: string, level: "info" | "error"): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
	else writeHeadless(message);
}

async function resolveCoreStandard(ctx: ExtensionContext, inlineValue: string): Promise<string | undefined> {
	const value = inlineValue.trim();
	if (value) return value;
	if (!ctx.hasUI) return "";
	const input = await ctx.ui.input(
		"本次提交的核心要求（可留空）",
		"例如：只提交 blog 配置、提交信息强调修复菜单描述等",
	);
	return input?.trim();
}

function toOutcome(result: AgentProcessResult, fallback: ActiveCommitRun): CommitOutcome {
	const status = result.status === "aborted"
		? "aborted"
		: result.failed || result.status === "failed"
			? "failed"
			: "completed";
	return {
		status,
		output: result.output || result.errorMessage || result.stderr || "(no output)",
		startedAt: result.startedAt ?? fallback.startedAt,
		endedAt: result.endedAt ?? Date.now(),
		pid: result.pid ?? fallback.pid,
		exitCode: result.exitCode,
	};
}

function failureOutcome(error: unknown, run: ActiveCommitRun): CommitOutcome {
	return {
		status: "failed",
		output: error instanceof Error ? error.message : String(error),
		startedAt: run.startedAt,
		endedAt: Date.now(),
		pid: run.pid,
		exitCode: 1,
	};
}

function formatOutcome(outcome: CommitOutcome): string {
	if (outcome.status === "completed") {
		const pid = outcome.pid === undefined ? "" : ` · PID ${outcome.pid}`;
		const elapsed = ` · ${formatDuration(outcome.endedAt - outcome.startedAt)}`;
		return `Git commit 已完成${pid}${elapsed}\n${extractCommitBrief(outcome.output)}`;
	}
	const pid = outcome.pid === undefined ? "" : `，PID ${outcome.pid}`;
	const elapsed = `，耗时 ${formatDuration(outcome.endedAt - outcome.startedAt)}`;
	const summary = firstOutputLine(outcome.output);
	if (outcome.status === "aborted") return `Git commit 已取消${pid}${elapsed}：${summary}`;
	return `Git commit 失败（退出码 ${outcome.exitCode ?? "unknown"}${pid}）${elapsed}：${summary}`;
}

function clearActiveRun(ctx: ExtensionContext, run: ActiveCommitRun): boolean {
	if (activeCommitRun?.token !== run.token) return false;
	if (run.timer) clearInterval(run.timer);
	activeCommitRun = undefined;
	setCommitWidget(ctx, undefined);
	return true;
}

function reportOutcome(ctx: ExtensionContext, writeHeadless: (message: string) => void, outcome: CommitOutcome): void {
	const message = formatOutcome(outcome);
	if (!ctx.hasUI) {
		writeHeadless(message);
		if (outcome.status === "failed") writeHeadless(outcome.output);
		return;
	}
	ctx.ui.notify(message, outcome.status === "failed" ? "error" : "info");
	if (outcome.status === "failed") writeHeadless(`${message}\n${outcome.output}`);
}

export function createCommitOperation(dependencies: CommitOperationDependencies) {
	const writeHeadless = dependencies.writeHeadless ?? writeHeadlessDefault;

	return {
		value: "commit",
		order: 1,
		label: "commit",
		description: "后台使用 General 完成提交和推送",

		async handle(_pi: ExtensionAPI, ctx: ExtensionContext, args = ""): Promise<void> {
			if (activeCommitRun) {
				const pid = activeCommitRun.pid === undefined ? "" : `，PID ${activeCommitRun.pid}`;
				const elapsed = formatDuration(Date.now() - activeCommitRun.startedAt);
				notifyOrLog(
					ctx,
					writeHeadless,
					`已有 Git commit 后台任务运行中：${activeCommitRun.agent}${pid}，已运行 ${elapsed}`,
					"info",
				);
				return;
			}

			let profile: AgentConfig | undefined;
			try {
				const agents = dependencies.discoverAgents(ctx.cwd);
				profile = dependencies.findAgentByName(agents, COMMIT_AGENT);
			} catch (error) {
				notifyOrLog(ctx, writeHeadless, `Git commit 启动失败：${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}
			if (!profile) {
				notifyOrLog(ctx, writeHeadless, `Git commit 启动失败：未找到 ${COMMIT_AGENT} profile。`, "error");
				return;
			}
			const profileError = dependencies.validateAgentProfile?.(profile, ctx);
			if (profileError) {
				notifyOrLog(ctx, writeHeadless, `Git commit 启动失败：${profileError}`, "error");
				return;
			}

			const coreStandard = await resolveCoreStandard(ctx, args);
			if (coreStandard === undefined) {
				notifyOrLog(ctx, writeHeadless, "Git commit 已取消。", "info");
				return;
			}

			let task: string;
			try {
				const template = await (dependencies.loadPromptTemplate?.() ?? readPromptTemplate());
				task = buildCommitTask(coreStandard, template);
			} catch (error) {
				notifyOrLog(ctx, writeHeadless, `Git commit 启动失败：${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}

			const run: ActiveCommitRun = {
				token: Symbol("git-commit-run"),
				agent: profile.name,
				startedAt: Date.now(),
			};
			activeCommitRun = run;
			const refreshWidget = (): void => {
				if (activeCommitRun?.token === run.token) setCommitWidget(ctx, run);
			};
			if (ctx.hasUI) {
				run.timer = setInterval(refreshWidget, 1000);
				run.timer.unref?.();
				refreshWidget();
			} else {
				writeHeadless(`Git commit 已启动 · ${profile.name}`);
			}

			let runPromise: Promise<AgentProcessResult>;
			try {
				runPromise = dependencies.runAgentProcess({
					profile,
					task,
					cwd: ctx.cwd,
					onUpdate: (update: AgentProcessUpdate) => {
						if (activeCommitRun?.token !== run.token) return;
						run.pid = update.pid ?? run.pid;
						run.startedAt = update.startedAt;
						refreshWidget();
					},
				});
			} catch (error) {
				const outcome = failureOutcome(error, run);
				if (clearActiveRun(ctx, run)) reportOutcome(ctx, writeHeadless, outcome);
				return;
			}

			void runPromise
				.then((result) => toOutcome(result, run), (error) => failureOutcome(error, run))
				.then((outcome) => {
					if (clearActiveRun(ctx, run)) reportOutcome(ctx, writeHeadless, outcome);
				})
				.catch((error) => {
					clearActiveRun(ctx, run);
					writeHeadless(`Git commit 后台结果处理失败：${error instanceof Error ? error.message : String(error)}`);
				});
		},
	};
}

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const DEFAULT_COMMIT_AGENT = "General";
const COMMIT_STATUS_KEY = "git-commit";
const COMMIT_WIDGET_KEY = "git-commit-isolated-process";
export const GIT_COMMIT_RUN_ENTRY_TYPE = "git-commit-isolated-run";

export type CommitAgentRunStatus = "pending" | "running" | "completed" | "failed" | "aborted";

export interface CommitAgentRunUpdate {
	agent: string;
	status: CommitAgentRunStatus;
	pid?: number;
	model?: string;
	startedAt?: number;
	endedAt?: number;
}

export interface CommitAgentRunOptions {
	agent: string;
	task: string;
	agentScope: "project";
	cwd: string;
	onUpdate?: (update: CommitAgentRunUpdate) => void;
}

export interface CommitAgentRunResult {
	agent: string;
	exitCode: number;
	output: string;
	stderr: string;
	failed: boolean;
	pid?: number;
	status?: CommitAgentRunStatus;
	model?: string;
	startedAt?: number;
	endedAt?: number;
	stopReason?: string;
	errorMessage?: string;
}

export type GitCommitRunStatus = "starting" | "running" | "completed" | "failed" | "cancelled";

export interface GitCommitRunEntryData {
	version: 1;
	status: GitCommitRunStatus;
	agent: string;
	cwd: string;
	output: string;
	pid?: number;
	model?: string;
	exitCode?: number;
	startedAt?: number;
	endedAt: number;
	durationMs?: number;
	errorMessage?: string;
}

export interface GitCommitRunView {
	background: "toolPendingBg" | "toolSuccessBg" | "toolErrorBg";
	icon: string;
	iconColor: "success" | "error" | "warning";
	title: string;
	isolationLabel: string;
	metadata: string;
	cwd: string;
	output: string;
	outputPreview: string;
	outputTruncated: boolean;
	errorMessage?: string;
}

export interface CommitOperationDependencies {
	discoverAgents: (cwd: string) => Array<{ name: string }>;
	runAgent: (ctx: ExtensionContext, options: CommitAgentRunOptions) => Promise<CommitAgentRunResult>;
	createWidget?: (data: GitCommitRunEntryData) => unknown;
	writeHeadless?: (message: string) => void;
}

export interface CommitOperationArgs {
	agent?: string;
	extraInstructions?: string;
}

function chooseCommitAgent(requestedAgent?: string): string {
	return requestedAgent || DEFAULT_COMMIT_AGENT;
}

function writeHeadlessDefault(message: string): void {
	process.stderr.write(`${message}\n`);
}

function formatDuration(durationMs: number | undefined): string | undefined {
	if (durationMs === undefined) return undefined;
	const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function getDurationMs(data: GitCommitRunEntryData): number | undefined {
	if (data.durationMs !== undefined) return data.durationMs;
	if (data.startedAt !== undefined) return Math.max(0, data.endedAt - data.startedAt);
	return undefined;
}

function statusIcon(status: GitCommitRunStatus): string {
	switch (status) {
		case "starting":
			return "…";
		case "running":
			return "⏳";
		case "completed":
			return "✓";
		case "failed":
			return "✗";
		case "cancelled":
			return "■";
	}
}

function statusLabel(status: GitCommitRunStatus): string {
	switch (status) {
		case "starting":
			return "starting";
		case "running":
			return "running";
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		case "cancelled":
			return "cancelled";
	}
}

function getBackground(status: GitCommitRunStatus): "toolPendingBg" | "toolSuccessBg" | "toolErrorBg" {
	if (status === "completed") return "toolSuccessBg";
	if (status === "failed") return "toolErrorBg";
	return "toolPendingBg";
}

function getOutputPreview(output: string, maxLines = 3): { text: string; truncated: boolean } {
	const normalized = output.trim() || "(no output)";
	const lines = normalized.split(/\r?\n/);
	return {
		text: lines.slice(0, maxLines).join("\n"),
		truncated: lines.length > maxLines,
	};
}
export function buildCommitRunView(data: GitCommitRunEntryData): GitCommitRunView {
	const duration = formatDuration(getDurationMs(data));
	const metadata = [
		`agent:${data.agent}`,
		`status:${statusLabel(data.status)}`,
		data.pid ? `pid:${data.pid}` : undefined,
		duration ? `duration:${duration}` : undefined,
		data.model ? `model:${data.model}` : undefined,
		data.exitCode !== undefined ? `exit:${data.exitCode}` : undefined,
	].filter((item): item is string => Boolean(item));
	const preview = getOutputPreview(data.output);
	return {
		background: getBackground(data.status),
		icon: statusIcon(data.status),
		iconColor: data.status === "completed" ? "success" : data.status === "failed" ? "error" : "warning",
		title: "git commit",
		isolationLabel: "独立 Pi 主 agent · 不进入父上下文",
		metadata: metadata.join("  "),
		cwd: data.cwd,
		output: data.output.trim() || "(no output)",
		outputPreview: preview.text,
		outputTruncated: preview.truncated,
		errorMessage: data.errorMessage,
	};
}

function setCommitWidget(
	ctx: ExtensionContext,
	data: GitCommitRunEntryData | undefined,
	createWidget: CommitOperationDependencies["createWidget"],
): void {
	if (!ctx.hasUI) return;
	if (!data) {
		ctx.ui.setWidget(COMMIT_WIDGET_KEY, undefined);
		return;
	}
	const view = buildCommitRunView(data);
	const content = createWidget?.(data) ?? [
		`${view.icon} ${view.title}`,
		view.isolationLabel,
		view.metadata,
		view.outputPreview,
	];
	ctx.ui.setWidget(COMMIT_WIDGET_KEY, content as any, {
		placement: "aboveEditor",
	});
}

function setCommitStatus(ctx: ExtensionContext, status: string | undefined): void {
	if (ctx.hasUI) ctx.ui.setStatus(COMMIT_STATUS_KEY, status);
}

function formatHeadlessRecord(data: GitCommitRunEntryData): string {
	const pid = data.pid ? `，PID ${data.pid}` : "";
	if (data.status === "completed") return `Git commit 独立进程已完成${pid}：\n${data.output}`;
	if (data.status === "cancelled") return `Git commit 独立进程已取消${pid}：\n${data.output}`;
	return `Git commit 独立进程失败（退出码 ${data.exitCode ?? "unknown"}${pid}）：\n${data.output}`;
}

function reportCommitRecord(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	writeHeadless: (message: string) => void,
	data: GitCommitRunEntryData,
	createWidget: CommitOperationDependencies["createWidget"],
): void {
	if (!ctx.hasUI) {
		writeHeadless(formatHeadlessRecord(data));
		return;
	}

	try {
		pi.appendEntry<GitCommitRunEntryData>(GIT_COMMIT_RUN_ENTRY_TYPE, data);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		setCommitWidget(
			ctx,
			{
				...data,
				output: `${data.output}\n\n[结果记录写入失败：${message}]`,
			},
			createWidget,
		);
		writeHeadless(`Git commit 结果记录写入失败：${message}`);
	}
}

function isCancelledRun(result: CommitAgentRunResult): boolean {
	return result.status === "aborted" || result.stopReason === "aborted";
}

function isCancellationError(error: unknown): boolean {
	if (error instanceof Error && error.name === "AbortError") return true;
	const message = error instanceof Error ? error.message : String(error);
	return /\b(abort(?:ed)?|cancel(?:led)?)\b/i.test(message);
}

function createTerminalRecord(
	result: CommitAgentRunResult,
	fallback: CommitAgentRunUpdate,
	cwd: string,
	endedAt: number,
): GitCommitRunEntryData {
	const status: GitCommitRunStatus = isCancelledRun(result) ? "cancelled" : result.failed ? "failed" : "completed";
	const startedAt = result.startedAt ?? fallback.startedAt;
	return {
		version: 1,
		status,
		agent: result.agent || fallback.agent,
		cwd,
		output: result.output,
		pid: result.pid ?? fallback.pid,
		model: result.model ?? fallback.model,
		exitCode: result.exitCode,
		startedAt,
		endedAt: result.endedAt ?? endedAt,
		durationMs: startedAt === undefined ? undefined : Math.max(0, (result.endedAt ?? endedAt) - startedAt),
		errorMessage: result.errorMessage,
	};
}

async function promptCommitCoreStandard(ctx: ExtensionContext, extraInstructions: string): Promise<string | undefined> {
	const trimmed = extraInstructions.trim();
	if (trimmed) return trimmed;
	if (!ctx.hasUI) return "";

	const input = await ctx.ui.input(
		"本次提交的核心要求（可留空）",
		"例如：只提交 blog 配置、提交信息强调修复菜单描述等",
	);
	if (input === undefined) return undefined;
	return input.trim();
}

export function buildCommitTask(coreStandard: string): string {
	const extraBlock = coreStandard
		? `\n\n## 用户核心标准\n\n请以以下内容作为本次提交分析、改动取舍和提交信息生成的核心标准：\n\n${coreStandard}`
		: "";

	return `你是独立 Pi 进程中的主 agent，请在这个进程内完整完成 Git 提交和推送。

## 子仓库优先原则

**必须先完成所有子仓库的提交，再提交主仓库。** 这是因为主仓库需要记录子仓库的最新 commit 引用。

### 子仓库发现

1. 先执行 \`git submodule status\` 检查是否有 git submodule。
2. 再执行 \`git rev-parse --show-toplevel\` 确认当前主仓库根目录。
3. 然后通过 \`find . -name '.git' -type f -o -name '.git' -type d\` 扫描所有嵌套的独立 git 仓库（排除主仓库自己的 \`.git\` 和 submodule 的 \`.git\` 文件）。
4. 将发现的所有子仓库（submodule + 嵌套 git repo）汇总为待处理列表。

### 提交顺序

对每个子仓库（按路径深度从深到浅排序，确保子目录先处理）：
1. \`cd\` 到子仓库目录。
2. 执行 \`git status --short\` 检查是否有改动，无改动则跳过。
3. 执行 \`git diff --cached\` 和 \`git diff\` 分析改动。
4. 根据改动生成提交信息（格式见下方）。
5. 执行 \`git add -A\` 暂存改动。
6. 执行 \`git commit -m "提交信息"\` 提交。
7. 执行 \`git push\` 推送。
8. 记录该子仓库的提交结果（路径、提交信息）。

### 主仓库提交

所有子仓库处理完毕后：
1. 回到主仓库根目录。
2. 执行 \`git status --short\` 检查改动（此时应包含子仓库引用更新）。
3. 如果没有可提交内容，停止并说明原因。
4. 执行 \`git diff --cached\` 和 \`git diff\` 分析改动。
5. 根据实际改动生成合适的提交信息。
6. 执行 \`git add -A\` 暂存所有改动（包括子仓库引用更新）。
7. 执行 \`git commit -m "提交信息"\` 提交。
8. 执行 \`git push\` 推送。

## 执行要求

- 如果发生冲突、提交失败或推送失败，请停止并说明原因，不要让父 agent 代替执行。
- 汇总报告时，先列出所有子仓库的提交结果，再列出主仓库的提交结果。
- 如果子仓库全部无改动而主仓库有改动，直接提交主仓库即可。

## 提交信息格式要求

使用中文编写提交信息，格式：\`{emoji} type(scope): description\`

- 按照 gitmoji 规范 + 约定式提交（Conventional Commits）规范
- 例如：\`✨ feat(extensions): 添加 git 提交命令\`
- 主题开头选择合适的 emoji
- type 选择合适的类型（feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert）
- scope 使用受影响的模块或功能名，不明确可省略
- description 用中文说明"为什么"做这个改动
- 主题行长度控制在 72 个字符以内

## 边界

父 Pi 会话中的主 agent 不参与 git 检查、diff 分析、提交信息生成或执行。
所有 git 操作都必须由你作为当前独立 Pi 进程的主 agent 完成。${extraBlock}`;
}

export function createCommitOperation(dependencies: CommitOperationDependencies) {
	const writeHeadless = dependencies.writeHeadless ?? writeHeadlessDefault;

	return {
		value: "commit",
		order: 1,
		label: "commit",
		description: "在独立 Pi 进程中完成提交和推送",

		async handle(
			pi: ExtensionAPI,
			ctx: ExtensionContext,
			parsed?: CommitOperationArgs,
		): Promise<void> {
			const invokedAt = Date.now();
			const agentName = chooseCommitAgent(parsed?.agent);
			const coreStandard = await promptCommitCoreStandard(ctx, parsed?.extraInstructions ?? "");
			if (coreStandard === undefined) {
				const endedAt = Date.now();
				reportCommitRecord(pi, ctx, writeHeadless, {
					version: 1,
					status: "cancelled",
					agent: agentName,
					cwd: ctx.cwd,
					output: "用户取消，未启动独立 Pi 进程。",
					startedAt: invokedAt,
					endedAt,
					durationMs: Math.max(0, endedAt - invokedAt),
				}, dependencies.createWidget);
				return;
			}

			const commitTask = buildCommitTask(coreStandard);
			let latestUpdate: CommitAgentRunUpdate = {
				agent: agentName,
				status: "pending",
				startedAt: Date.now(),
			};
			const showRunningState = (update: CommitAgentRunUpdate): void => {
				latestUpdate = { ...latestUpdate, ...update };
				const now = Date.now();
				setCommitWidget(ctx, {
					version: 1,
					status: latestUpdate.status === "pending" ? "starting" : "running",
					agent: latestUpdate.agent,
					cwd: ctx.cwd,
					output: "独立 Pi 进程正在执行 Git commit…",
					pid: latestUpdate.pid,
					model: latestUpdate.model,
					startedAt: latestUpdate.startedAt,
					endedAt: now,
					durationMs: latestUpdate.startedAt === undefined ? undefined : Math.max(0, now - latestUpdate.startedAt),
				}, dependencies.createWidget);
				const pid = latestUpdate.pid ? ` · pid=${latestUpdate.pid}` : "";
				setCommitStatus(ctx, `Git 独立进程: ${latestUpdate.agent}${pid}`);
			};
			showRunningState(latestUpdate);
			if (!ctx.hasUI) writeHeadless(`正在由独立 Pi 进程的主 agent 执行 Git commit（${agentName}）...`);

			let record: GitCommitRunEntryData;
			try {
				const result = await dependencies.runAgent(ctx, {
					agent: agentName,
					task: commitTask,
					agentScope: "project",
					cwd: ctx.cwd,
					onUpdate: showRunningState,
				});
				record = createTerminalRecord(result, latestUpdate, ctx.cwd, Date.now());
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const endedAt = Date.now();
				const startedAt = latestUpdate.startedAt ?? invokedAt;
				record = {
					version: 1,
					status: isCancellationError(error) ? "cancelled" : "failed",
					agent: latestUpdate.agent,
					cwd: ctx.cwd,
					output: message,
					pid: latestUpdate.pid,
					model: latestUpdate.model,
					startedAt,
					endedAt,
					durationMs: Math.max(0, endedAt - startedAt),
					errorMessage: message,
				};
			} finally {
				setCommitWidget(ctx, undefined, dependencies.createWidget);
				setCommitStatus(ctx, undefined);
			}
			reportCommitRecord(pi, ctx, writeHeadless, record, dependencies.createWidget);
		},

		getCompletions(prefix: string) {
			const parts = prefix.trim().split(/\s+/).filter(Boolean);
			const agentPrefix = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
			const items = dependencies.discoverAgents(process.cwd()).map((agent) => ({
				value: `commit ${agent.name}`,
				label: agent.name,
				description: `使用 ${agent.name} 独立 Pi 主 agent 执行提交`,
			}));
			const filtered = items.filter((item) => item.label.toLowerCase().startsWith(agentPrefix));
			return filtered.length > 0 ? filtered : null;
		},
	};
}

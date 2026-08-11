/**
 * Blog Extension
 *
 * Discovers file-based blog workflows and delegates execution to subagents.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

type BlogWorkflow = {
	name: string;
	description: string;
	aliases: string[];
	agent: string;
	preCommit: boolean;
	preCommitAgent: string;
	confirmDirtyWorktree: boolean;
	body: string;
	filePath: string;
};

const DEFAULT_BLOG_AGENT = "General";
const DEFAULT_PRE_COMMIT_AGENT = "General";

function extensionDir(): string {
	return path.dirname(fileURLToPath(import.meta.url));
}

function workflowsDir(): string {
	return path.join(extensionDir(), "workflows");
}

function commonDir(): string {
	return path.join(extensionDir(), "common");
}

function toStringValue(value: unknown): string | undefined {
	if (value == null) return undefined;
	if (typeof value === "string") return value;
	return String(value);
}

function splitList(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map((item) => String(item).trim()).filter(Boolean);
	}

	const text = toStringValue(value);
	if (!text) return [];

	return text
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function parseBoolean(value: unknown, defaultValue: boolean): boolean {
	if (value == null) return defaultValue;
	if (typeof value === "boolean") return value;

	const normalized = String(value).trim().toLowerCase();
	if (!normalized) return defaultValue;
	if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
	if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
	return defaultValue;
}

function normalizeKey(value: string): string {
	return value.trim().toLowerCase();
}

function loadWorkflowFile(filePath: string): BlogWorkflow | null {
	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}

	const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
	const rawName = toStringValue(frontmatter.name);
	const name = (rawName || path.basename(filePath, ".md")).trim();
	if (!name) return null;

	return {
		name,
		description: toStringValue(frontmatter.description) || name,
		aliases: splitList(frontmatter.aliases),
		agent: toStringValue(frontmatter.agent) || DEFAULT_BLOG_AGENT,
		preCommit: parseBoolean(frontmatter.preCommit, true),
		preCommitAgent: toStringValue(frontmatter.preCommitAgent) || DEFAULT_PRE_COMMIT_AGENT,
		confirmDirtyWorktree: parseBoolean(frontmatter.confirmDirtyWorktree, false),
		body: body.trim(),
		filePath,
	};
}

function discoverWorkflows(): BlogWorkflow[] {
	const dir = workflowsDir();
	if (!fs.existsSync(dir)) return [];

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	const workflows: BlogWorkflow[] = [];
	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const workflow = loadWorkflowFile(path.join(dir, entry.name));
		if (workflow) workflows.push(workflow);
	}

	return workflows.sort((a, b) => a.name.localeCompare(b.name));
}

function findWorkflow(workflows: BlogWorkflow[], value: string): BlogWorkflow | undefined {
	const key = normalizeKey(value);
	// Match name first to avoid an earlier workflow's alias shadowing a later workflow's name
	const byName = workflows.find((workflow) => normalizeKey(workflow.name) === key);
	if (byName) return byName;
	return workflows.find((workflow) => workflow.aliases.some((alias) => normalizeKey(alias) === key));
}

function formatWorkflowOption(workflow: BlogWorkflow): string {
	return `${workflow.name} — ${workflow.description}`;
}

function findWorkflowByOption(workflows: BlogWorkflow[], option: string): BlogWorkflow | undefined {
	return workflows.find((workflow) => option === workflow.name || option === formatWorkflowOption(workflow));
}

function parseArgs(args: string, workflows: BlogWorkflow[]): { workflow?: BlogWorkflow; extraInstructions: string; unknown?: string } {
	const trimmed = args.trim();
	if (!trimmed) return { extraInstructions: "" };

	const [first = "", ...rest] = trimmed.split(/\s+/);
	const workflow = findWorkflow(workflows, first);
	if (!workflow) return { extraInstructions: rest.join(" "), unknown: first };

	return { workflow, extraInstructions: rest.join(" ") };
}

function readPreCommitPrompt(): string | null {
	const filePath = path.join(commonDir(), "pre-commit.md");
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		const { body } = parseFrontmatter<Record<string, unknown>>(content);
		return body.trim();
	} catch {
		return null;
	}
}

async function execText(pi: ExtensionAPI, command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
	const result = await pi.exec(command, args);
	return {
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		code: result.code ?? 0,
	};
}

async function ensureGitRepository(pi: ExtensionAPI, ctx: ExtensionContext): Promise<boolean> {
	const repoCheck = await execText(pi, "git", ["rev-parse", "--show-toplevel"]);
	if (repoCheck.code !== 0) {
		ctx.ui.notify("/blog must be run inside a git repository", "error");
		return false;
	}
	return true;
}

function buildWorkflowTask(workflow: BlogWorkflow, coreStandard: string, includePrevious: boolean): string {
	const previousBlock = includePrevious
		? `## 上一阶段结果\n\n{previous}\n\n请先阅读上一阶段结果。如果前置提交阶段明确表示提交失败、推送失败、发现敏感文件或工作区不安全，立即停止并说明原因，不要继续执行工作流。如果上一阶段因用户明确指定 no-push 而仅跳过推送，这不是失败；可继续本地流程，但后续任何 branch/tag push 也必须跳过。\n\n`
		: "";
	const coreStandardBlock = coreStandard.trim()
		? `## 用户核心标准\n\n请以以下内容作为本次日志筛选、摘要角度、写法和内容取舍的核心标准：\n\n${coreStandard.trim()}`
		: "## 用户核心标准\n\n（无，按工作流默认规则执行）";

	return `${previousBlock}${workflow.body}\n\n${coreStandardBlock}`;
}

function buildPreCommitTask(preCommitPrompt: string, coreStandard: string): string {
	const coreStandardBlock = coreStandard.trim()
		? `## 用户核心标准\n\n${coreStandard.trim()}`
		: "## 用户核心标准\n\n（无，按前置结余默认规则执行）";

	return `${preCommitPrompt}\n\n${coreStandardBlock}`;
}

function buildWorkflowPrompt(workflow: BlogWorkflow, coreStandard: string): string | null {
	const chain: Array<{ agent: string; task: string }> = [];

	if (workflow.preCommit) {
		const preCommitPrompt = readPreCommitPrompt();
		if (!preCommitPrompt) return null;
		chain.push({ agent: workflow.preCommitAgent, task: buildPreCommitTask(preCommitPrompt, coreStandard) });
	}

	chain.push({
		agent: workflow.agent,
		task: buildWorkflowTask(workflow, coreStandard, workflow.preCommit),
	});

	return `请立即调用 \`subagent\` 工具，以 chain 模式执行博客/日志工作流。不要先自行检查 git 状态，不要由主 agent 直接读 diff、写日志、提交、打 tag 或 push。\n\n工作流来自文件：\`${path.relative(extensionDir(), workflow.filePath).replace(/\\/g, "/")}\`\n\n参数：\n\n\`\`\`json\n${JSON.stringify(
		{
			chain,
			agentScope: "project",
			confirmProjectAgents: false,
		},
		null,
		2,
	)}\n\`\`\`\n\n子 agent 返回后，请用中文简要总结结果。`;
}

async function promptBlogCoreStandard(ctx: ExtensionContext, extraInstructions: string): Promise<string | undefined> {
	const trimmed = extraInstructions.trim();
	if (trimmed) return trimmed;
	if (!ctx.hasUI) return "";

	const input = await ctx.ui.input(
		"本次日志生成的核心标准（可留空）",
		"例如：重点写架构调整、只写用户可见变化、忽略临时提交等",
	);
	if (input === undefined) {
		ctx.ui.notify("Blog workflow cancelled", "info");
		return undefined;
	}
	return input.trim();
}

async function handleBlogWorkflow(pi: ExtensionAPI, ctx: ExtensionContext, workflow: BlogWorkflow, extraInstructions: string): Promise<void> {
	const ok = await ensureGitRepository(pi, ctx);
	if (!ok) return;

	const coreStandard = await promptBlogCoreStandard(ctx, extraInstructions);
	if (coreStandard === undefined) return;

	if (workflow.confirmDirtyWorktree) {
		const worktreeStatus = await execText(pi, "git", ["status", "--porcelain"]);
		if (worktreeStatus.code !== 0) {
			ctx.ui.notify(`Unable to inspect git worktree: ${worktreeStatus.stderr.trim() || "git status failed"}`, "error");
			return;
		}

		if (worktreeStatus.stdout.trim()) {
			if (!ctx.hasUI) {
				ctx.ui.notify(
					"Worktree has uncommitted changes. This workflow requires explicit approval before the pre-commit settlement stage, but no UI is available.",
					"error",
				);
				return;
			}

			const approved = await ctx.ui.confirm(
				"允许结余当前工作区改动？",
				"发布工作流会先审核现有改动，排除敏感或无关文件后创建提交，并按用户核心标准决定是否推送（明确 no-push/不推送时仅作本地结余）。",
			);
			if (!approved) {
				ctx.ui.notify("Blog workflow cancelled; no subagent was started", "info");
				return;
			}
		}
	}

	const prompt = buildWorkflowPrompt(workflow, coreStandard);
	if (!prompt) {
		ctx.ui.notify("Missing blog common/pre-commit.md", "error");
		return;
	}

	pi.sendUserMessage(prompt);
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("blog", {
		description: "Run a file-based blog/log workflow",
		getArgumentCompletions: (prefix: string) => {
			const workflows = discoverWorkflows();
			const normalizedPrefix = prefix.trim().toLowerCase();
			const items = workflows.map((workflow) => ({
				value: workflow.name,
				label: workflow.name,
				description: workflow.description,
			}));
			const filtered = items.filter((item) => item.value.toLowerCase().startsWith(normalizedPrefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const workflows = discoverWorkflows();
			if (workflows.length === 0) {
				ctx.ui.notify("No blog workflows found in extensions/blog/workflows", "error");
				return;
			}

			const parsed = parseArgs(args, workflows);
			let workflow = parsed.workflow;

			if (parsed.unknown) {
				ctx.ui.notify(
					`Unknown blog workflow: ${parsed.unknown}. Available: ${workflows.map((item) => item.name).join(", ")}`,
					"error",
				);
				return;
			}

			if (!workflow) {
				const choice = await ctx.ui.select(
					"Blog workflow",
					workflows.map((item) => formatWorkflowOption(item)),
				);
				if (!choice) {
					ctx.ui.notify("Blog workflow cancelled", "info");
					return;
				}
				workflow = findWorkflowByOption(workflows, choice);
			}

			if (!workflow) {
				ctx.ui.notify("Blog workflow not found", "error");
				return;
			}

			await handleBlogWorkflow(pi, ctx, workflow, parsed.extraInstructions);
		},
	});
}

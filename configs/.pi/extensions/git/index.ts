/**
 * Git Extension
 *
 * Provides a layered /git command for git operations.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { discoverAgents } from "../subagent/agents.js";

const DEFAULT_COMMIT_AGENT = "General";

const GIT_OPERATIONS = [
	{ value: "commit", label: "commit", description: "Commit and push changes" },
	{ value: "pull", label: "pull", description: "Pull from remote repository" },
];

function parseGitArgs(args: string, availableAgents: string[]): { operation: string; agent?: string; extraInstructions: string } {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	const operation = (parts.shift() ?? "").toLowerCase();
	if (!operation) return { operation: "", extraInstructions: "" };

	let agent: string | undefined;
	let extraParts: string[] = [];

	if (operation === "commit") {
		if (parts[0] === "--agent" || parts[0] === "-a") {
			parts.shift();
			agent = parts.shift();
			extraParts = parts;
		} else if (parts[0] && availableAgents.some((item) => item.toLowerCase() === parts[0].toLowerCase())) {
			agent = parts.shift();
			extraParts = parts;
		} else {
			extraParts = parts;
		}
	} else {
		extraParts = parts;
	}

	return { operation, agent, extraInstructions: extraParts.join(" ") };
}

function chooseCommitAgent(requestedAgent?: string): string {
	return requestedAgent || DEFAULT_COMMIT_AGENT;
}

async function handleGitCommit(pi: ExtensionAPI, _ctx: ExtensionContext, requestedAgent?: string, extraInstructions = ""): Promise<void> {
	const agentName = chooseCommitAgent(requestedAgent);
	const extraBlock = extraInstructions.trim()
		? `\n\n## 用户额外要求\n\n${extraInstructions.trim()}`
		: "";

	// Fixed delegation template only. The main agent should not inspect git state or diff,
	// so commit details stay inside the subagent's isolated context.
	const commitTask = `你是本次 Git 提交任务的执行者，请在子 agent 进程内完整完成提交和推送。

## 执行要求

1. 自己执行 \`git status --short\` 检查是否有改动。
2. 如果没有可提交内容，停止并说明原因。
3. 自己执行 \`git diff --cached\` 和 \`git diff\` 分析改动。
4. 根据实际改动生成合适的提交信息。
5. 执行 \`git add -A\` 暂存所有改动。
6. 执行 \`git commit -m "提交信息"\` 提交。
7. 执行 \`git push\` 推送。
8. 如果发生冲突、提交失败或推送失败，请停止并说明原因，不要让父 agent 代替执行。

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

主 agent 不参与 git 检查、diff 分析、提交信息生成或执行。
所有 git 操作都必须由你在子 agent 进程内完成。${extraBlock}`;

	const contextMessage = `请立即调用 \`subagent\` 工具，把 Git 提交任务完整委派给指定子 agent：\`${agentName}\`。

主 agent 不要检查 git 状态、不要读取 diff、不要生成提交信息、不要执行 \`git add\` / \`git commit\` / \`git push\`；提交和推送必须由子 agent 进程完成。子 agent 返回后，请只用中文简要总结结果。

参数：

\`\`\`json
{
  "agent": ${JSON.stringify(agentName)},
  "task": ${JSON.stringify(commitTask)},
  "agentScope": "project",
  "confirmProjectAgents": false
}
\`\`\``;

	// Send message to AI
	pi.sendUserMessage(contextMessage);
}

async function handleGitPull(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	// Check if it's a git repository
	const { code: statusCode } = await pi.exec("git", ["status"]);
	if (statusCode !== 0) {
		ctx.ui.notify("Not a git repository", "error");
		return;
	}

	// Check for uncommitted changes
	const { stdout: status } = await pi.exec("git", ["status", "--porcelain"]);
	if (status.trim().length > 0) {
		const choice = await ctx.ui.select("You have uncommitted changes. What do you want to do?", [
			"Stash changes and pull",
			"Commit changes first",
			"Cancel pull",
		]);

		if (!choice || choice === "Cancel pull") {
			ctx.ui.notify("Pull cancelled", "info");
			return;
		}

		if (choice === "Stash changes and pull") {
			ctx.ui.notify("Stashing changes...", "info");
			const { code: stashCode } = await pi.exec("git", ["stash", "push", "-m", "Auto-stash before pull"]);
			if (stashCode !== 0) {
				ctx.ui.notify("Failed to stash changes", "error");
				return;
			}
		}

		if (choice === "Commit changes first") {
			ctx.ui.notify("Please commit your changes first using /git commit", "info");
			return;
		}
	}

	// Get current branch
	const { stdout: branch } = await pi.exec("git", ["branch", "--show-current"]);
	const currentBranch = branch.trim();

	ctx.ui.notify(`Pulling from ${currentBranch}...`, "info");

	// Execute git pull
	const { stdout: pullOutput, stderr: pullError, code: pullCode } = await pi.exec("git", ["pull"]);

	if (pullCode === 0) {
		ctx.ui.notify("Pull successful!", "info");

		// Show pull result
		if (pullOutput.includes("Already up to date")) {
			ctx.ui.notify("Already up to date", "info");
		} else {
			ctx.ui.notify(`Pull result:\n${pullOutput}`, "info");
		}

		// If we stashed, ask to restore
		const { stdout: stashList } = await pi.exec("git", ["stash", "list"]);
		if (stashList.includes("Auto-stash before pull")) {
			const restore = await ctx.ui.confirm("Restore stashed changes?", "Do you want to restore your stashed changes?");

			if (restore) {
				const { code: popCode, stderr: popError } = await pi.exec("git", ["stash", "pop"]);
				if (popCode === 0) {
					ctx.ui.notify("Stashed changes restored", "info");
				} else {
					ctx.ui.notify(`Failed to restore stash:\n${popError}`, "error");
				}
			}
		}
	} else {
		// Pull failed
		if (pullError.includes("CONFLICT") || pullOutput.includes("CONFLICT")) {
			ctx.ui.notify("Pull failed: Merge conflicts detected", "error");
			ctx.ui.notify(
				"Please resolve conflicts manually:\n1. Check conflicted files with: git status\n2. Edit files to resolve conflicts\n3. Stage resolved files: git add <file>\n4. Complete merge: git commit",
				"info",
			);
		} else {
			ctx.ui.notify(`Pull failed:\n${pullError || pullOutput}`, "error");
		}
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("git", {
		description: "Git operations",
		getArgumentCompletions: (prefix: string) => {
			const parts = prefix.trim().split(/\s+/).filter(Boolean);
			const normalizedPrefix = prefix.trim().toLowerCase();

			if (parts[0]?.toLowerCase() === "commit") {
				const agentPrefix = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
				const discovery = discoverAgents(process.cwd(), "project");
				const items = discovery.agents.map((agent) => ({
					value: `commit ${agent.name}`,
					label: agent.name,
					description: `Use ${agent.name} subagent for commit`,
				}));
				const filtered = items.filter((item) => item.label.toLowerCase().startsWith(agentPrefix));
				return filtered.length > 0 ? filtered : null;
			}

			const items = GIT_OPERATIONS.map((operation) => ({
				value: operation.value,
				label: operation.label,
				description: operation.description,
			}));
			const filtered = items.filter((item) => item.value.startsWith(normalizedPrefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const parsed = parseGitArgs(args);
			let operation = parsed.operation;
			let commitAgent = parsed.agent;

			if (!operation) {
				const choice = await ctx.ui.select(
					"Git operation",
					GIT_OPERATIONS.map((item) => item.value),
				);
				if (!choice) {
					ctx.ui.notify("Git operation cancelled", "info");
					return;
				}
				operation = choice;
			}

			if (operation === "commit") {
				await handleGitCommit(pi, ctx, commitAgent, parsed.extraInstructions);
				return;
			}

			if (operation === "pull") {
				await handleGitPull(pi, ctx);
				return;
			}

			ctx.ui.notify(`Unknown git operation: ${operation}. Use /git commit or /git pull.`, "error");
		},
	});
}

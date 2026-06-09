import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

/** Discover agent names from subagent's agents/ dirs (both user and project). */
function discoverAgentNames(cwd: string): string[] {
	const names: string[] = [];

	// Project agents dir: <cwd>/agents/
	const projectDir = path.join(cwd, "agents");
	// Global subagent agents dir: ~/.pi/agent/extensions/subagent/agents/
	const agentDir = process.env.PI_CODING_AGENT_DIR
		|| path.join(process.env.HOME || process.env.USERPROFILE || "", ".pi", "agent");
	const globalDir = path.join(agentDir, "extensions", "subagent", "agents");

	for (const dir of [projectDir, globalDir]) {
		if (!fs.existsSync(dir)) continue;
		try {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				if (!entry.name.endsWith(".md")) continue;
				if (!entry.isFile() && !entry.isSymbolicLink()) continue;
				const content = fs.readFileSync(path.join(dir, entry.name), "utf-8");
				const { frontmatter } = parseFrontmatter<Record<string, string>>(content);
				const name = frontmatter.name || path.basename(entry.name, ".md");
				if (name) names.push(name);
			}
		} catch { /* skip unreadable dirs */ }
	}

	return [...new Set(names)];
}

const DEFAULT_COMMIT_AGENT = "General";

function chooseCommitAgent(requestedAgent?: string): string {
	return requestedAgent || DEFAULT_COMMIT_AGENT;
}

async function promptCommitCoreStandard(ctx: ExtensionContext, extraInstructions: string): Promise<string | undefined> {
	const trimmed = extraInstructions.trim();
	if (trimmed) return trimmed;
	if (!ctx.hasUI) return "";

	const input = await ctx.ui.input(
		"本次提交的核心要求（可留空）",
		"例如：只提交 blog 配置、提交信息强调修复菜单描述等",
	);
	if (input === undefined) {
		ctx.ui.notify("Git commit cancelled", "info");
		return undefined;
	}
	return input.trim();
}

export default {
	value: "commit",
	order: 1,
	label: "commit",
	description: "委派子 agent 完整完成提交（不自动推送）",

	async handle(pi: ExtensionAPI, ctx: ExtensionContext, parsed?: { agent?: string; extraInstructions?: string }): Promise<void> {
		const agentName = chooseCommitAgent(parsed?.agent);
		const coreStandard = await promptCommitCoreStandard(ctx, parsed?.extraInstructions ?? "");
		if (coreStandard === undefined) return;

		const extraBlock = coreStandard
			? `\n\n## 用户核心标准\n\n请以以下内容作为本次提交分析、改动取舍和提交信息生成的核心标准：\n\n${coreStandard}`
			: "";

		const commitTask = `你是本次 Git 提交任务的执行者，请在子 agent 进程内完整完成提交。

**不要执行 git push。** 只负责提交，推送由用户手动完成。

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
7. 记录该子仓库的提交结果（路径、提交信息）。

### 主仓库提交

所有子仓库处理完毕后：
1. 回到主仓库根目录。
2. 执行 \`git status --short\` 检查改动（此时应包含子仓库引用更新）。
3. 如果没有可提交内容，停止并说明原因。
4. 执行 \`git diff --cached\` 和 \`git diff\` 分析改动。
5. 根据实际改动生成合适的提交信息。
6. 执行 \`git add -A\` 暂存所有改动（包括子仓库引用更新）。
7. 执行 \`git commit -m "提交信息"\` 提交。

## 执行要求

- **不要执行 \`git push\`，只负责提交。**
- 如果发生冲突或提交失败，请停止并说明原因，不要让父 agent 代替执行。
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

主 agent 不参与 git 检查、diff 分析、提交信息生成或执行。
所有 git 操作都必须由你在子 agent 进程内完成。${extraBlock}`;

		const contextMessage = `请立即调用 \`subagent\` 工具，把 Git 提交任务完整委派给指定子 agent：\`${agentName}\`。

主 agent 不要检查 git 状态、不要读取 diff、不要生成提交信息、不要执行 \`git add\` / \`git commit\` / \`git push\`；提交必须由子 agent 进程完成。子 agent 返回后，请只用中文简要总结结果。

参数：

\`\`\`json
{
  "agent": ${JSON.stringify(agentName)},
  "task": ${JSON.stringify(commitTask)},
  "agentScope": "project",
  "confirmProjectAgents": false
}
\`\`\``;

		pi.sendUserMessage(contextMessage);
	},

	getCompletions(prefix: string) {
		const parts = prefix.trim().split(/\s+/).filter(Boolean);
		const agentPrefix = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
		const agentNames = discoverAgentNames(process.cwd());
		const items = agentNames.map((name) => ({
			value: `commit ${name}`,
			label: name,
			description: `使用 ${name} 子 agent 执行提交`,
		}));
		const filtered = items.filter((item) => item.label.toLowerCase().startsWith(agentPrefix));
		return filtered.length > 0 ? filtered : null;
	},
};

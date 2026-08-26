import type { AgentConfig } from "./agents.js";

export interface ShortcutTask {
	agent: AgentConfig;
	task: string;
}

export interface ShortcutPlan {
	mode: "single" | "parallel" | "chain";
	tasks: ShortcutTask[];
}

export const SUBAGENT_SHORTCUT_HINT_VALUE = "__subagent_shortcut_hint__";

function buildSubagentInvocationPrompt(params: Record<string, unknown>): string {
	return `这是用户通过 \`#Agent\` 发起的快捷指派。请先由主 agent 结合当前会话整理已有信息，并在必要时使用读取或搜索工具补足关键事实，然后再调用 \`subagent\` 工具。\n\n下面参数中的 agent、执行模式、任务数量和顺序是用户指定的路由约束，必须保留。task 表达的是用户原始意图，不是需要原样转发的最终委派说明。请将每个 task 整理为子 agent 可以独立执行的有界、自包含任务，包含目标、必要的前情或路径、已知事实、明确的范围边界、预期输出或证据，以及达到后即可返回的停止条件。委派能够完成目标的最小充分范围，不要要求为了完整性进行无边界探索。只做委派所需的上下文准备，不要替子 agent 完成任务。并行任务必须彼此独立；串行任务必须保留 \`{previous}\`，不要虚构上一步结果。除非存在无法继续的关键歧义，否则不要再次询问用户确认。\n\n快捷指派参数：\n\n\`\`\`json\n${JSON.stringify(params, null, 2)}\n\`\`\`\n\n整理完成后调用 \`subagent\`。子 agent 返回后，请用中文简要总结结果。`;
}

function buildAgentInvocationPrompt(agent: AgentConfig, task: string): string {
	return buildSubagentInvocationPrompt({
		agent: agent.name,
		task,
		agentScope: "project",
		confirmProjectAgents: false,
	});
}

function findShortcutAgent(agents: AgentConfig[], name: string): AgentConfig | undefined {
	const normalized = name.trim().toLowerCase();
	return agents.find((agent) => agent.name.toLowerCase() === normalized);
}

function parseShortcutMode(text: string): { mode?: "parallel" | "chain"; rest: string } {
	const match = text.match(/^#(chain|parallel)\b\s*([\s\S]*)$/i);
	if (!match) return { rest: text };
	return { mode: match[1].toLowerCase() as "parallel" | "chain", rest: match[2].trim() };
}

function parseShortcutSegment(segment: string, agents: AgentConfig[]): ShortcutTask | undefined {
	const match = segment.trim().match(/^#([\p{L}\p{N}_-]+)(?:\s+([\s\S]*))?$/u);
	if (!match) return undefined;

	const agent = findShortcutAgent(agents, match[1]);
	if (!agent) return undefined;

	return { agent, task: (match[2] ?? "").trim() };
}

export function parseShortcutPlan(text: string, agents: AgentConfig[]): ShortcutPlan | undefined {
	const trimmed = text.trim();
	if (!trimmed.startsWith("#")) return undefined;

	const { mode: explicitMode, rest } = parseShortcutMode(trimmed);
	if (!rest) return undefined;

	const hasChainDelimiter = rest.includes(">");
	const hasParallelDelimiter = rest.includes("|");
	if (!explicitMode && hasChainDelimiter && hasParallelDelimiter) return undefined;

	const mode = explicitMode ?? (hasChainDelimiter ? "chain" : hasParallelDelimiter ? "parallel" : "single");
	const delimiter = mode === "chain" ? ">" : mode === "parallel" ? "|" : undefined;
	const segments = delimiter ? rest.split(delimiter) : [rest];
	const tasks = segments.map((segment) => parseShortcutSegment(segment, agents));

	if (tasks.some((task) => !task)) return undefined;
	return { mode, tasks: tasks as ShortcutTask[] };
}

export function buildShortcutInvocationPrompt(plan: ShortcutPlan): string {
	if (plan.mode === "single") {
		return buildAgentInvocationPrompt(plan.tasks[0].agent, plan.tasks[0].task);
	}

	if (plan.mode === "parallel") {
		return buildSubagentInvocationPrompt({
			tasks: plan.tasks.map((task) => ({ agent: task.agent.name, task: task.task })),
			agentScope: "project",
			confirmProjectAgents: false,
		});
	}

	return buildSubagentInvocationPrompt({
		chain: plan.tasks.map((task, index) => ({
			agent: task.agent.name,
			task: index === 0 || task.task.includes("{previous}") ? task.task : `${task.task}\n\n上一步结果：{previous}`,
		})),
		agentScope: "project",
		confirmProjectAgents: false,
	});
}

export function getHashShortcutCompletions(agents: AgentConfig[], prefixText: string) {
	const normalized = prefixText.toLowerCase();
	const agentItems = agents
		.map((agent) => ({
			value: `#${agent.name} `,
			label: `#${agent.name}`,
			description: agent.description,
		}))
		.filter((item) => item.label.slice(1).toLowerCase().startsWith(normalized));

	if (agentItems.length === 0) return [];

	return [
		...agentItems,
		{
			value: SUBAGENT_SHORTCUT_HINT_VALUE,
			label: "提示：> 串行执行，| 并行执行",
			description: "提示项，选择后不会插入内容",
		},
	];
}

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildShortcutInvocationPrompt, parseShortcutPlan } from "../shortcuts.ts";

const AGENTS = [
	{
		name: "Explore",
		description: "Explore the codebase",
		tools: ["read", "grep"],
		systemPrompt: "Explore prompt",
		source: "project" as const,
		filePath: "agents/explore.md",
	},
	{
		name: "Scout",
		description: "Research upstream sources",
		tools: ["read", "grep"],
		systemPrompt: "Scout prompt",
		source: "project" as const,
		filePath: "agents/scout.md",
	},
	{
		name: "General",
		description: "Perform general tasks",
		systemPrompt: "General prompt",
		source: "project" as const,
		filePath: "agents/general.md",
	},
];

function transformShortcut(text: string): string {
	const plan = parseShortcutPlan(text, AGENTS);
	assert.ok(plan, "shortcut should parse");
	return buildShortcutInvocationPrompt(plan);
}

function parseShortcutParams(text: string): Record<string, any> {
	const match = text.match(/```json\n([\s\S]*?)\n```/);
	assert.ok(match, "transformed shortcut should contain JSON parameters");
	return JSON.parse(match[1]);
}

test("single #Agent shortcut asks the main agent to prepare a self-contained delegation", () => {
	const prompt = transformShortcut("#explore 查找同步逻辑");

	assert.match(prompt, /主 agent 结合当前会话整理已有信息/);
	assert.match(prompt, /子 agent 可以独立执行的自包含任务/);
	assert.match(prompt, /不要替子 agent 完成任务/);
	assert.doesNotMatch(prompt, /不要改写任务/);
	assert.deepEqual(parseShortcutParams(prompt), {
		agent: "Explore",
		task: "查找同步逻辑",
		agentScope: "project",
		confirmProjectAgents: false,
	});
});

test("parallel shortcut keeps the requested agents, order, and independent task structure", () => {
	const prompt = transformShortcut("#Explore 查本地逻辑 | #Scout 查上游实现");

	assert.match(prompt, /并行任务必须彼此独立/);
	assert.deepEqual(parseShortcutParams(prompt), {
		tasks: [
			{ agent: "Explore", task: "查本地逻辑" },
			{ agent: "Scout", task: "查上游实现" },
		],
		agentScope: "project",
		confirmProjectAgents: false,
	});
});

test("chain shortcut keeps order and passes the previous result to later delegation", () => {
	const prompt = transformShortcut("#Explore 查问题 > #General 根据结果修复");

	assert.match(prompt, /串行任务必须保留 `\{previous\}`/);
	assert.deepEqual(parseShortcutParams(prompt), {
		chain: [
			{ agent: "Explore", task: "查问题" },
			{ agent: "General", task: "根据结果修复\n\n上一步结果：{previous}" },
		],
		agentScope: "project",
		confirmProjectAgents: false,
	});
});

test("shortcut parsing leaves ordinary, unknown, and mixed-delimiter input untouched", () => {
	assert.equal(parseShortcutPlan("普通问题", AGENTS), undefined);
	assert.equal(parseShortcutPlan("#Unknown task", AGENTS), undefined);
	assert.equal(parseShortcutPlan("#Explore A > #Scout B | #General C", AGENTS), undefined);
	assert.equal(parseShortcutPlan("#Explore", AGENTS)?.tasks[0].task, "");
});

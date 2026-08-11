import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadPlanPrompts, normalizePlanContext, PLAN_CONTEXT_TYPE, type PlanDirective } from "../context.ts";
import { registerPlanExtension } from "../index.ts";
import { decodePlanState, findLatestPlanState, PLAN_STATE_TYPE } from "../state.ts";
import { findToolViolation, restoreAvailableTools, selectPlanTools } from "../utils.ts";

const TEST_PROMPTS = {
	plan: "PLAN {{TOOLS}}",
	inactive: "PLAN INACTIVE",
	execute: "EXECUTE PLAN",
};

function createFakePi({
	active = ["read", "write", "bash"],
	available = ["read", "write", "bash", "grep", "find", "ls", "questionnaire", "subagent"],
	planFlag = false,
}: { active?: string[]; available?: string[]; planFlag?: boolean } = {}) {
	let activeTools = [...active];
	const activeWrites: string[][] = [];
	const appended: any[] = [];
	const sent: any[] = [];
	const handlers = new Map<string, any>();
	const commands = new Map<string, any>();
	const shortcuts = new Map<string, any>();

	const api: any = {
		getActiveTools: () => [...activeTools],
		getAllTools: () => available.map((name) => ({ name })),
		setActiveTools(names: string[]) {
			activeTools = [...names];
			activeWrites.push([...names]);
		},
		appendEntry(customType: string, data: unknown) {
			appended.push({ customType, data: structuredClone(data) });
		},
		sendMessage(message: unknown, options: unknown) {
			sent.push({ message: structuredClone(message), options: structuredClone(options) });
		},
		registerFlag() {},
		getFlag: (name: string) => (name === "plan" ? planFlag : undefined),
		registerCommand(name: string, specification: unknown) {
			commands.set(name, specification);
		},
		registerShortcut(name: string, specification: unknown) {
			shortcuts.set(name, specification);
		},
		on(name: string, handler: unknown) {
			handlers.set(name, handler);
		},
	};

	return {
		api,
		commands,
		shortcuts,
		activeWrites,
		appended,
		sent,
		get activeTools() {
			return [...activeTools];
		},
		async emit(name: string, ...args: any[]) {
			const handler = handlers.get(name);
			if (!handler) throw new Error(`Missing fake handler: ${name}`);
			return await handler(...args);
		},
	};
}

function createContext({
	branch = [],
	idle = true,
	select = "Stay",
	input,
}: { branch?: any[]; idle?: boolean; select?: string; input?: string } = {}) {
	let currentBranch = branch;
	let idleState = idle;
	const statuses: any[] = [];
	const notifications: any[] = [];
	const selections: any[] = [];
	const ctx: any = {
		hasUI: true,
		isIdle: () => idleState,
		sessionManager: { getBranch: () => currentBranch },
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			setStatus(key: string, value: unknown) {
				statuses.push({ key, value });
			},
			setWidget() {},
			notify(message: string, level?: string) {
				notifications.push({ message, level });
			},
			async select(title: string, choices: string[]) {
				selections.push({ title, choices });
				return select;
			},
			async input() {
				return input;
			},
		},
	};
	return {
		ctx,
		statuses,
		notifications,
		selections,
		setIdle(value: boolean) {
			idleState = value;
		},
		setBranch(value: any[]) {
			currentBranch = value;
		},
	};
}

function register(fake: ReturnType<typeof createFakePi>, schedule?: (task: () => void) => void) {
	registerPlanExtension(fake.api, { prompts: TEST_PROMPTS, schedule });
}

test("state decoder supports legacy/v2 data and finds only the latest valid branch state", () => {
	assert.deepEqual(decodePlanState({ enabled: true }), { enabled: true, revision: 0 });
	assert.deepEqual(
		decodePlanState({
			enabled: false,
			revision: 4,
			toolsBeforePlan: [" read ", "read", "bash"],
			notice: { kind: "inactive", revision: 4 },
		}),
		{
			enabled: false,
			revision: 4,
			toolsBeforePlan: ["read", "bash"],
			notice: { kind: "inactive", revision: 4 },
		},
	);
	assert.equal(decodePlanState({ enabled: false, revision: "bad" }), undefined);

	const branch = [
		{ type: "custom", customType: "plan-mode", data: { enabled: true } },
		{ type: "custom", customType: PLAN_STATE_TYPE, data: { enabled: false, revision: 6 } },
		{ type: "custom", customType: PLAN_STATE_TYPE, data: { enabled: "bad", revision: 99 } },
	];
	assert.deepEqual(findLatestPlanState(branch), { enabled: false, revision: 6 });
});

test("context normalization removes stale controls but preserves ordinary Plan quotations", () => {
	const quoted = { role: "user", content: "What does [PLAN MODE ACTIVE] mean?" };
	const directive: PlanDirective = { owner: "plan", kind: "active", revision: 3, content: "current" };
	const normalized = normalizePlanContext(
		[
			{ role: "user", content: "request" },
			{ role: "custom", customType: PLAN_CONTEXT_TYPE, content: "old", details: { owner: "plan", kind: "active", revision: 1 } },
			{ role: "custom", customType: "plan-mode-context", content: "legacy" },
			quoted,
		],
		directive,
	);
	assert.equal(normalized.length, 3);
	assert.equal(normalized[1], quoted);
	assert.deepEqual((normalized[2] as any).details, { owner: "plan", kind: "active", revision: 3 });
	assert.equal(normalizePlanContext(normalized, directive).length, 3);
});

test("bundled Plan prompt identifies Bash null-device syntax on Windows", () => {
	const extensionDir = fileURLToPath(new URL("../", import.meta.url));
	const { prompts, diagnostics } = loadPlanPrompts(extensionDir);
	assert.deepEqual(diagnostics, []);
	assert.match(prompts.plan, /always executes Bash, including on Windows/);
	assert.match(prompts.plan, /use `\/dev\/null` as the null device/);
	assert.match(prompts.plan, /Never use `nul`, `NUL`, `nul:`, or `\$null`/);
});

test("tool helpers keep only registered active candidates and use a bounded write guard", () => {
	assert.deepEqual(
		selectPlanTools(["read", "write", "bash", "subagent"], ["read", "write", "subagent"]),
		["read", "subagent"],
	);
	assert.deepEqual(restoreAvailableTools(["write", "read", "retired", "read"], ["read", "write"]), ["write", "read"]);
	assert.match(findToolViolation("edit", {}) ?? "", /disabled/);
	assert.match(findToolViolation("bash", {}) ?? "", /non-empty/);
	for (const command of [
		"rm -rf build",
		"git -C . add file.ts",
		"Set-Content output.txt value",
		"printf x > output.txt",
		"where.exe tool 2>NUL",
		"where.exe tool 2>nul:",
		"printf x > $null",
	]) {
		assert.ok(findToolViolation("bash", { command }), command);
	}
	for (const command of [
		'rg "rm" .',
		"git status --short",
		"git tag --list",
		"Get-Content README.md",
		"rg TODO . 2>&1",
		"rg TODO . 2>/dev/null",
		'cmd.exe /c "where.exe tool 2>NUL"',
	]) {
		assert.equal(findToolViolation("bash", { command }), undefined, command);
	}
});

test("/plan and Alt+I share identical manual-toggle effects", async () => {
	const commandFake = createFakePi({ active: ["read", "write", "bash", "subagent"] });
	const shortcutFake = createFakePi({ active: ["read", "write", "bash", "subagent"] });
	register(commandFake);
	register(shortcutFake);
	const commandContext = createContext();
	const shortcutContext = createContext();

	await commandFake.commands.get("plan").handler("", commandContext.ctx);
	await shortcutFake.shortcuts.get("alt+i").handler(shortcutContext.ctx);
	assert.deepEqual(shortcutFake.activeTools, commandFake.activeTools);
	assert.deepEqual(shortcutFake.appended, commandFake.appended);
	assert.deepEqual(shortcutContext.statuses, commandContext.statuses);
	assert.deepEqual(shortcutContext.notifications, commandContext.notifications);
	assert.deepEqual(commandFake.activeTools, ["read", "bash", "subagent"]);
});

test("busy switching keeps the current run mode and applies one pending target at settled", async () => {
	const fake = createFakePi();
	register(fake);
	const context = createContext();
	await fake.emit("session_start", {}, context.ctx);
	await fake.emit("before_agent_start", {}, context.ctx);
	context.setIdle(false);
	await fake.commands.get("plan").handler("", context.ctx);

	assert.deepEqual(fake.activeTools, ["read", "write", "bash"]);
	assert.equal(fake.appended.length, 0);
	assert.equal(await fake.emit("tool_call", { toolName: "write", input: {} }), undefined);
	await fake.shortcuts.get("alt+i").handler(context.ctx); // back to the current mode cancels pending
	context.setIdle(true);
	await fake.emit("agent_settled", {}, context.ctx);
	assert.deepEqual(fake.activeTools, ["read", "write", "bash"]);
	assert.equal(fake.appended.length, 0);

	context.setIdle(false);
	await fake.commands.get("plan").handler("", context.ctx);
	context.setIdle(true);
	await fake.emit("agent_settled", {}, context.ctx);
	assert.deepEqual(fake.activeTools, ["read", "bash"]);
	assert.equal(fake.appended.length, 1);
	assert.equal(context.selections.length, 0);

	const start = await fake.emit("before_agent_start", {}, context.ctx);
	assert.deepEqual(start.message.details, { owner: "plan", kind: "active", revision: 1 });
	assert.equal((await fake.emit("tool_call", { toolName: "write", input: {} })).block, true);
});

test("manual exit never executes and its inactive notice is consumed by one real user prompt", async () => {
	const fake = createFakePi();
	register(fake);
	const context = createContext();
	await fake.commands.get("plan").handler("", context.ctx);
	await fake.commands.get("plan").handler("", context.ctx);
	assert.deepEqual(fake.sent, []);
	assert.deepEqual(fake.appended.at(-1)?.data.notice, { kind: "inactive", revision: 2 });

	await fake.emit("agent_start", {}); // custom run: must not consume the notice
	await fake.emit("agent_settled", {}, context.ctx);
	assert.deepEqual(fake.appended.at(-1)?.data.notice, { kind: "inactive", revision: 2 });

	const firstUserRun = await fake.emit("before_agent_start", {}, context.ctx);
	assert.deepEqual(firstUserRun.message.details, { owner: "plan", kind: "inactive", revision: 2 });
	assert.equal(fake.appended.at(-1)?.data.notice, undefined);
	await fake.emit("agent_start", {});
	await fake.emit("agent_start", {}); // low-level retry must keep the top-level directive
	const retryContext = await fake.emit("context", { messages: [firstUserRun.message] });
	assert.deepEqual(retryContext.messages[0].details, { owner: "plan", kind: "inactive", revision: 2 });
	await fake.emit("agent_settled", {}, context.ctx);
	assert.equal(await fake.emit("before_agent_start", {}, context.ctx), undefined);
});

test("Execute restores tools and emits exactly one deferred follow-up turn", async () => {
	const fake = createFakePi();
	const scheduled: Array<() => void> = [];
	register(fake, (task) => scheduled.push(task));
	const context = createContext({
		branch: [
			{ type: "custom", customType: PLAN_STATE_TYPE, data: { enabled: true, revision: 3, toolsBeforePlan: ["read", "write", "bash"] } },
		],
		select: "Execute",
	});
	await fake.emit("session_start", {}, context.ctx);
	await fake.emit("before_agent_start", {}, context.ctx);
	await fake.emit("agent_settled", {}, context.ctx);
	assert.equal(scheduled.length, 1);
	assert.equal(fake.sent.length, 0);
	scheduled.shift()?.();

	assert.deepEqual(fake.activeTools, ["read", "write", "bash"]);
	assert.equal(fake.sent.length, 1);
	assert.deepEqual(fake.sent[0].options, { triggerTurn: true, deliverAs: "followUp" });
	assert.equal(fake.sent[0].message.content, TEST_PROMPTS.execute);

	const emptyFake = createFakePi();
	const emptyScheduled: Array<() => void> = [];
	register(emptyFake, (task) => emptyScheduled.push(task));
	const emptyContext = createContext({
		branch: [{ type: "custom", customType: PLAN_STATE_TYPE, data: { enabled: true, revision: 1, toolsBeforePlan: ["read", "write", "bash"] } }],
		select: "Execute with additional instructions",
		input: "   ",
	});
	await emptyFake.emit("session_start", {}, emptyContext.ctx);
	await emptyFake.emit("before_agent_start", {}, emptyContext.ctx);
	await emptyFake.emit("agent_settled", {}, emptyContext.ctx);
	assert.deepEqual(emptyFake.activeTools, ["read", "bash"]);
	assert.equal(emptyScheduled.length, 0);
	assert.equal(emptyFake.appended.length, 0);
});

test("--plan overrides disabled state and branch hydration stays isolated without writes", async () => {
	const startupFake = createFakePi({ planFlag: true });
	register(startupFake);
	const startupContext = createContext({
		branch: [{ type: "custom", customType: PLAN_STATE_TYPE, data: { enabled: false, revision: 4 } }],
	});
	await startupFake.emit("session_start", {}, startupContext.ctx);
	assert.equal(startupFake.appended.at(-1)?.data.enabled, true);

	const branchFake = createFakePi({ active: ["read", "write", "subagent"], available: ["read", "write", "subagent"] });
	register(branchFake);
	const branchContext = createContext({
		branch: [
			{ type: "custom", customType: PLAN_STATE_TYPE, data: { enabled: true, revision: 1, toolsBeforePlan: ["read", "write"] } },
		],
	});
	await branchFake.emit("session_start", {}, branchContext.ctx);
	assert.deepEqual(branchFake.activeTools, ["read"]);
	branchContext.setBranch([
		{ type: "custom", customType: PLAN_STATE_TYPE, data: { enabled: true, revision: 5, toolsBeforePlan: ["read", "write", "subagent"] } },
	]);
	await branchFake.emit("session_tree", {}, branchContext.ctx);
	assert.deepEqual(branchFake.activeTools, ["read", "subagent"]);
	assert.equal(branchFake.appended.length, 0);

	branchFake.api.setActiveTools(["read"]); // user explicitly disables subagent while Plan is active
	branchContext.setBranch([
		{ type: "custom", customType: PLAN_STATE_TYPE, data: { enabled: true, revision: 6, toolsBeforePlan: ["read", "write", "subagent"] } },
	]);
	await branchFake.emit("session_tree", {}, branchContext.ctx);
	assert.deepEqual(branchFake.activeTools, ["read"]);

	branchContext.setBranch([
		{ type: "custom", customType: PLAN_STATE_TYPE, data: { enabled: false, revision: 7, toolsBeforePlan: ["read"] } },
	]);
	await branchFake.emit("session_tree", {}, branchContext.ctx);
	assert.deepEqual(branchFake.activeTools, ["read"]);
	assert.equal(branchFake.appended.length, 0);
});

function collectSources(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const entryPath = join(directory, entry.name);
		if (entry.isDirectory()) return collectSources(entryPath);
		return [".ts", ".md"].includes(extname(entry.name)) ? [entryPath] : [];
	});
}

test("Subagent sources and agent configs contain no Plan-specific protocol", () => {
	const subagentDir = fileURLToPath(new URL("../../subagent/", import.meta.url));
	const agentsDir = fileURLToPath(new URL("../../../../../../agents/", import.meta.url));
	const forbidden = /\b(?:planMode|PlanModePolicy|isPlanEnabled|validatePlanSubagentCall)\b|["'`](?:plan-state|plan-mode)["'`]/;
	for (const filePath of [...collectSources(subagentDir), ...collectSources(agentsDir)]) {
		assert.doesNotMatch(readFileSync(filePath, "utf8"), forbidden, filePath);
	}
});

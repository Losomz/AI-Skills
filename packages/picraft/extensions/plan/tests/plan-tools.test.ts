import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { decodePlanTools, loadPlanToolConfiguration, PICRAFT_CONFIG_FILE } from "../config.ts";
import { registerPlanExtension } from "../index.ts";
import { normalizeAdditionalPlanTools, selectPlanTools } from "../utils.ts";

test("additional Plan tools are normalized and intersected with registered active tools", () => {
	assert.deepEqual(normalizeAdditionalPlanTools([" codegraph_search ", "memory_search", "codegraph_search"]), [
		"codegraph_search",
		"memory_search",
	]);
	assert.deepEqual(
		selectPlanTools(
			["read", "write", "codegraph_search", "inactive_search"],
			["read", "write", "codegraph_search"],
			["codegraph_search", "inactive_search"],
		),
		["read", "codegraph_search"],
	);
	assert.throws(() => normalizeAdditionalPlanTools(["write"]), /not allowed/);
	assert.throws(() => normalizeAdditionalPlanTools([" "]), /must not be empty/);
});

test("Plan extension applies programmatic additional tools when the mode is enabled", async () => {
	let activeTools = ["read", "write", "codegraph_search"];
	const handlers = new Map<string, (...args: any[]) => any>();
	const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
	const pi = {
		getActiveTools: () => [...activeTools],
		getAllTools: () => ["read", "write", "codegraph_search"].map((name) => ({ name })),
		setActiveTools: (names: string[]) => { activeTools = [...names]; },
		appendEntry() {},
		sendMessage() {},
		registerFlag() {},
		getFlag: () => false,
		registerCommand: (name: string, definition: any) => commands.set(name, definition),
		registerShortcut() {},
		on: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler),
	};
	registerPlanExtension(pi as any, {
		prompts: { plan: "PLAN {{TOOLS}}", inactive: "INACTIVE", execute: "EXECUTE" },
		allowedTools: ["codegraph_search"],
	});
	const ctx = {
		cwd: os.tmpdir(),
		hasUI: false,
		isIdle: () => true,
		isProjectTrusted: () => false,
		sessionManager: { getBranch: () => [] },
	};

	await handlers.get("session_start")?.({}, ctx);
	await commands.get("plan")?.handler("", ctx);

	assert.deepEqual(activeTools, ["read", "codegraph_search"]);
});

test("Plan configuration validates the plan.tools shape", () => {
	assert.deepEqual(decodePlanTools({}), []);
	assert.deepEqual(decodePlanTools({ plan: { tools: [" codegraph_explore ", "memory_search"] } }), [
		"codegraph_explore",
		"memory_search",
	]);
	assert.throws(() => decodePlanTools({ plan: { tools: "codegraph_search" } }), /array of strings/);
	assert.throws(() => decodePlanTools({ plan: { tools: ["powershell"] } }), /not allowed/);
});

test("trusted project Plan tools append to global tools and invalid files fail closed", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "picraft-plan-config-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const agentDir = path.join(root, "agent");
	const cwd = path.join(root, "repo");
	const projectConfigDir = path.join(cwd, ".pi");
	fs.mkdirSync(agentDir, { recursive: true });
	fs.mkdirSync(projectConfigDir, { recursive: true });
	fs.writeFileSync(
		path.join(agentDir, PICRAFT_CONFIG_FILE),
		JSON.stringify({ plan: { tools: ["codegraph_search", "memory_search"] } }),
	);
	fs.writeFileSync(
		path.join(projectConfigDir, PICRAFT_CONFIG_FILE),
		JSON.stringify({ plan: { tools: ["codegraph_explore", "codegraph_search"] } }),
	);

	assert.deepEqual(
		loadPlanToolConfiguration({ cwd, projectTrusted: false, agentDir, configDirName: ".pi" }),
		{ tools: ["codegraph_search", "memory_search"], diagnostics: [] },
	);
	assert.deepEqual(
		loadPlanToolConfiguration({ cwd, projectTrusted: true, agentDir, configDirName: ".pi" }),
		{ tools: ["codegraph_search", "memory_search", "codegraph_explore"], diagnostics: [] },
	);

	fs.writeFileSync(path.join(projectConfigDir, PICRAFT_CONFIG_FILE), JSON.stringify({ plan: { tools: ["write"] } }));
	const invalid = loadPlanToolConfiguration({ cwd, projectTrusted: true, agentDir, configDirName: ".pi" });
	assert.deepEqual(invalid.tools, ["codegraph_search", "memory_search"]);
	assert.equal(invalid.diagnostics.length, 1);
	assert.match(invalid.diagnostics[0], /not allowed/);
});

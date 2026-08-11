import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AgentConfig } from "../agents.ts";
import { getSubagentNameFromEnvironment, resolvePiInvocation, runAgentProcess } from "../agent-runner.ts";

interface TempScript {
	dir: string;
	filePath: string;
}

function createTempScript(contents: string): TempScript {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-test-"));
	const filePath = path.join(dir, "runner.cjs");
	fs.writeFileSync(filePath, contents, "utf8");
	return { dir, filePath };
}

function removeTempScript(script: TempScript): void {
	fs.rmSync(script.dir, { recursive: true, force: true });
}

function profile(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name: "General",
		description: "general",
		model: "provider/general-model",
		tools: ["read", "bash"],
		systemPrompt: "General base prompt",
		source: "project",
		filePath: "agents/general.md",
		...overrides,
	};
}

async function usingCliScript<T>(script: TempScript, callback: () => Promise<T>): Promise<T> {
	const previous = process.argv[1];
	process.argv[1] = script.filePath;
	try {
		return await callback();
	} finally {
		process.argv[1] = previous;
		removeTempScript(script);
	}
}

test("resolvePiInvocation uses the current CLI entry for Node and the executable for packaged Pi", () => {
	assert.deepEqual(
		resolvePiInvocation(["Task: hello"], { execPath: "C:\\Program Files\\node.exe", argv1: "C:\\pi\\cli.js" }),
		{
			command: "C:\\Program Files\\node.exe",
			args: ["C:\\pi\\cli.js", "Task: hello"],
			shell: false,
		},
	);
	assert.deepEqual(
		resolvePiInvocation(["--mode", "json"], { execPath: "C:\\Pi\\pi.exe", argv1: "ignored" }),
		{
			command: "C:\\Pi\\pi.exe",
			args: ["--mode", "json"],
			shell: false,
		},
	);
	assert.throws(
		() => resolvePiInvocation([], { execPath: "C:\\Program Files\\node.exe" }),
		/Unable to resolve the Pi CLI entry/,
	);
});

test("subagent identity requires an explicit process marker and trims the agent name", () => {
	assert.equal(getSubagentNameFromEnvironment({ PI_SUBAGENT_NAME: "General" }), undefined);
	assert.equal(getSubagentNameFromEnvironment({ PI_IS_SUBAGENT: "1", PI_SUBAGENT_NAME: "  General  " }), "General");
	assert.equal(getSubagentNameFromEnvironment({ PI_IS_SUBAGENT: "1", PI_SUBAGENT_NAME: "  " }), undefined);
});

test("runAgentProcess forwards permission context with cwd, model, tools, system prompt, and ephemeral Pi flags", async () => {
	const script = createTempScript(`
		const fs = require("node:fs");
		const args = process.argv.slice(2);
		const promptIndex = args.indexOf("--append-system-prompt");
		const promptPath = promptIndex === -1 ? undefined : args[promptIndex + 1];
		const payload = {
			args,
			cwd: process.cwd(),
			promptPath,
			prompt: promptPath ? fs.readFileSync(promptPath, "utf8") : "",
			permissionEnv: {
				isSubagent: process.env.PI_IS_SUBAGENT,
				parentSession: process.env.PI_SUBAGENT_PARENT_SESSION,
				agentName: process.env.PI_SUBAGENT_NAME,
			},
		};
		process.stdout.write("non-json noise\\r\\n");
		process.stdout.write(JSON.stringify({
			type: "message_end",
			message: {
				role: "assistant",
				model: "provider/runtime-model",
				content: [{ type: "text", text: JSON.stringify(payload) }],
				usage: { input: 2, output: 3, cacheRead: 4, cacheWrite: 5, cost: { total: 0.12 }, totalTokens: 77 },
			},
		}) + "\\r\\n");
	`);

	await usingCliScript(script, async () => {
		const statuses: string[] = [];
		const result = await runAgentProcess({
			profile: profile({ thinkingLevel: "medium" }),
			task: "run test task",
			cwd: script.dir,
			parentSessionId: "parent-session-123",
			onUpdate: (update) => statuses.push(update.status),
		});
		const payload = JSON.parse(result.output) as {
			args: string[];
			cwd: string;
			promptPath: string;
			prompt: string;
			permissionEnv: { isSubagent?: string; parentSession?: string; agentName?: string };
		};

		assert.equal(result.status, "completed");
		assert.equal(result.failed, false);
		assert.equal(result.model, "provider/general-model");
		assert.equal(result.usage.input, 2);
		assert.equal(result.usage.output, 3);
		assert.equal(result.usage.cacheRead, 4);
		assert.equal(result.usage.cacheWrite, 5);
		assert.equal(result.usage.contextTokens, 77);
		assert.equal(payload.cwd, script.dir);
		assert.deepEqual(payload.args.slice(0, 4), ["--mode", "json", "-p", "--no-session"]);
		assert.ok(payload.args.includes("--model"));
		assert.ok(payload.args.includes("provider/general-model"));
		assert.ok(payload.args.includes("--thinking"));
		assert.ok(payload.args.includes("medium"));
		assert.ok(payload.args.includes("--tools"));
		assert.ok(payload.args.includes("read,bash"));
		assert.ok(payload.args.includes("Task: run test task"));
		assert.match(payload.prompt, /^<active_agent name="General"><\/active_agent>\n\n/);
		assert.match(payload.prompt, /General base prompt$/);
		assert.deepEqual(payload.permissionEnv, {
			isSubagent: "1",
			parentSession: "parent-session-123",
			agentName: "General",
		});
		assert.equal(fs.existsSync(payload.promptPath), false);
		assert.equal(statuses[0], "pending");
		assert.equal(statuses.at(-1), "completed");
	});
});

test("runAgentProcess normalizes non-zero exits and spawn failures", async (t) => {
	await t.test("non-zero exit", async () => {
		const script = createTempScript(`process.stderr.write("failure-line\\n"); process.exit(7);`);
		await usingCliScript(script, async () => {
			const result = await runAgentProcess({ profile: profile({ systemPrompt: "" }), task: "fail", cwd: script.dir });
			assert.equal(result.status, "failed");
			assert.equal(result.exitCode, 7);
			assert.equal(result.failed, true);
			assert.match(result.output, /failure-line/);
		});
	});

	await t.test("spawn failure", async () => {
		const script = createTempScript(`process.exit(0);`);
		await usingCliScript(script, async () => {
			const result = await runAgentProcess({
				profile: profile(),
				task: "missing cwd",
				cwd: path.join(script.dir, "does-not-exist"),
			});
			assert.equal(result.status, "failed");
			assert.equal(result.failed, true);
			assert.equal(result.exitCode, 1);
			assert.match(result.output, /Failed to start Pi subprocess|ENOENT/);
		});
	});
});

test("runAgentProcess aborts the child and reaches an aborted terminal state", async () => {
	const script = createTempScript(`setInterval(() => {}, 1000);`);
	await usingCliScript(script, async () => {
		const controller = new AbortController();
		const result = await runAgentProcess({
			profile: profile({ systemPrompt: "" }),
			task: "wait",
			cwd: script.dir,
			signal: controller.signal,
			onUpdate: (update) => {
				if (update.status === "running") controller.abort();
			},
		});
		assert.equal(result.status, "aborted");
		assert.equal(result.stopReason, "aborted");
		assert.equal(result.failed, true);
	});
});

test("onUpdate errors do not interrupt the subprocess lifecycle", async () => {
	const script = createTempScript(`
		process.stdout.write(JSON.stringify({
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "done" }] },
		}) + "\\n");
	`);
	await usingCliScript(script, async () => {
		const result = await runAgentProcess({
			profile: profile({ systemPrompt: "" }),
			task: "finish",
			cwd: script.dir,
			onUpdate: () => {
				throw new Error("observer failed");
			},
		});
		assert.equal(result.status, "completed");
		assert.equal(result.output, "done");
	});
});

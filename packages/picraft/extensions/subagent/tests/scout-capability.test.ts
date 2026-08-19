import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AgentConfig } from "../agents.ts";
import {
	SCOUT_REPOSITORY_CAPABILITY_ENV,
	getBundledScoutProfilePath,
	isScoutRepositoryCapabilityEnabled,
	isTrustedBundledScoutProfile,
	runAgentProcess,
} from "../agent-runner.ts";
import { registerScoutRepositoryTool } from "../repository-tool.ts";

function createRunnerScript(): { dir: string; filePath: string } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scout-capability-test-"));
	const filePath = path.join(dir, "runner.cjs");
	fs.writeFileSync(
		filePath,
		`process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: JSON.stringify({ capability: process.env.${SCOUT_REPOSITORY_CAPABILITY_ENV}, name: process.env.PI_SUBAGENT_NAME, isSubagent: process.env.PI_IS_SUBAGENT, gitPrompt: process.env.GIT_TERMINAL_PROMPT, gcm: process.env.GCM_INTERACTIVE, lfs: process.env.GIT_LFS_SKIP_SMUDGE }) }] } }) + "\\n");`,
		"utf8",
	);
	return { dir, filePath };
}

function profile(source: "project" | "user", filePath = getBundledScoutProfilePath()): AgentConfig {
	return {
		name: "Scout",
		description: "scout",
		tools: ["read", "grep", "find", "ls", "bash", "scout_repository"],
		systemPrompt: "Scout",
		source,
		filePath,
	};
}

async function runWithScript(filePath: string, agent: AgentConfig): Promise<Record<string, string | undefined>> {
	const previous = process.argv[1];
	process.argv[1] = filePath;
	try {
		const result = await runAgentProcess({ profile: agent, task: "inspect", cwd: path.dirname(filePath) });
		assert.equal(result.status, "completed");
		return JSON.parse(result.output) as Record<string, string | undefined>;
	} finally {
		process.argv[1] = previous;
	}
}

test("only the exact bundled Scout profile is trusted for the repository capability", () => {
	assert.equal(isTrustedBundledScoutProfile(profile("project")), true);
	assert.equal(isTrustedBundledScoutProfile(profile("user")), false);
	assert.equal(isTrustedBundledScoutProfile(profile("project", path.join(os.tmpdir(), "scout.md"))), false);
	assert.equal(
		isTrustedBundledScoutProfile({ name: "General", source: "project", filePath: getBundledScoutProfilePath() }),
		false,
	);
	assert.equal(
		isScoutRepositoryCapabilityEnabled({
			PI_IS_SUBAGENT: "1",
			PI_SUBAGENT_NAME: "Scout",
			[SCOUT_REPOSITORY_CAPABILITY_ENV]: "1",
		}),
		true,
	);
	assert.equal(isScoutRepositoryCapabilityEnabled({ PI_IS_SUBAGENT: "1", PI_SUBAGENT_NAME: "Scout" }), false);
	assert.equal(
		isScoutRepositoryCapabilityEnabled({
			PI_IS_SUBAGENT: "1",
			PI_SUBAGENT_NAME: "General",
			[SCOUT_REPOSITORY_CAPABILITY_ENV]: "1",
		}),
		false,
	);
});

test("repository tool registration is gated by the trusted child capability", () => {
	const previous = process.env[SCOUT_REPOSITORY_CAPABILITY_ENV];
	const previousIsSubagent = process.env.PI_IS_SUBAGENT;
	const previousName = process.env.PI_SUBAGENT_NAME;
	const registrations: Array<{ name: string }> = [];
	const fakePi = { registerTool: (tool: { name: string }) => registrations.push({ name: tool.name }) };
	try {
		process.env.PI_IS_SUBAGENT = "1";
		process.env.PI_SUBAGENT_NAME = "Scout";
		delete process.env[SCOUT_REPOSITORY_CAPABILITY_ENV];
		assert.equal(registerScoutRepositoryTool(fakePi as never), false);
		process.env[SCOUT_REPOSITORY_CAPABILITY_ENV] = "1";
		assert.equal(registerScoutRepositoryTool(fakePi as never), true);
		assert.deepEqual(registrations, [{ name: "scout_repository" }]);
	} finally {
		if (previous === undefined) delete process.env[SCOUT_REPOSITORY_CAPABILITY_ENV];
		else process.env[SCOUT_REPOSITORY_CAPABILITY_ENV] = previous;
		if (previousIsSubagent === undefined) delete process.env.PI_IS_SUBAGENT;
		else process.env.PI_IS_SUBAGENT = previousIsSubagent;
		if (previousName === undefined) delete process.env.PI_SUBAGENT_NAME;
		else process.env.PI_SUBAGENT_NAME = previousName;
	}
});

test("agent-runner grants the capability and noninteractive Git environment only to the bundled Scout", async () => {
	const script = createRunnerScript();
	try {
		const bundled = await runWithScript(script.filePath, profile("project"));
		assert.deepEqual(bundled, {
			capability: "1",
			name: "Scout",
			isSubagent: "1",
			gitPrompt: "0",
			gcm: "Never",
			lfs: "1",
		});
		const user = await runWithScript(script.filePath, profile("user"));
		assert.equal(user.capability, undefined);
		assert.equal(user.name, "Scout");
		assert.equal(user.isSubagent, "1");
	} finally {
		fs.rmSync(script.dir, { recursive: true, force: true });
	}
});

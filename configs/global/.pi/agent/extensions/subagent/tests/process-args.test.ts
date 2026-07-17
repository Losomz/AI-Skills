import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAgentProcessArgs } from "../agent-runner.ts";

test("isolated agent argv keeps ephemeral JSON mode and inherits model, tools, prompt, and task", () => {
	assert.deepEqual(
		buildAgentProcessArgs(
			{ model: "provider/model", tools: ["read", "bash"] },
			"提交当前仓库",
			"C:\\Temp\\general.md",
		),
		[
			"--mode",
			"json",
			"-p",
			"--no-session",
			"--model",
			"provider/model",
			"--tools",
			"read,bash",
			"--append-system-prompt",
			"C:\\Temp\\general.md",
			"Task: 提交当前仓库",
		],
	);
});

test("isolated agent argv omits optional configuration when the agent uses Pi defaults", () => {
	assert.deepEqual(buildAgentProcessArgs({}, "检查状态"), [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"Task: 检查状态",
	]);
});

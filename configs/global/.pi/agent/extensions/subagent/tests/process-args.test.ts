import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAgentProcessArgs } from "../agent-runner.ts";

test("isolated agent argv keeps ephemeral JSON mode and inherits model, tools, prompt, and task", () => {
	assert.deepEqual(
		buildAgentProcessArgs(
			{ model: "provider/model", thinkingLevel: "high", tools: ["read", "bash"] },
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
			"--thinking",
			"high",
			"--tools",
			"read,bash",
			"--append-system-prompt",
			"C:\\Temp\\general.md",
			"Task: 提交当前仓库",
		],
	);
});

test("isolated agent argv omits thinking for Default and preserves explicit Off", () => {
	assert.deepEqual(buildAgentProcessArgs({}, "检查状态"), [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"Task: 检查状态",
	]);
	assert.deepEqual(buildAgentProcessArgs({ thinkingLevel: "off" }, "检查状态"), [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--thinking",
		"off",
		"Task: 检查状态",
	]);
});

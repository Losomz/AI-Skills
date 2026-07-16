import assert from "node:assert/strict";
import { test } from "node:test";

import {
	createCommitOperation,
	type CommitAgentRunOptions,
	type CommitAgentRunResult,
} from "../commit-operation.ts";

function successfulResult(overrides: Partial<CommitAgentRunResult> = {}): CommitAgentRunResult {
	return {
		agent: "General",
		exitCode: 0,
		output: "提交并推送完成",
		stderr: "",
		failed: false,
		pid: 4321,
		...overrides,
	};
}

function createUiContext(input: string | undefined) {
	const notifications: Array<{ message: string; level?: string }> = [];
	const statuses: Array<{ key: string; value: unknown }> = [];
	const ctx: any = {
		hasUI: true,
		cwd: "D:\\work\\repo",
		ui: {
			async input() {
				return input;
			},
			notify(message: string, level?: string) {
				notifications.push({ message, level });
			},
			setStatus(key: string, value: unknown) {
				statuses.push({ key, value });
			},
		},
	};
	return { ctx, notifications, statuses };
}

const poisonParentApi = new Proxy(
	{},
	{
		get(_target, property) {
			throw new Error(`Parent Pi API must not be accessed: ${String(property)}`);
		},
	},
);

test("/git commit calls the isolated runner directly without touching the parent Pi API", async () => {
	const calls: CommitAgentRunOptions[] = [];
	const operation = createCommitOperation({
		discoverAgents: () => [{ name: "General" }],
		async runAgent(_ctx, options) {
			calls.push(options);
			return successfulResult();
		},
	});
	const { ctx, notifications, statuses } = createUiContext("");

	await operation.handle(poisonParentApi as any, ctx, {
		agent: "General",
		extraInstructions: "只提交 Pi 扩展",
	});

	assert.equal(calls.length, 1);
	assert.equal(calls[0].agent, "General");
	assert.equal(calls[0].agentScope, "project");
	assert.equal(calls[0].cwd, ctx.cwd);
	assert.match(calls[0].task, /只提交 Pi 扩展/);
	assert.match(calls[0].task, /子仓库优先原则/);
	assert.deepEqual(statuses, [
		{ key: "git-commit", value: "Git commit: General" },
		{ key: "git-commit", value: undefined },
	]);
	assert.equal(notifications.length, 1);
	assert.equal(notifications[0].level, "info");
	assert.match(notifications[0].message, /PID 4321/);
	assert.match(notifications[0].message, /提交并推送完成/);
});

test("canceling the optional core-standard prompt never starts a child process", async () => {
	let runCount = 0;
	const operation = createCommitOperation({
		discoverAgents: () => [],
		async runAgent() {
			runCount++;
			return successfulResult();
		},
	});
	const { ctx, notifications, statuses } = createUiContext(undefined);

	await operation.handle(poisonParentApi as any, ctx);

	assert.equal(runCount, 0);
	assert.deepEqual(statuses, []);
	assert.deepEqual(notifications, [{ message: "Git commit cancelled", level: "info" }]);
});

test("unknown-agent, spawn, and non-zero failures are reported without leaving stale UI status", async (t) => {
	const failures: Array<{ name: string; result: CommitAgentRunResult; expected: RegExp }> = [
		{
			name: "unknown agent",
			result: successfulResult({ exitCode: 1, failed: true, output: 'Unknown agent: "Missing"', pid: undefined }),
			expected: /Unknown agent/,
		},
		{
			name: "spawn failure",
			result: successfulResult({ exitCode: 1, failed: true, output: "Failed to start Pi subprocess", pid: undefined }),
			expected: /Failed to start Pi subprocess/,
		},
		{
			name: "non-zero exit",
			result: successfulResult({ exitCode: 2, failed: true, output: "git push failed" }),
			expected: /git push failed/,
		},
	];

	for (const failure of failures) {
		await t.test(failure.name, async () => {
			const operation = createCommitOperation({
				discoverAgents: () => [],
				async runAgent() {
					return failure.result;
				},
			});
			const { ctx, notifications, statuses } = createUiContext("");

			await operation.handle(poisonParentApi as any, ctx, { extraInstructions: "提交" });

			assert.equal(notifications.at(-1)?.level, "error");
			assert.match(notifications.at(-1)?.message ?? "", failure.expected);
			assert.deepEqual(statuses.at(-1), { key: "git-commit", value: undefined });
		});
	}
});

test("an aborted isolated runner is reported and always clears UI status", async () => {
	const operation = createCommitOperation({
		discoverAgents: () => [],
		async runAgent() {
			throw new Error("Subagent was aborted");
		},
	});
	const { ctx, notifications, statuses } = createUiContext("");

	await operation.handle(poisonParentApi as any, ctx, { extraInstructions: "提交" });

	assert.equal(notifications.at(-1)?.level, "error");
	assert.match(notifications.at(-1)?.message ?? "", /Subagent was aborted/);
	assert.deepEqual(statuses.at(-1), { key: "git-commit", value: undefined });
});

test("headless mode reports progress and completion only through the injected stderr writer", async () => {
	const output: string[] = [];
	const operation = createCommitOperation({
		discoverAgents: () => [],
		async runAgent(_ctx, options) {
			assert.equal(options.cwd, "C:\\repo");
			return successfulResult({ pid: undefined });
		},
		writeHeadless: (message) => output.push(message),
	});
	const ctx: any = { hasUI: false, cwd: "C:\\repo" };

	await operation.handle(poisonParentApi as any, ctx);

	assert.equal(output.length, 2);
	assert.match(output[0], /正在独立 Pi 子进程/);
	assert.match(output[1], /提交并推送完成/);
});

test("agent completions preserve the existing command syntax", () => {
	const operation = createCommitOperation({
		discoverAgents: () => [{ name: "General" }, { name: "Explore" }],
		async runAgent() {
			return successfulResult();
		},
	});

	assert.deepEqual(operation.getCompletions("commit gen"), [
		{
			value: "commit General",
			label: "General",
			description: "使用 General 子 agent 执行提交",
		},
	]);
});

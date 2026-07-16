import assert from "node:assert/strict";
import { test } from "node:test";

import {
	buildCommitRunView,
	createCommitOperation,
	type CommitAgentRunOptions,
	type CommitAgentRunResult,
	type GitCommitRunEntryData,
} from "../commit-operation.ts";

function successfulResult(overrides: Partial<CommitAgentRunResult> = {}): CommitAgentRunResult {
	return {
		agent: "General",
		exitCode: 0,
		output: "提交并推送完成",
		stderr: "",
		failed: false,
		pid: 4321,
		status: "completed",
		model: "openai-codex/gpt-5.3-codex-spark",
		startedAt: 1_000,
		endedAt: 4_000,
		...overrides,
	};
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

async function settleBackground(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
}

interface WidgetCall {
	key: string;
	content: unknown;
	options?: unknown;
}

function createUiContext(input: string | undefined) {
	const notifications: Array<{ message: string; level?: string }> = [];
	const statuses: Array<{ key: string; value: unknown }> = [];
	const widgets: WidgetCall[] = [];
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
			setWidget(key: string, content: unknown, options?: unknown) {
				widgets.push({ key, content, options });
			},
		},
	};
	return { ctx, notifications, statuses, widgets };
}

const poisonParentApi = new Proxy(
	{},
	{
		get(_target, property) {
			throw new Error(`Parent Pi API must not be accessed: ${String(property)}`);
		},
	},
);

test("/git commit starts an isolated background run and resolves before the run completes", async () => {
	const run = deferred<CommitAgentRunResult>();
	const calls: CommitAgentRunOptions[] = [];
	const stderr: string[] = [];
	const operation = createCommitOperation({
		discoverAgents: () => [{ name: "General" }],
		runAgent(_ctx, options) {
			calls.push(options);
			return run.promise;
		},
		writeHeadless: (message) => stderr.push(message),
	});
	const { ctx, notifications, statuses, widgets } = createUiContext("");

	await operation.handle(poisonParentApi as any, ctx, {
		agent: "General",
		extraInstructions: "只提交 Pi 扩展",
	});

	assert.equal(calls.length, 1);
	assert.equal(calls[0].agent, "General");
	assert.equal(calls[0].agentScope, "project");
	assert.equal(calls[0].cwd, ctx.cwd);
	assert.equal(typeof calls[0].onUpdate, "function");
	assert.match(calls[0].task, /只提交 Pi 扩展/);
	assert.match(calls[0].task, /独立 Pi 进程中的主 agent/);
	assert.match(calls[0].task, /子仓库优先原则/);
	assert.equal(notifications.length, 0);

	calls[0].onUpdate?.({
		agent: "General",
		status: "running",
		pid: 4321,
		model: "openai-codex/gpt-5.3-codex-spark",
		startedAt: 1_000,
	});
	assert.ok(widgets.some((call) => Array.isArray(call.content)));
	assert.match(String(statuses.find((item) => String(item.value).includes("pid=4321"))?.value), /pid=4321/);

	run.resolve(successfulResult());
	await settleBackground();

	assert.deepEqual(widgets.at(-1), { key: "git-commit-isolated-process", content: undefined, options: undefined });
	assert.deepEqual(statuses.at(-1), { key: "git-commit", value: undefined });
	assert.equal(notifications.at(-1)?.level, "info");
	assert.match(notifications.at(-1)?.message ?? "", /Git commit 已完成/);
	assert.match(notifications.at(-1)?.message ?? "", /PID 4321/);
	assert.match(stderr.at(-1) ?? "", /提交并推送完成/);
});

test("canceling the optional core-standard prompt notifies without starting a process", async () => {
	let runCount = 0;
	const operation = createCommitOperation({
		discoverAgents: () => [],
		async runAgent() {
			runCount++;
			return successfulResult();
		},
	});
	const { ctx, notifications, statuses, widgets } = createUiContext(undefined);

	await operation.handle(poisonParentApi as any, ctx);

	assert.equal(runCount, 0);
	assert.deepEqual(statuses, []);
	assert.deepEqual(widgets, []);
	assert.equal(notifications.length, 1);
	assert.match(notifications[0].message, /已取消/);
});

test("a second /git commit only reports the active background run", async () => {
	const run = deferred<CommitAgentRunResult>();
	let runCount = 0;
	const operation = createCommitOperation({
		discoverAgents: () => [],
		runAgent(_ctx, options) {
			runCount++;
			options.onUpdate?.({ agent: "General", status: "running", pid: 1111, startedAt: 1_000 });
			return run.promise;
		},
	});
	const first = createUiContext("");
	const second = createUiContext("");

	await operation.handle(poisonParentApi as any, first.ctx, { extraInstructions: "提交" });
	await operation.handle(poisonParentApi as any, second.ctx, { extraInstructions: "提交" });

	assert.equal(runCount, 1);
	assert.equal(second.notifications.length, 1);
	assert.match(second.notifications[0].message, /已有 Git commit 后台任务运行中/);
	assert.match(second.notifications[0].message, /PID 1111/);

	run.resolve(successfulResult({ pid: 1111 }));
	await settleBackground();
});

test("unknown-agent, spawn, and non-zero failures notify errors and leave no stale UI", async (t) => {
	const failures: Array<{ name: string; result: CommitAgentRunResult; expected: RegExp }> = [
		{
			name: "unknown agent",
			result: successfulResult({
				exitCode: 1,
				failed: true,
				status: "failed",
				output: 'Unknown agent: "Missing"',
				pid: undefined,
				startedAt: undefined,
				endedAt: undefined,
			}),
			expected: /Unknown agent/,
		},
		{
			name: "spawn failure",
			result: successfulResult({
				exitCode: 1,
				failed: true,
				status: "failed",
				output: "Failed to start Pi subprocess",
				pid: undefined,
			}),
			expected: /Failed to start Pi subprocess/,
		},
		{
			name: "non-zero exit",
			result: successfulResult({ exitCode: 2, failed: true, status: "failed", output: "git push failed" }),
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
			const { ctx, notifications, statuses, widgets } = createUiContext("");

			await operation.handle(poisonParentApi as any, ctx, { extraInstructions: "提交" });
			await settleBackground();

			assert.equal(notifications.at(-1)?.level, "error");
			assert.match(notifications.at(-1)?.message ?? "", failure.expected);
			assert.deepEqual(statuses.at(-1), { key: "git-commit", value: undefined });
			assert.deepEqual(widgets.at(-1), {
				key: "git-commit-isolated-process",
				content: undefined,
				options: undefined,
			});
		});
	}
});

test("sync startup failures are caught by the background command path", async () => {
	const output: string[] = [];
	const operation = createCommitOperation({
		discoverAgents: () => [],
		runAgent() {
			throw new Error("spawn EACCES");
		},
		writeHeadless: (message) => output.push(message),
	});
	const { ctx, notifications, statuses, widgets } = createUiContext("");

	await operation.handle(poisonParentApi as any, ctx, { extraInstructions: "提交" });

	assert.equal(notifications.at(-1)?.level, "error");
	assert.match(notifications.at(-1)?.message ?? "", /spawn EACCES/);
	assert.match(output.at(-1) ?? "", /spawn EACCES/);
	assert.deepEqual(statuses.at(-1), { key: "git-commit", value: undefined });
	assert.equal(widgets.at(-1)?.content, undefined);
});

test("an aborted isolated runner is notified as cancelled and retains lifecycle PID", async () => {
	const operation = createCommitOperation({
		discoverAgents: () => [],
		async runAgent(_ctx, options) {
			options.onUpdate?.({ agent: "General", status: "running", pid: 9876, startedAt: 2_000 });
			throw new Error("Subagent was aborted");
		},
	});
	const { ctx, notifications, statuses, widgets } = createUiContext("");

	await operation.handle(poisonParentApi as any, ctx, { extraInstructions: "提交" });
	await settleBackground();

	assert.equal(notifications.at(-1)?.level, "info");
	assert.match(notifications.at(-1)?.message ?? "", /已取消/);
	assert.match(notifications.at(-1)?.message ?? "", /PID 9876/);
	assert.deepEqual(statuses.at(-1), { key: "git-commit", value: undefined });
	assert.equal(widgets.at(-1)?.content, undefined);
});

test("headless mode uses stderr only and never accesses the parent Pi API", async () => {
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
	await settleBackground();

	assert.equal(output.length, 2);
	assert.match(output[0], /独立 Pi 进程的主 agent/);
	assert.match(output[1], /提交并推送完成/);
});

function successfulEntryData(overrides: Partial<GitCommitRunEntryData> = {}): GitCommitRunEntryData {
	return {
		version: 1,
		status: "completed",
		agent: "General",
		cwd: "D:\\work\\repo",
		output: "第一行\n第二行\n第三行\n第四行",
		pid: 4321,
		model: "openai-codex/gpt-5.3-codex-spark",
		exitCode: 0,
		startedAt: 1_000,
		endedAt: 4_000,
		durationMs: 3_000,
		...overrides,
	};
}

test("the legacy result view still exposes collapsed and expanded output with terminal-state colors", () => {
	const completed = buildCommitRunView(successfulEntryData());
	assert.equal(completed.background, "toolSuccessBg");
	assert.equal(completed.title, "git commit");
	assert.equal(completed.isolationLabel, "独立 Pi 主 agent · 不进入父上下文");
	assert.doesNotMatch(completed.outputPreview, /第四行/);
	assert.match(completed.output, /第四行/);
	assert.equal(completed.outputTruncated, true);

	const failed = buildCommitRunView(
		successfulEntryData({ status: "failed", exitCode: 1, output: "push failed" }),
	);
	assert.equal(failed.background, "toolErrorBg");

	const cancelled = buildCommitRunView(
		successfulEntryData({ status: "cancelled", exitCode: undefined, output: "cancelled" }),
	);
	assert.equal(cancelled.background, "toolPendingBg");
});

test("agent completions preserve the command syntax and identify the independent main agent", () => {
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
			description: "使用 General 独立 Pi 主 agent 执行提交",
		},
	]);
});

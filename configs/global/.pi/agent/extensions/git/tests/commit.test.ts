import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import {
	buildCommitRunView,
	createCommitOperation,
	GIT_COMMIT_RUN_ENTRY_TYPE,
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

interface WidgetCall {
	key: string;
	content: unknown;
	options?: unknown;
}

function createUiContext(input: string | undefined) {
	const statuses: Array<{ key: string; value: unknown }> = [];
	const widgets: WidgetCall[] = [];
	const ctx: any = {
		hasUI: true,
		cwd: "D:\\work\\repo",
		ui: {
			async input() {
				return input;
			},
			notify() {
				throw new Error("/git commit must not use chat notifications");
			},
			setStatus(key: string, value: unknown) {
				statuses.push({ key, value });
			},
			setWidget(key: string, content: unknown, options?: unknown) {
				widgets.push({ key, content, options });
			},
		},
	};
	return { ctx, statuses, widgets };
}

function createParentApi(options: { failAppend?: boolean } = {}) {
	const entries: Array<{ customType: string; data: GitCommitRunEntryData }> = [];
	const allowed = {
		appendEntry(customType: string, data: GitCommitRunEntryData) {
			if (options.failAppend) throw new Error("session is read-only");
			entries.push({ customType, data });
		},
	};
	const api = new Proxy(allowed, {
		get(target, property, receiver) {
			if (property === "appendEntry") return Reflect.get(target, property, receiver);
			throw new Error(`Parent Pi API must not be accessed: ${String(property)}`);
		},
	});
	return { api: api as any, entries };
}

const poisonParentApi = new Proxy(
	{},
	{
		get(_target, property) {
			throw new Error(`Parent Pi API must not be accessed: ${String(property)}`);
		},
	},
);

test("/git commit calls the isolated runner and appends only one context-free result entry", async () => {
	const calls: CommitAgentRunOptions[] = [];
	const operation = createCommitOperation({
		discoverAgents: () => [{ name: "General" }],
		async runAgent(_ctx, options) {
			calls.push(options);
			options.onUpdate?.({
				agent: "General",
				status: "running",
				pid: 4321,
				model: "openai-codex/gpt-5.3-codex-spark",
				startedAt: 1_000,
			});
			return successfulResult();
		},
	});
	const { ctx, statuses, widgets } = createUiContext("");
	const { api, entries } = createParentApi();

	await operation.handle(api, ctx, {
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

	assert.equal(entries.length, 1);
	assert.equal(entries[0].customType, GIT_COMMIT_RUN_ENTRY_TYPE);
	assert.deepEqual(entries[0].data, {
		version: 1,
		status: "completed",
		agent: "General",
		cwd: ctx.cwd,
		output: "提交并推送完成",
		pid: 4321,
		model: "openai-codex/gpt-5.3-codex-spark",
		exitCode: 0,
		startedAt: 1_000,
		endedAt: 4_000,
		durationMs: 3_000,
		errorMessage: undefined,
	});
	assert.ok(widgets.some((call) => Array.isArray(call.content)));
	assert.deepEqual(widgets.at(-1), { key: "git-commit-isolated-process", content: undefined, options: undefined });
	assert.match(String(statuses.find((item) => String(item.value).includes("pid=4321"))?.value), /pid=4321/);
	assert.deepEqual(statuses.at(-1), { key: "git-commit", value: undefined });
});

test("canceling the optional core-standard prompt records cancellation without starting a process", async () => {
	let runCount = 0;
	const operation = createCommitOperation({
		discoverAgents: () => [],
		async runAgent() {
			runCount++;
			return successfulResult();
		},
	});
	const { ctx, statuses, widgets } = createUiContext(undefined);
	const { api, entries } = createParentApi();

	await operation.handle(api, ctx);

	assert.equal(runCount, 0);
	assert.deepEqual(statuses, []);
	assert.deepEqual(widgets, []);
	assert.equal(entries.length, 1);
	assert.equal(entries[0].data.status, "cancelled");
	assert.match(entries[0].data.output, /未启动独立 Pi 进程/);
});

test("unknown-agent, spawn, and non-zero failures leave one failed record and no stale UI", async (t) => {
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
			const { ctx, statuses, widgets } = createUiContext("");
			const { api, entries } = createParentApi();

			await operation.handle(api, ctx, { extraInstructions: "提交" });

			assert.equal(entries.length, 1);
			assert.equal(entries[0].data.status, "failed");
			assert.match(entries[0].data.output, failure.expected);
			assert.deepEqual(statuses.at(-1), { key: "git-commit", value: undefined });
			assert.deepEqual(widgets.at(-1), {
				key: "git-commit-isolated-process",
				content: undefined,
				options: undefined,
			});
		});
	}
});

test("an aborted isolated runner is stored as cancelled and retains lifecycle PID", async () => {
	const operation = createCommitOperation({
		discoverAgents: () => [],
		async runAgent(_ctx, options) {
			options.onUpdate?.({ agent: "General", status: "running", pid: 9876, startedAt: 2_000 });
			throw new Error("Subagent was aborted");
		},
	});
	const { ctx, statuses, widgets } = createUiContext("");
	const { api, entries } = createParentApi();

	await operation.handle(api, ctx, { extraInstructions: "提交" });

	assert.equal(entries.length, 1);
	assert.equal(entries[0].data.status, "cancelled");
	assert.equal(entries[0].data.pid, 9876);
	assert.match(entries[0].data.output, /Subagent was aborted/);
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

	assert.equal(output.length, 2);
	assert.match(output[0], /独立 Pi 进程的主 agent/);
	assert.match(output[1], /提交并推送完成/);
});

test("appendEntry failure falls back to a pure UI result box and stderr", async () => {
	const output: string[] = [];
	const operation = createCommitOperation({
		discoverAgents: () => [],
		async runAgent() {
			return successfulResult();
		},
		writeHeadless: (message) => output.push(message),
	});
	const { ctx, widgets } = createUiContext("");
	const { api } = createParentApi({ failAppend: true });

	await operation.handle(api, ctx, { extraInstructions: "提交" });

	assert.ok(Array.isArray(widgets.at(-1)?.content));
	assert.match(output.at(-1) ?? "", /结果记录写入失败/);
});

async function loadInstalledSessionEntryConverter(): Promise<(entry: unknown) => unknown[]> {
	const appData = process.env.APPDATA;
	if (!appData) throw new Error("APPDATA is required to locate the installed Pi package");
	const entryPath = path.join(
		appData,
		"npm",
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
		"dist",
		"index.js",
	);
	if (!fs.existsSync(entryPath)) throw new Error(`Installed Pi package not found: ${entryPath}`);
	const module = await import(pathToFileURL(entryPath).href);
	return module.sessionEntryToContextMessages;
}

test("custom Git result entries never participate in LLM context", async () => {
	const sessionEntryToContextMessages = await loadInstalledSessionEntryConverter();
	const userEntry: any = {
		type: "message",
		id: "user-1",
		parentId: null,
		timestamp: "2026-07-16T00:00:00.000Z",
		message: {
			role: "user",
			content: [{ type: "text", text: "保留这条消息" }],
			timestamp: 1,
		},
	};
	const customEntry: any = {
		type: "custom",
		id: "git-1",
		parentId: "user-1",
		timestamp: "2026-07-16T00:00:01.000Z",
		customType: GIT_COMMIT_RUN_ENTRY_TYPE,
		data: successfulEntryData(),
	};

	const before = [userEntry].flatMap(sessionEntryToContextMessages);
	const after = [userEntry, customEntry].flatMap(sessionEntryToContextMessages);

	assert.deepEqual(sessionEntryToContextMessages(customEntry), []);
	assert.deepEqual(after, before);
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

test("the result view exposes collapsed and expanded output with terminal-state colors", () => {
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

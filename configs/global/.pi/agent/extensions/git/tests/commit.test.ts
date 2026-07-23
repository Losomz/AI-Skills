import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentConfig } from "../../subagent/agents.ts";
import type {
	AgentProcessOptions,
	AgentProcessResult,
	AgentProcessUpdate,
} from "../../subagent/agent-runner.ts";
import { buildCommitTask, createCommitOperation, extractCommitBrief } from "../commit-operation.ts";

const EMPTY_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };

function agentConfig(name = "General"): AgentConfig {
	return {
		name,
		description: "test agent",
		model: "openai-codex/gpt-5.3-codex-spark",
		thinkingLevel: "low",
		tools: ["read", "bash"],
		systemPrompt: "General base prompt",
		source: "project",
		filePath: `agents/${name}.md`,
	};
}

function successfulResult(overrides: Partial<AgentProcessResult> = {}): AgentProcessResult {
	return {
		runId: "General-test",
		agent: "General",
		status: "completed",
		model: "openai-codex/gpt-5.3-codex-spark",
		startedAt: 1_000,
		endedAt: 4_000,
		messages: [],
		usage: { ...EMPTY_USAGE },
		exitCode: 0,
		output: "提交：\n- 主仓库：✨ feat: 示例改动 · 7b8c9d0 · push origin/main 成功\n状态：1/1 commit 成功；1/1 push 成功",
		stderr: "",
		failed: false,
		pid: 4321,
		...overrides,
	};
}

function runningUpdate(overrides: Partial<AgentProcessUpdate> = {}): AgentProcessUpdate {
	return {
		runId: "General-test",
		agent: "General",
		status: "running",
		model: "openai-codex/gpt-5.3-codex-spark",
		startedAt: Date.now(),
		messages: [],
		usage: { ...EMPTY_USAGE },
		exitCode: 0,
		output: "",
		stderr: "",
		failed: false,
		pid: 9876,
		...overrides,
	};
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

async function settleBackground(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
}

function createUiContext(input: string | undefined) {
	const notifications: Array<{ message: string; level?: string }> = [];
	const widgets: Array<{ key: string; content: unknown; options?: unknown }> = [];
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
			setWidget(key: string, content: unknown, options?: unknown) {
				widgets.push({ key, content, options });
			},
			setStatus() {
				throw new Error("Git commit must not use the status bar");
			},
		},
	};
	return { ctx, notifications, widgets };
}

const poisonParentApi = new Proxy(
	{},
	{
		get(_target, property) {
			throw new Error(`Parent Pi API must not be accessed: ${String(property)}`);
		},
	},
);

function createDependencies(runAgentProcess: (options: AgentProcessOptions) => Promise<AgentProcessResult>) {
	const general = agentConfig();
	return {
		discoverAgents: () => [general],
		findAgentByName: (agents: AgentConfig[], name: string) => agents.find((agent) => agent.name.toLowerCase() === name.toLowerCase()),
		runAgentProcess,
		loadPromptTemplate: () => "执行 Git 提交。\n\n核心要求：{{CORE_STANDARD}}",
	};
}

test("Git prompt template injects the core standard and rejects an invalid template", () => {
	assert.equal(
		buildCommitTask("只提交文档", "任务：{{CORE_STANDARD}}"),
		"任务：只提交文档",
	);
	assert.match(buildCommitTask("", "任务：{{CORE_STANDARD}}"), /无额外要求/);
	assert.throws(() => buildCommitTask("x", "missing placeholder"), /CORE_STANDARD/);
});

test("extractCommitBrief parses structured lists, no-change, and falls back", () => {
	const multiRepo = [
		"一些前置说明，",
		"提交：",
		"- 子仓库 packages/core：🐛 fix(core): 修复配置 · a1b2c3d · push origin/main 成功",
		"- 主仓库：🔧 chore: 更新子仓库引用 · 7b8c9d0 · push origin/main 成功",
		"状态：2/2 commit 成功；2/2 push 成功",
		"(不应被包含的尾部内容)",
	].join("\n");
	assert.equal(
		extractCommitBrief(multiRepo),
		[
			"提交：",
			"- 子仓库 packages/core：🐛 fix(core): 修复配置 · a1b2c3d · push origin/main 成功",
			"- 主仓库：🔧 chore: 更新子仓库引用 · 7b8c9d0 · push origin/main 成功",
			"状态：2/2 commit 成功；2/2 push 成功",
		].join("\n"),
	);

	assert.equal(
		extractCommitBrief("提交：无可提交内容\n状态：未创建 commit；未执行 push"),
		"提交：无可提交内容\n状态：未创建 commit；未执行 push",
	);

	assert.equal(extractCommitBrief("仅一段普通总结"), "仅一段普通总结");
	assert.equal(extractCommitBrief(""), "(no output)");
});

test("/git commit passes the complete General profile and returns before the background run", async () => {
	const run = deferred<AgentProcessResult>();
	let captured: AgentProcessOptions | undefined;
	const stderr: string[] = [];
	const operation = createCommitOperation({
		...createDependencies((options) => {
			captured = options;
			return run.promise;
		}),
		writeHeadless: (message) => stderr.push(message),
	});
	const { ctx, notifications, widgets } = createUiContext(undefined);

	await operation.handle(poisonParentApi as never, ctx, "General 只提交文档");

	assert.ok(captured);
	assert.equal(captured.profile.name, "General");
	assert.equal(captured.profile.model, "openai-codex/gpt-5.3-codex-spark");
	assert.equal(captured.profile.thinkingLevel, "low");
	assert.deepEqual(captured.profile.tools, ["read", "bash"]);
	assert.equal(captured.profile.systemPrompt, "General base prompt");
	assert.equal(captured.cwd, ctx.cwd);
	assert.match(captured.task, /General 只提交文档/);
	assert.equal(notifications.length, 0);
	assert.match(String(widgets.at(-1)?.content), /General.*PID 启动中/);

	captured.onUpdate?.(runningUpdate());
	assert.match(String(widgets.at(-1)?.content), /PID 9876/);

	run.resolve(successfulResult({ pid: 9876 }));
	await settleBackground();
	assert.equal(widgets.at(-1)?.content, undefined);
	assert.equal(notifications.at(-1)?.level, "info");
	assert.match(notifications.at(-1)?.message ?? "", /Git commit 已完成.*PID 9876/);
	assert.match(notifications.at(-1)?.message ?? "", /- 主仓库：✨ feat: 示例改动/);
	assert.match(notifications.at(-1)?.message ?? "", /状态：1\/1 commit 成功；1\/1 push 成功/);
	assert.deepEqual(stderr, []);
});

test("canceling the optional core-standard input does not start a process", async () => {
	let starts = 0;
	const operation = createCommitOperation(createDependencies(async () => {
		starts++;
		return successfulResult();
	}));
	const { ctx, notifications, widgets } = createUiContext(undefined);

	await operation.handle(poisonParentApi as never, ctx);

	assert.equal(starts, 0);
	assert.match(notifications.at(-1)?.message ?? "", /已取消/);
	assert.equal(widgets.length, 0);
});

test("missing General or an invalid prompt template fails before process startup", async (t) => {
	await t.test("missing General", async () => {
		let starts = 0;
		const operation = createCommitOperation({
			discoverAgents: () => [],
			findAgentByName: () => undefined,
			async runAgentProcess() {
				starts++;
				return successfulResult();
			},
		});
		const { ctx, notifications } = createUiContext("ignored");
		await operation.handle(poisonParentApi as never, ctx, "提交");
		assert.equal(starts, 0);
		assert.equal(notifications.at(-1)?.level, "error");
		assert.match(notifications.at(-1)?.message ?? "", /未找到 General profile/);
	});

	await t.test("invalid template", async () => {
		let starts = 0;
		const operation = createCommitOperation({
			...createDependencies(async () => {
				starts++;
				return successfulResult();
			}),
			loadPromptTemplate: () => "invalid",
		});
		const { ctx, notifications } = createUiContext("ignored");
		await operation.handle(poisonParentApi as never, ctx, "提交");
		assert.equal(starts, 0);
		assert.equal(notifications.at(-1)?.level, "error");
		assert.match(notifications.at(-1)?.message ?? "", /缺少.*CORE_STANDARD/);
	});
});

test("an invalid resolved General model blocks commit before prompting or process startup", async () => {
	let starts = 0;
	let validations = 0;
	const operation = createCommitOperation({
		...createDependencies(async () => {
			starts++;
			return successfulResult();
		}),
		validateAgentProfile(profile) {
			validations++;
			assert.equal(profile.name, "General");
			return "configured model is unavailable";
		},
	});
	const { ctx, notifications, widgets } = createUiContext("must not be requested");

	await operation.handle(poisonParentApi as never, ctx, "提交");

	assert.equal(validations, 1);
	assert.equal(starts, 0);
	assert.equal(widgets.length, 0);
	assert.equal(notifications.at(-1)?.level, "error");
	assert.match(notifications.at(-1)?.message ?? "", /configured model is unavailable/);
});

test("a second /git commit reports the active PID and does not start another process", async () => {
	const run = deferred<AgentProcessResult>();
	let starts = 0;
	const operation = createCommitOperation(createDependencies(() => {
		starts++;
		return run.promise;
	}));
	const first = createUiContext("first");
	const second = createUiContext("second");

	await operation.handle(poisonParentApi as never, first.ctx, "first");
	await operation.handle(poisonParentApi as never, second.ctx, "second");

	assert.equal(starts, 1);
	assert.match(second.notifications.at(-1)?.message ?? "", /已有 Git commit 后台任务运行中/);
	run.resolve(successfulResult({ pid: 9001 }));
	await settleBackground();
});

test("startup throws, rejected promises, failed exits, and aborts all clean the widget", async (t) => {
	const cases: Array<{
		name: string;
		run: (options: AgentProcessOptions) => Promise<AgentProcessResult>;
		level: "info" | "error";
		pattern: RegExp;
	}> = [
		{
			name: "synchronous startup throw",
			run: (() => { throw new Error("spawn EACCES"); }) as (options: AgentProcessOptions) => Promise<AgentProcessResult>,
			level: "error",
			pattern: /spawn EACCES/,
		},
		{
			name: "background rejection",
			run: async () => { throw new Error("runner rejected"); },
			level: "error",
			pattern: /runner rejected/,
		},
		{
			name: "non-zero exit",
			run: async () => successfulResult({ status: "failed", failed: true, exitCode: 2, output: "git push failed" }),
			level: "error",
			pattern: /git push failed/,
		},
		{
			name: "aborted run",
			run: async () => successfulResult({ status: "aborted", failed: true, exitCode: 1, output: "aborted" }),
			level: "info",
			pattern: /已取消/,
		},
	];

	for (const item of cases) {
		await t.test(item.name, async () => {
			const stderr: string[] = [];
			const operation = createCommitOperation({
				...createDependencies(item.run),
				writeHeadless: (message) => stderr.push(message),
			});
			const { ctx, notifications, widgets } = createUiContext("ignored");
			await operation.handle(poisonParentApi as never, ctx, "提交");
			await settleBackground();
			assert.equal(widgets.at(-1)?.content, undefined);
			assert.equal(notifications.at(-1)?.level, item.level);
			assert.match(notifications.at(-1)?.message ?? "", item.pattern);
			if (item.level === "error") assert.ok(stderr.length > 0);
		});
	}
});

test("headless mode writes startup and completion to stderr without a UI object", async () => {
	const output: string[] = [];
	const operation = createCommitOperation({
		...createDependencies(async () => successfulResult({ pid: 111 })),
		writeHeadless: (message) => output.push(message),
	});
	const ctx: any = { hasUI: false, cwd: "C:\\repo" };

	await operation.handle(poisonParentApi as never, ctx, "");
	await settleBackground();

	assert.equal(output.length, 2);
	assert.match(output[0], /Git commit 已启动 · General/);
	assert.match(output[1], /Git commit 已完成[\s\S]*1\/1 push 成功/);
});

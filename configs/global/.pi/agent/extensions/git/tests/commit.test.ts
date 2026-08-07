import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	PiProcessOptions,
	PiProcessResult,
	PiProcessUpdate,
} from "../../shared/pi-process-runner.ts";
import { buildCommitTask, createCommitOperation, extractCommitBrief } from "../commit-operation.ts";

const EMPTY_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };

function successfulResult(overrides: Partial<PiProcessResult> = {}): PiProcessResult {
	return {
		runId: "GitCommit-test",
		name: "GitCommit",
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

function runningUpdate(overrides: Partial<PiProcessUpdate> = {}): PiProcessUpdate {
	return {
		runId: "GitCommit-test",
		name: "GitCommit",
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

function createUiContext(input: string | undefined | Promise<string | undefined>) {
	const notifications: Array<{ message: string; level?: string }> = [];
	const widgets: Array<{ key: string; content: unknown; options?: unknown }> = [];
	const ctx: any = {
		hasUI: true,
		cwd: "D:\\work\\repo",
		model: { provider: "openai-codex", id: "gpt-5.3-codex-spark" },
		thinkingLevel: "low",
		modelRegistry: {
			getProviderAuthStatus() {
				return { configured: true, source: "stored" };
			},
		},
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

function createDependencies(runPiProcess: (options: PiProcessOptions) => Promise<PiProcessResult>) {
	return {
		runPiProcess,
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

test("/git commit starts a dedicated Pi process without a General profile dependency", async () => {
	const run = deferred<PiProcessResult>();
	let captured: PiProcessOptions | undefined;
	const stderr: string[] = [];
	const operation = createCommitOperation({
		...createDependencies((options) => {
			captured = options;
			return run.promise;
		}),
		writeHeadless: (message) => stderr.push(message),
	});
	const { ctx, notifications, widgets } = createUiContext(undefined);

	await operation.handle(poisonParentApi as never, ctx, "只提交文档");

	assert.ok(captured);
	assert.equal(captured.config.name, "GitCommit");
	assert.equal(captured.config.model, "openai-codex/gpt-5.3-codex-spark");
	assert.equal(captured.config.thinkingLevel, "low");
	assert.deepEqual(captured.config.tools, ["read", "bash"]);
	assert.equal(captured.config.systemPrompt, "");
	assert.equal(captured.cwd, ctx.cwd);
	assert.match(captured.task, /只提交文档/);
	assert.equal(notifications.length, 0);
	assert.match(String(widgets.at(-1)?.content), /GitCommit.*PID 启动中/);

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

test("an invalid prompt template fails before process startup", async () => {
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

test("/git commit falls back to child Pi defaults when the parent has no model or thinking level", async () => {
	let captured: PiProcessOptions | undefined;
	const operation = createCommitOperation(createDependencies(async (options) => {
		captured = options;
		return successfulResult();
	}));
	const { ctx } = createUiContext("ignored");
	ctx.model = undefined;
	ctx.thinkingLevel = undefined;

	await operation.handle(poisonParentApi as never, ctx, "提交");
	await settleBackground();

	assert.ok(captured);
	assert.equal(captured.config.model, undefined);
	assert.equal(captured.config.thinkingLevel, undefined);
});

test("a parent-only runtime credential blocks startup without consulting Subagent configuration", async () => {
	let starts = 0;
	const operation = createCommitOperation(createDependencies(async () => {
		starts++;
		return successfulResult();
	}));
	const { ctx, notifications } = createUiContext("must not be requested");
	ctx.modelRegistry.getProviderAuthStatus = () => ({ configured: true, source: "runtime" });

	await operation.handle(poisonParentApi as never, ctx, "提交");

	assert.equal(starts, 0);
	assert.equal(notifications.at(-1)?.level, "error");
	assert.match(notifications.at(-1)?.message ?? "", /临时运行时凭据.*无法继承/);
});

test("a second /git commit reports the active PID and does not start another process", async () => {
	const run = deferred<PiProcessResult>();
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
	assert.match(second.notifications.at(-1)?.message ?? "", /已有 Git commit 后台任务正在准备或运行/);
	run.resolve(successfulResult({ pid: 9001 }));
	await settleBackground();
});

test("the single-run guard covers asynchronous input preparation", async () => {
	const input = deferred<string | undefined>();
	const run = deferred<PiProcessResult>();
	let starts = 0;
	const operation = createCommitOperation(createDependencies(() => {
		starts++;
		return run.promise;
	}));
	const first = createUiContext(input.promise);
	const second = createUiContext("second");

	const firstHandle = operation.handle(poisonParentApi as never, first.ctx);
	await settleBackground();
	await operation.handle(poisonParentApi as never, second.ctx, "second");

	assert.equal(starts, 0);
	assert.match(second.notifications.at(-1)?.message ?? "", /正在准备或运行/);

	input.resolve("first");
	await firstHandle;
	assert.equal(starts, 1);
	run.resolve(successfulResult());
	await settleBackground();
});

test("startup throws, rejected promises, failed exits, and aborts all clean the widget", async (t) => {
	const cases: Array<{
		name: string;
		run: (options: PiProcessOptions) => Promise<PiProcessResult>;
		level: "info" | "error";
		pattern: RegExp;
	}> = [
		{
			name: "synchronous startup throw",
			run: (() => { throw new Error("spawn EACCES"); }) as (options: PiProcessOptions) => Promise<PiProcessResult>,
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
	assert.match(output[0], /Git commit 已启动 · GitCommit/);
	assert.match(output[1], /Git commit 已完成[\s\S]*1\/1 push 成功/);
});

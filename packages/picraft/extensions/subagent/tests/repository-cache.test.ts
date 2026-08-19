import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getScoutRepositoryPath } from "../../shared/scout-cache-paths.ts";
import { ensureScoutRepository, type ScoutGitExecOptions, type ScoutGitExecResult } from "../repository-cache.ts";

interface FixtureMetadata {
	origin: string;
	branch: string;
	head: string;
}

function result(stdout = "", stderr = "", code = 0, killed = false): ScoutGitExecResult {
	return { stdout, stderr, code, killed };
}

function logicalGitArgs(args: string[]): string[] {
	let index = 0;
	while (args[index] === "-c") index += 2;
	return args.slice(index);
}

class FixtureGit {
	readonly calls: Array<{ args: string[]; rawArgs: string[]; options?: ScoutGitExecOptions }> = [];
	defaultBranch = "main";
	nextHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
	failFetch = false;
	blockClone = false;
	blockOnceOperation?: string;
	cloneGate?: () => Promise<void>;

	private metadataPath(cwd: string): string {
		return path.join(cwd, ".git", "scout-fixture.json");
	}

	private readMetadata(cwd: string): FixtureMetadata {
		return JSON.parse(fs.readFileSync(this.metadataPath(cwd), "utf8")) as FixtureMetadata;
	}

	private writeMetadata(cwd: string, metadata: FixtureMetadata): void {
		fs.writeFileSync(this.metadataPath(cwd), `${JSON.stringify(metadata)}\n`, "utf8");
	}

	async execute(command: string, rawArgs: string[], options?: ScoutGitExecOptions): Promise<ScoutGitExecResult> {
		assert.equal(command, "git");
		const args = logicalGitArgs(rawArgs);
		this.calls.push({ args: [...args], rawArgs: [...rawArgs], options });
		const operation = args[0];
		if (this.blockOnceOperation === operation) {
			this.blockOnceOperation = undefined;
			return new Promise((resolve) => {
				options?.signal?.addEventListener("abort", () => resolve(result("", "cancelled", 1, true)), { once: true });
			});
		}
		if (operation === "ls-remote") {
			return result(`ref: refs/heads/${this.defaultBranch} HEAD\n${this.nextHead} HEAD\n`);
		}
		if (operation === "clone") {
			const target = args.at(-1) as string;
			await this.cloneGate?.();
			if (this.blockClone) {
				return new Promise((resolve) => {
					options?.signal?.addEventListener("abort", () => resolve(result("", "cancelled", 1, true)), { once: true });
				});
			}
			const separator = args.indexOf("--");
			const origin = args[separator + 1];
			const branchIndex = args.indexOf("--branch");
			const branch = args[branchIndex + 1];
			fs.mkdirSync(path.join(target, ".git"), { recursive: true });
			this.writeMetadata(target, { origin, branch, head: this.nextHead });
			return result();
		}

		const cwd = options?.cwd;
		assert.ok(cwd, `fixture command ${operation} requires cwd`);
		if (operation === "rev-parse" && args[1] === "--is-inside-work-tree") return result("true\n");
		if (operation === "rev-parse" && args[1] === "--show-toplevel") return result(`${path.resolve(cwd)}\n`);
		if (operation === "rev-parse" && args[1] === "--absolute-git-dir") return result(`${path.resolve(cwd, ".git")}\n`);

		const metadata = this.readMetadata(cwd);
		if (operation === "config") return result(`${metadata.origin}\n`);
		if (operation === "symbolic-ref") return result(`${metadata.branch}\n`);
		if (operation === "rev-parse" && args[1] === "--verify" && args[2] === "HEAD^{commit}") {
			return result(`${metadata.head}\n`);
		}
		if (operation === "rev-parse" && args[1] === "--verify" && args[2]?.startsWith("origin/")) {
			return result(`${this.nextHead}\n`);
		}
		if (operation === "fetch") {
			if (this.failFetch) return result("", "network unavailable\n", 1);
			return result("From fixture\n");
		}
		if (operation === "checkout") {
			this.writeMetadata(cwd, { ...metadata, branch: args[3], head: this.nextHead });
			return result();
		}
		if (operation === "reset") {
			this.writeMetadata(cwd, { ...metadata, head: args[2] });
			return result();
		}
		if (operation === "clean") return result();
		throw new Error(`Unexpected fixture git command: ${args.join(" ")}`);
	}
}

function tempCache(): { dir: string; root: string } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scout-repository-cache-test-"));
	return { dir, root: path.join(dir, "cache") };
}

function cleanup(cache: { dir: string }): void {
	fs.rmSync(cache.dir, { recursive: true, force: true });
}

const URL = "https://example.test/group/repo.git";

test("clone hardens Git, uses blob filtering, and atomically promotes a temporary checkout", async () => {
	const cache = tempCache();
	try {
		const git = new FixtureGit();
		const cloned = await ensureScoutRepository({
			url: URL,
			branch: "main",
			cacheRoot: cache.root,
			exec: git.execute.bind(git),
		});
		const expectedPath = getScoutRepositoryPath(URL, "main", cache.root);
		assert.deepEqual(cloned, { path: expectedPath, status: "cloned", head: git.nextHead, branch: "main" });
		assert.equal(fs.existsSync(path.join(expectedPath, ".git")), true);
		for (const directory of ["repos", "artifacts", ".locks", ".git-hooks-disabled"]) {
			assert.equal(fs.statSync(path.join(cache.root, directory)).isDirectory(), true);
		}
		assert.deepEqual(fs.readdirSync(path.join(cache.root, ".locks")), []);
		const clone = git.calls.find((call) => call.args[0] === "clone");
		assert.ok(clone);
		for (const option of ["--filter=blob:none", "--single-branch", "--no-tags", "--no-recurse-submodules", "--template"]) {
			assert.ok(clone.args.includes(option), option);
		}
		assert.ok(clone.rawArgs.includes("credential.interactive=false"));
		assert.ok(clone.rawArgs.some((arg) => arg.startsWith("core.hooksPath=")));
		assert.equal(fs.readdirSync(path.join(cache.root, "repos")).some((name) => name.startsWith(".scout-tmp-")), false);
	} finally {
		cleanup(cache);
	}
});

test("an exact valid checkout refreshes, cleans, and supports intentional offline reuse", async () => {
	const cache = tempCache();
	try {
		const git = new FixtureGit();
		const first = await ensureScoutRepository({ url: URL, branch: "main", cacheRoot: cache.root, exec: git.execute.bind(git) });
		assert.equal(first.status, "cloned");
		git.nextHead = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
		const refreshed = await ensureScoutRepository({ url: URL, branch: "main", cacheRoot: cache.root, exec: git.execute.bind(git) });
		assert.equal(refreshed.status, "updated");
		assert.equal(refreshed.head, git.nextHead);
		assert.ok(git.calls.some((call) => call.args[0] === "fetch"));
		assert.ok(git.calls.some((call) => call.args[0] === "reset"));
		assert.ok(git.calls.some((call) => call.args[0] === "clean"));

		const callCount = git.calls.length;
		const reused = await ensureScoutRepository({
			url: URL,
			branch: "main",
			refresh: false,
			cacheRoot: cache.root,
			exec: git.execute.bind(git),
		});
		assert.equal(reused.status, "reused");
		assert.equal(git.calls.slice(callCount).some((call) => call.args[0] === "fetch"), false);
	} finally {
		cleanup(cache);
	}
});

test("a fetch failure keeps and revalidates the existing checkout as stale", async () => {
	const cache = tempCache();
	try {
		const git = new FixtureGit();
		const first = await ensureScoutRepository({ url: URL, branch: "main", cacheRoot: cache.root, exec: git.execute.bind(git) });
		git.failFetch = true;
		const stale = await ensureScoutRepository({ url: URL, branch: "main", cacheRoot: cache.root, exec: git.execute.bind(git) });
		assert.equal(stale.status, "stale");
		assert.equal(stale.path, first.path);
		assert.equal(stale.head, first.head);
		assert.match(stale.error ?? "", /network unavailable/);
	} finally {
		cleanup(cache);
	}
});

test("default-branch checkouts use the unsuffixed path and never fall back to an arbitrary explicit branch", async () => {
	const cache = tempCache();
	try {
		const git = new FixtureGit();
		git.defaultBranch = "develop";
		const resolved = await ensureScoutRepository({ url: URL, cacheRoot: cache.root, exec: git.execute.bind(git) });
		assert.equal(resolved.status, "cloned");
		assert.equal(resolved.branch, "develop");
		assert.equal(resolved.path, getScoutRepositoryPath(URL, undefined, cache.root));
		assert.ok(git.calls.some((call) => call.args[0] === "ls-remote"));
	} finally {
		cleanup(cache);
	}
});

test("an invalid or mismatched managed checkout is removed and rebuilt", async () => {
	const cache = tempCache();
	try {
		const invalidPath = getScoutRepositoryPath(URL, "main", cache.root);
		fs.mkdirSync(path.join(invalidPath, ".git"), { recursive: true });
		fs.writeFileSync(
			path.join(invalidPath, ".git", "scout-fixture.json"),
			`${JSON.stringify({
				origin: "https://other.test/group/repo.git",
				branch: "main",
				head: "cccccccccccccccccccccccccccccccccccccccc",
			})}\n`,
			"utf8",
		);
		const git = new FixtureGit();
		const rebuilt = await ensureScoutRepository({ url: URL, branch: "main", cacheRoot: cache.root, exec: git.execute.bind(git) });
		assert.equal(rebuilt.status, "cloned");
		assert.equal(rebuilt.path, invalidPath);
		assert.ok(git.calls.some((call) => call.args[0] === "clone"));
	} finally {
		cleanup(cache);
	}
});

test("cancellation during checkout mutation restores the original branch and commit", async () => {
	for (const operationName of ["checkout", "reset", "clean"]) {
		const cache = tempCache();
		try {
			const git = new FixtureGit();
			const before = await ensureScoutRepository({
				url: URL,
				branch: "main",
				cacheRoot: cache.root,
				exec: git.execute.bind(git),
			});
			git.nextHead = "dddddddddddddddddddddddddddddddddddddddd";
			git.blockOnceOperation = operationName;
			const controller = new AbortController();
			const refreshing = ensureScoutRepository({
				url: URL,
				branch: "main",
				cacheRoot: cache.root,
				exec: git.execute.bind(git),
				signal: controller.signal,
			});
			setTimeout(() => controller.abort(), 10);
			const cancelled = await refreshing;
			assert.equal(cancelled.status, "cancelled", operationName);
			assert.equal(cancelled.head, before.head, operationName);
			assert.equal(cancelled.branch, before.branch, operationName);
			const reused = await ensureScoutRepository({
				url: URL,
				branch: "main",
				refresh: false,
				cacheRoot: cache.root,
				exec: git.execute.bind(git),
			});
			assert.equal(reused.status, "reused", operationName);
			assert.equal(reused.head, before.head, operationName);
		} finally {
			cleanup(cache);
		}
	}
});

test("different repositories do not share one global mutation lock", async () => {
	const cache = tempCache();
	let releaseClones: () => void = () => undefined;
	try {
		const git = new FixtureGit();
		let started = 0;
		let markBothStarted: () => void = () => undefined;
		const bothStarted = new Promise<void>((resolve) => {
			markBothStarted = resolve;
		});
		const release = new Promise<void>((resolve) => {
			releaseClones = resolve;
		});
		git.cloneGate = async () => {
			started++;
			if (started === 2) markBothStarted();
			await release;
		};
		const first = ensureScoutRepository({
			url: "https://example.test/group/first.git",
			branch: "main",
			cacheRoot: cache.root,
			exec: git.execute.bind(git),
		});
		const second = ensureScoutRepository({
			url: "https://example.test/group/second.git",
			branch: "main",
			cacheRoot: cache.root,
			exec: git.execute.bind(git),
		});
		await Promise.race([
			bothStarted,
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error("second repository was globally blocked")), 500)),
		]);
		releaseClones();
		assert.deepEqual((await Promise.all([first, second])).map((item) => item.status), ["cloned", "cloned"]);
	} finally {
		releaseClones();
		cleanup(cache);
	}
});

test("an abandoned repository lock is recovered only after its owner is gone", async () => {
	const cache = tempCache();
	try {
		const git = new FixtureGit();
		const logicalPath = getScoutRepositoryPath(URL, "main", cache.root);
		const comparable = process.platform === "win32" ? path.resolve(logicalPath).toLowerCase() : path.resolve(logicalPath);
		const key = createHash("sha256").update(comparable).digest("hex").slice(0, 24);
		const locks = path.join(cache.root, ".locks");
		fs.mkdirSync(locks, { recursive: true });
		const lockPath = path.join(locks, `${key}.lock`);
		fs.writeFileSync(lockPath, `${JSON.stringify({ token: "abandoned", pid: 2_147_483_647, createdAt: 0 })}\n`, "utf8");
		const old = new Date(Date.now() - 20 * 60_000);
		fs.utimesSync(lockPath, old, old);
		const recovered = await ensureScoutRepository({ url: URL, branch: "main", cacheRoot: cache.root, exec: git.execute.bind(git) });
		assert.equal(recovered.status, "cloned");
		assert.equal(fs.existsSync(lockPath), false);
	} finally {
		cleanup(cache);
	}
});

test("timeout and cancellation remove temporary clones and repository locks", async () => {
	for (const mode of ["timeout", "cancel"] as const) {
		const cache = tempCache();
		try {
			const git = new FixtureGit();
			git.blockClone = true;
			const controller = new AbortController();
			const operation = ensureScoutRepository({
				url: URL,
				branch: "main",
				cacheRoot: cache.root,
				exec: git.execute.bind(git),
				...(mode === "timeout" ? { timeoutMs: 10 } : { signal: controller.signal }),
			});
			if (mode === "cancel") setTimeout(() => controller.abort(), 10);
			const stopped = await operation;
			assert.equal(stopped.status, "cancelled");
			if (mode === "timeout") assert.equal(stopped.error, "Scout repository operation timed out");
			assert.deepEqual(fs.readdirSync(path.join(cache.root, ".locks")), []);
			assert.equal(fs.readdirSync(path.join(cache.root, "repos")).some((name) => name.startsWith(".scout-tmp-")), false);
		} finally {
			cleanup(cache);
		}
	}
});

test("managed cache creation refuses a symlinked cache component", async () => {
	const cache = tempCache();
	try {
		const outside = path.join(cache.dir, "outside");
		fs.mkdirSync(outside);
		fs.mkdirSync(cache.root);
		fs.symlinkSync(outside, path.join(cache.root, "repos"), process.platform === "win32" ? "junction" : "dir");
		const git = new FixtureGit();
		const blocked = await ensureScoutRepository({ url: URL, branch: "main", cacheRoot: cache.root, exec: git.execute.bind(git) });
		assert.equal(blocked.status, "failed");
		assert.match(blocked.error ?? "", /unsafe managed cache component/i);
		assert.deepEqual(fs.readdirSync(outside), []);
	} finally {
		cleanup(cache);
	}
});

import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import {
	getScoutCachePathsForRoot,
	getScoutCacheRoot,
	getScoutRepositoryPath,
	parseScoutRepositoryUrl,
	validateScoutBranch,
	type ScoutCachePaths,
	type ScoutRepositoryReference,
} from "../shared/scout-cache-paths.ts";

export interface ScoutGitExecOptions {
	cwd?: string;
	signal?: AbortSignal;
	timeout?: number;
}

export interface ScoutGitExecResult {
	stdout: string;
	stderr: string;
	code: number;
	killed?: boolean;
}

export type ScoutGitExecutor = (
	command: string,
	args: string[],
	options?: ScoutGitExecOptions,
) => Promise<ScoutGitExecResult>;

export type ScoutRepositoryStatus = "cloned" | "updated" | "reused" | "stale" | "failed" | "cancelled";

export interface ScoutRepositoryResult {
	path?: string;
	status: ScoutRepositoryStatus;
	head?: string;
	branch?: string;
	error?: string;
}

export interface EnsureScoutRepositoryOptions {
	url: string;
	branch?: string;
	refresh?: boolean;
	/** Test-only override. The registered tool always uses PiCraft's fixed cache root. */
	cacheRoot?: string;
	exec: ScoutGitExecutor;
	signal?: AbortSignal;
	timeoutMs?: number;
}

interface Deadline {
	expiresAt: number;
}

interface GitContext {
	exec: ScoutGitExecutor;
	signal?: AbortSignal;
	deadline: Deadline;
	hooksPath: string;
}

interface CheckoutInfo {
	origin: string;
	branch: string;
	head: string;
}

interface LockOwner {
	token: string;
	pid: number;
	createdAt: number;
	raw: string;
}

interface LockSnapshot {
	raw: string;
	owner?: LockOwner;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_LOCK_STALE_MS = 10 * 60_000;
const DEFAULT_LOCK_RETRY_MS = 50;
const RECOVERY_INSPECTION_TIMEOUT_MS = 5_000;
const FULL_COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;

class ScoutRepositoryOperationError extends Error {
	readonly kind: "command" | "cancelled" | "timeout" | "cache";

	constructor(message: string, kind: ScoutRepositoryOperationError["kind"]) {
		super(message);
		this.name = "ScoutRepositoryOperationError";
		this.kind = kind;
	}
}

class ScoutGitCommandError extends ScoutRepositoryOperationError {
	readonly args: string[];
	readonly result: ScoutGitExecResult;

	constructor(args: string[], result: ScoutGitExecResult) {
		const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
		super(`git ${args[0] ?? "command"} failed: ${detail.slice(0, 600)}`, "command");
		this.name = "ScoutGitCommandError";
		this.args = args;
		this.result = result;
	}
}

function abortError(message = "Scout repository operation canceled"): ScoutRepositoryOperationError {
	return new ScoutRepositoryOperationError(message, "cancelled");
}

function timeoutError(message = "Scout repository operation timed out"): ScoutRepositoryOperationError {
	return new ScoutRepositoryOperationError(message, "timeout");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw abortError();
}

function isInterruption(error: unknown): boolean {
	return error instanceof ScoutRepositoryOperationError && (error.kind === "cancelled" || error.kind === "timeout");
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function formatFailure(error: unknown): string {
	return errorText(error).replace(/\s+/gu, " ").trim().slice(0, 600) || "Scout repository operation failed";
}

function remainingTime(deadline: Deadline): number {
	const remaining = deadline.expiresAt - Date.now();
	if (remaining <= 0) throw timeoutError();
	return Math.max(1, remaining);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(abortError());
			return;
		}
		let timer: NodeJS.Timeout;
		const cleanup = (): void => signal?.removeEventListener("abort", onAbort);
		const onAbort = (): void => {
			clearTimeout(timer);
			cleanup();
			reject(abortError());
		};
		timer = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function comparablePath(value: string): string {
	const resolved = path.resolve(value);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isInside(root: string, target: string): boolean {
	const relative = path.relative(path.resolve(root), path.resolve(target));
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function lstatIfPresent(filePath: string): Promise<fs.Stats | undefined> {
	try {
		return await fs.promises.lstat(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

async function ensureDirectoryTree(anchor: string, target: string): Promise<void> {
	const resolvedAnchor = path.resolve(anchor);
	const resolvedTarget = path.resolve(target);
	if (!isInside(resolvedAnchor, resolvedTarget)) {
		throw new ScoutRepositoryOperationError(`Managed cache path escaped its anchor: ${resolvedTarget}`, "cache");
	}
	let anchorStat: fs.Stats | undefined;
	try {
		anchorStat = await fs.promises.stat(resolvedAnchor);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	if (!anchorStat?.isDirectory()) {
		throw new ScoutRepositoryOperationError(`Managed cache anchor is not a directory: ${resolvedAnchor}`, "cache");
	}

	let current = resolvedAnchor;
	const relative = path.relative(resolvedAnchor, resolvedTarget);
	for (const segment of relative ? relative.split(path.sep) : []) {
		current = path.join(current, segment);
		let stat = await lstatIfPresent(current);
		if (!stat) {
			try {
				await fs.promises.mkdir(current, { mode: 0o700 });
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
			stat = await lstatIfPresent(current);
		}
		if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
			throw new ScoutRepositoryOperationError(`Refusing unsafe managed cache component: ${current}`, "cache");
		}
	}
}

async function ensureCacheDirectories(cacheRoot: string): Promise<ScoutCachePaths> {
	const paths = getScoutCachePathsForRoot(cacheRoot);
	const defaultRoot = getScoutCacheRoot();
	const anchor = comparablePath(paths.root) === comparablePath(defaultRoot) ? os.homedir() : path.dirname(paths.root);
	await ensureDirectoryTree(anchor, paths.root);
	for (const directory of [paths.repos, paths.artifacts, paths.locks, paths.hooks]) {
		await ensureDirectoryTree(paths.root, directory);
	}
	return paths;
}

function parseLockOwner(raw: string): LockOwner | undefined {
	try {
		const value = JSON.parse(raw) as Partial<LockOwner>;
		if (typeof value.token !== "string" || !value.token) return undefined;
		if (!Number.isInteger(value.pid) || (value.pid ?? 0) <= 0) return undefined;
		if (typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt)) return undefined;
		return { token: value.token, pid: value.pid as number, createdAt: value.createdAt, raw };
	} catch {
		return undefined;
	}
}

async function readLockSnapshot(lockPath: string): Promise<LockSnapshot | undefined> {
	try {
		const raw = await fs.promises.readFile(lockPath, "utf8");
		return { raw, owner: parseLockOwner(raw) };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

async function removeAbandonedLock(lockPath: string, staleLockMs: number): Promise<boolean> {
	let stat: fs.Stats;
	try {
		stat = await fs.promises.stat(lockPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
		throw error;
	}
	if (Date.now() - stat.mtimeMs <= staleLockMs) return false;
	const observed = await readLockSnapshot(lockPath);
	if (!observed) return true;
	if (observed.owner && isProcessAlive(observed.owner.pid)) return false;
	const current = await readLockSnapshot(lockPath);
	if (!current || observed.raw !== current.raw) return false;
	await fs.promises.rm(lockPath, { force: true });
	return true;
}

async function acquireFileLock(
	lockPath: string,
	options: { signal?: AbortSignal; deadline: Deadline; staleLockMs: number; retryMs: number },
): Promise<() => Promise<void>> {
	while (true) {
		throwIfAborted(options.signal);
		remainingTime(options.deadline);
		const token = randomUUID();
		try {
			const handle = await fs.promises.open(lockPath, "wx", 0o600);
			const owner = JSON.stringify({ token, pid: process.pid, createdAt: Date.now() });
			try {
				await handle.writeFile(`${owner}\n`, "utf8");
			} catch (error) {
				await handle.close();
				await fs.promises.rm(lockPath, { force: true });
				throw error;
			}
			const heartbeat = setInterval(() => {
				void handle.utimes(new Date(), new Date()).catch(() => undefined);
			}, Math.max(1_000, Math.min(options.staleLockMs / 3, 60_000)));
			heartbeat.unref?.();
			return async () => {
				clearInterval(heartbeat);
				await handle.close();
				const current = await readLockSnapshot(lockPath).catch(() => undefined);
				if (current?.owner?.token === token) await fs.promises.rm(lockPath, { force: true });
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (await removeAbandonedLock(lockPath, options.staleLockMs)) continue;
			await delay(Math.min(options.retryMs, remainingTime(options.deadline)), options.signal);
		}
	}
}

function lockPathFor(paths: ScoutCachePaths, logicalPath: string): string {
	const key = createHash("sha256").update(comparablePath(logicalPath)).digest("hex").slice(0, 24);
	return path.join(paths.locks, `${key}.lock`);
}

async function withRepositoryMutationLock<T>(
	paths: ScoutCachePaths,
	logicalPath: string,
	context: Pick<GitContext, "signal" | "deadline">,
	mutate: () => Promise<T>,
): Promise<T> {
	return withFileMutationQueue(logicalPath, async () => {
		throwIfAborted(context.signal);
		const release = await acquireFileLock(lockPathFor(paths, logicalPath), {
			signal: context.signal,
			deadline: context.deadline,
			staleLockMs: DEFAULT_LOCK_STALE_MS,
			retryMs: DEFAULT_LOCK_RETRY_MS,
		});
		try {
			return await mutate();
		} finally {
			await release();
		}
	});
}

async function runGit(args: string[], cwd: string, context: GitContext): Promise<ScoutGitExecResult> {
	throwIfAborted(context.signal);
	const hardenedArgs = [
		"-c",
		`core.hooksPath=${context.hooksPath}`,
		"-c",
		"core.fsmonitor=false",
		"-c",
		"credential.interactive=false",
		"-c",
		"protocol.file.allow=never",
		...args,
	];
	let result: ScoutGitExecResult;
	try {
		result = await context.exec("git", hardenedArgs, {
			cwd,
			signal: context.signal,
			timeout: remainingTime(context.deadline),
		});
	} catch (error) {
		if (context.signal?.aborted) throw abortError();
		throw new ScoutRepositoryOperationError(errorText(error), "command");
	}
	if (context.signal?.aborted) throw abortError();
	if (result.killed) throw timeoutError(`git ${args[0] ?? "command"} timed out`);
	if (result.code !== 0) throw new ScoutGitCommandError(args, result);
	return result;
}

async function canonicalExistingPath(value: string): Promise<string> {
	return comparablePath(await fs.promises.realpath(value));
}

async function inspectCheckout(
	checkoutPath: string,
	reference: ScoutRepositoryReference,
	expectedBranch: string | undefined,
	context: GitContext,
): Promise<CheckoutInfo | undefined> {
	const checkoutStat = await lstatIfPresent(checkoutPath);
	if (!checkoutStat?.isDirectory() || checkoutStat.isSymbolicLink()) return undefined;
	const gitPath = path.join(checkoutPath, ".git");
	const gitStat = await lstatIfPresent(gitPath);
	if (!gitStat?.isDirectory() || gitStat.isSymbolicLink()) return undefined;

	try {
		const inside = await runGit(["rev-parse", "--is-inside-work-tree"], checkoutPath, context);
		if (inside.stdout.trim() !== "true") return undefined;
		const topLevel = (await runGit(["rev-parse", "--show-toplevel"], checkoutPath, context)).stdout.trim();
		const absoluteGitDir = (await runGit(["rev-parse", "--absolute-git-dir"], checkoutPath, context)).stdout.trim();
		if (!topLevel || !absoluteGitDir) return undefined;
		if (await canonicalExistingPath(topLevel) !== await canonicalExistingPath(checkoutPath)) return undefined;
		if (await canonicalExistingPath(absoluteGitDir) !== await canonicalExistingPath(gitPath)) return undefined;

		const origin = (await runGit(["config", "--get", "remote.origin.url"], checkoutPath, context)).stdout.trim();
		if (!origin) return undefined;
		let originReference: ScoutRepositoryReference;
		try {
			originReference = parseScoutRepositoryUrl(origin);
		} catch {
			return undefined;
		}
		if (originReference.identity !== reference.identity) return undefined;

		const branch = (await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], checkoutPath, context)).stdout.trim();
		if (!validateBranchSafely(branch) || (expectedBranch !== undefined && branch !== expectedBranch)) return undefined;
		const head = (await runGit(["rev-parse", "--verify", "HEAD^{commit}"], checkoutPath, context)).stdout.trim();
		if (!FULL_COMMIT_ID.test(head)) return undefined;
		return { origin, branch, head };
	} catch (error) {
		if (context.signal?.aborted || isInterruption(error)) throw error;
		return undefined;
	}
}

function validateBranchSafely(branch: string): boolean {
	try {
		validateScoutBranch(branch);
		return true;
	} catch {
		return false;
	}
}

function resultFromCheckout(
	checkoutPath: string,
	status: ScoutRepositoryStatus,
	info: CheckoutInfo,
	error?: string,
): ScoutRepositoryResult {
	return {
		path: checkoutPath,
		status,
		head: info.head,
		branch: info.branch,
		...(error ? { error } : {}),
	};
}

async function restoreCheckoutAfterFailedRefresh(
	checkoutPath: string,
	reference: ScoutRepositoryReference,
	before: CheckoutInfo,
	context: GitContext,
): Promise<CheckoutInfo | undefined> {
	const recoveryContext: GitContext = {
		...context,
		signal: undefined,
		deadline: { expiresAt: Date.now() + RECOVERY_INSPECTION_TIMEOUT_MS },
	};
	try {
		await runGit(["checkout", "--force", "-B", before.branch, before.head], checkoutPath, recoveryContext);
		await runGit(["reset", "--hard", before.head], checkoutPath, recoveryContext);
		await runGit(["clean", "-ffd"], checkoutPath, recoveryContext);
		const restored = await inspectCheckout(checkoutPath, reference, before.branch, recoveryContext);
		return restored?.head === before.head ? restored : undefined;
	} catch {
		return undefined;
	}
}

async function refreshCheckout(
	checkoutPath: string,
	reference: ScoutRepositoryReference,
	before: CheckoutInfo,
	targetBranch: string,
	context: GitContext,
): Promise<ScoutRepositoryResult> {
	try {
		const refspec = `+refs/heads/${targetBranch}:refs/remotes/origin/${targetBranch}`;
		await runGit(["fetch", "--no-tags", "--filter=blob:none", "--prune", "origin", refspec], checkoutPath, context);
		const targetHead = (
			await runGit(["rev-parse", "--verify", `origin/${targetBranch}^{commit}`], checkoutPath, context)
		).stdout.trim();
		if (!FULL_COMMIT_ID.test(targetHead)) {
			throw new ScoutRepositoryOperationError("Remote branch did not resolve to a complete commit ID", "cache");
		}
		await runGit(["checkout", "--force", "-B", targetBranch, `origin/${targetBranch}`], checkoutPath, context);
		await runGit(["reset", "--hard", targetHead], checkoutPath, context);
		await runGit(["clean", "-ffd"], checkoutPath, context);
		const after = await inspectCheckout(checkoutPath, reference, targetBranch, context);
		if (!after) throw new ScoutRepositoryOperationError("Refreshed checkout failed validation", "cache");
		const status = after.head === before.head && after.branch === before.branch ? "reused" : "updated";
		return resultFromCheckout(checkoutPath, status, after);
	} catch (error) {
		const restored = await restoreCheckoutAfterFailedRefresh(checkoutPath, reference, before, context);
		const status: ScoutRepositoryStatus = isInterruption(error) ? "cancelled" : "stale";
		if (restored) return resultFromCheckout(checkoutPath, status, restored, formatFailure(error));
		return {
			status: status === "cancelled" ? "cancelled" : "failed",
			error: `${formatFailure(error)}; original cached checkout could not be restored`,
		};
	}
}

async function resolveDefaultBranch(reference: ScoutRepositoryReference, paths: ScoutCachePaths, context: GitContext): Promise<string> {
	const result = await runGit(["ls-remote", "--symref", "--", reference.cloneUrl, "HEAD"], paths.root, context);
	const match = /^ref:\s+refs\/heads\/([^\s]+)\s+HEAD$/imu.exec(result.stdout);
	if (!match?.[1] || !validateBranchSafely(match[1])) {
		throw new ScoutRepositoryOperationError("Remote did not advertise a safe default branch", "cache");
	}
	return match[1];
}

async function ensureRepositoryParent(paths: ScoutCachePaths, checkoutPath: string): Promise<void> {
	const parent = path.dirname(checkoutPath);
	if (!isInside(paths.repos, parent)) {
		throw new ScoutRepositoryOperationError("Repository path escaped the managed cache", "cache");
	}
	await ensureDirectoryTree(paths.repos, parent);
}

async function cloneRepository(
	logicalPath: string,
	reference: ScoutRepositoryReference,
	branch: string,
	paths: ScoutCachePaths,
	context: GitContext,
): Promise<ScoutRepositoryResult> {
	await ensureRepositoryParent(paths, logicalPath);
	const tempRoot = await fs.promises.mkdtemp(path.join(paths.repos, ".scout-tmp-"));
	const tempCheckout = path.join(tempRoot, "checkout");
	try {
		await runGit(
			[
				"clone",
				"--filter=blob:none",
				"--no-tags",
				"--no-recurse-submodules",
				"--single-branch",
				"--template",
				paths.hooks,
				"--branch",
				branch,
				"--",
				reference.cloneUrl,
				tempCheckout,
			],
			paths.root,
			context,
		);
		const info = await inspectCheckout(tempCheckout, reference, branch, context);
		if (!info) throw new ScoutRepositoryOperationError("Cloned checkout failed validation", "cache");
		const existing = await lstatIfPresent(logicalPath);
		if (existing) {
			throw new ScoutRepositoryOperationError(`Cache path appeared during clone: ${logicalPath}`, "cache");
		}
		await fs.promises.rename(tempCheckout, logicalPath);
		return resultFromCheckout(logicalPath, "cloned", info);
	} catch (error) {
		return { status: isInterruption(error) ? "cancelled" : "failed", error: formatFailure(error) };
	} finally {
		await fs.promises.rm(tempRoot, { force: true, recursive: true }).catch(() => undefined);
	}
}

async function removeInvalidManagedEntry(paths: ScoutCachePaths, checkoutPath: string): Promise<void> {
	if (!isInside(paths.repos, checkoutPath)) {
		throw new ScoutRepositoryOperationError("Invalid checkout escaped the managed repository root", "cache");
	}
	const stat = await lstatIfPresent(checkoutPath);
	if (!stat) return;
	if (stat.isSymbolicLink()) {
		throw new ScoutRepositoryOperationError(`Refusing to replace cache symlink: ${checkoutPath}`, "cache");
	}
	await fs.promises.rm(checkoutPath, { force: true, recursive: true });
}

async function ensureRepositoryUnderLock(
	logicalPath: string,
	reference: ScoutRepositoryReference,
	requestedBranch: string | undefined,
	refresh: boolean,
	paths: ScoutCachePaths,
	context: GitContext,
): Promise<ScoutRepositoryResult> {
	throwIfAborted(context.signal);
	await ensureRepositoryParent(paths, logicalPath);

	const existingStat = await lstatIfPresent(logicalPath);
	if (existingStat?.isSymbolicLink()) {
		return { path: logicalPath, status: "failed", error: "Refusing to follow a cache symlink" };
	}
	let existing = existingStat
		? await inspectCheckout(logicalPath, reference, requestedBranch, context)
		: undefined;
	if (existingStat && !existing) {
		await removeInvalidManagedEntry(paths, logicalPath);
	}
	if (existing && !refresh) return resultFromCheckout(logicalPath, "reused", existing);

	let targetBranch = requestedBranch;
	if (!targetBranch) {
		try {
			targetBranch = await resolveDefaultBranch(reference, paths, context);
		} catch (error) {
			if (existing) return resultFromCheckout(logicalPath, "stale", existing, formatFailure(error));
			return { status: isInterruption(error) ? "cancelled" : "failed", error: formatFailure(error) };
		}
	}

	if (existing) return refreshCheckout(logicalPath, reference, existing, targetBranch, context);
	return cloneRepository(logicalPath, reference, targetBranch, paths, context);
}

export async function ensureScoutRepository(options: EnsureScoutRepositoryOptions): Promise<ScoutRepositoryResult> {
	let reference: ScoutRepositoryReference;
	let requestedBranch: string | undefined;
	try {
		reference = parseScoutRepositoryUrl(options.url);
		requestedBranch = options.branch === undefined ? undefined : validateScoutBranch(options.branch);
	} catch (error) {
		return { status: "failed", error: formatFailure(error) };
	}

	const cacheRoot = options.cacheRoot ?? getScoutCacheRoot();
	const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
	const controller = new AbortController();
	let timedOut = false;
	const onAbort = (): void => controller.abort();
	if (options.signal?.aborted) controller.abort();
	else options.signal?.addEventListener("abort", onAbort, { once: true });
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);
	timer.unref?.();

	try {
		const paths = await ensureCacheDirectories(cacheRoot);
		const logicalPath = getScoutRepositoryPath(reference, requestedBranch, paths.root);
		const context: GitContext = {
			exec: options.exec,
			signal: controller.signal,
			deadline: { expiresAt: Date.now() + timeoutMs },
			hooksPath: paths.hooks,
		};
		const result = await withRepositoryMutationLock(paths, logicalPath, context, () =>
			ensureRepositoryUnderLock(
				logicalPath,
				reference,
				requestedBranch,
				options.refresh ?? true,
				paths,
				context,
			),
		);
		return timedOut && result.status === "cancelled"
			? { ...result, error: "Scout repository operation timed out" }
			: result;
	} catch (error) {
		if (timedOut) return { status: "cancelled", error: "Scout repository operation timed out" };
		if (controller.signal.aborted || isInterruption(error)) return { status: "cancelled", error: formatFailure(error) };
		return { status: "failed", error: formatFailure(error) };
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", onAbort);
	}
}

export { DEFAULT_TIMEOUT_MS as SCOUT_REPOSITORY_DEFAULT_TIMEOUT_MS };

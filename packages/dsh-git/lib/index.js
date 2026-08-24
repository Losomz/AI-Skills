import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { WorkspaceId } from "@deepseek-ai/dsh-workspace";
import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";

//#region src/git.ts
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_DIFF_BYTES = 512 * 1024;
const COMMAND_TIMEOUT_MS = 3e4;
var GitOperationError = class extends Error {
	constructor(code, message, detail) {
		super(message);
		this.code = code;
		this.detail = detail;
		this.name = "GitOperationError";
	}
};
function runGit(cwd, args, options = {}) {
	return new Promise((resolve, reject) => {
		const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
		const child = spawn("git", [
			"-c",
			"core.pager=cat",
			"-c",
			"core.fsmonitor=false",
			...args
		], {
			cwd,
			shell: false,
			windowsHide: true,
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			],
			env: {
				...environment,
				GIT_TERMINAL_PROMPT: "0",
				GIT_CONFIG_NOSYSTEM: "1"
			}
		});
		const stdout = [];
		const stderr = [];
		const maxBytes = options.maxBytes ?? MAX_OUTPUT_BYTES;
		let size = 0;
		let settled = false;
		const rejectOnce = (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(error);
		};
		const timer = setTimeout(() => {
			child.kill();
			rejectOnce(new GitOperationError("GIT_TIMEOUT", "Git operation timed out"));
		}, COMMAND_TIMEOUT_MS);
		const collect = (target, chunk) => {
			size += chunk.byteLength;
			if (size > maxBytes) {
				child.kill();
				rejectOnce(new GitOperationError("GIT_OUTPUT_LIMIT", "Git output exceeded the safety limit"));
				return;
			}
			target.push(chunk);
		};
		child.stdout.on("data", (chunk) => {
			collect(stdout, chunk);
		});
		child.stderr.on("data", (chunk) => {
			collect(stderr, chunk);
		});
		child.on("error", (error) => {
			rejectOnce(error instanceof Error && "code" in error && error.code === "ENOENT" ? new GitOperationError("GIT_NOT_FOUND", "Git is not installed or is not available on PATH") : error);
		});
		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			const exitCode = code ?? -1;
			const errorText = Buffer.concat(stderr).toString("utf8").trim();
			if (exitCode !== 0 && !(options.allowExitCodes ?? []).includes(exitCode)) {
				reject(mapGitFailure(exitCode, errorText));
				return;
			}
			resolve({
				stdout: Buffer.concat(stdout),
				stderr: errorText,
				exitCode
			});
		});
		if (options.input === void 0) child.stdin.end();
		else child.stdin.end(options.input, "utf8");
	});
}
function mapGitFailure(exitCode, detail) {
	const text = detail.toLowerCase();
	if (text.includes("not a git repository")) return new GitOperationError("NOT_A_REPOSITORY", "The selected workspace is not a Git repository", detail);
	if (text.includes("user.name") || text.includes("user.email") || text.includes("author identity unknown")) return new GitOperationError("GIT_IDENTITY_MISSING", "Configure Git user.name and user.email before committing", detail);
	if (text.includes("index.lock") || text.includes("another git process")) return new GitOperationError("GIT_LOCKED", "The repository is locked by another Git process", detail);
	if (text.includes("gpg failed") || text.includes("failed to sign")) return new GitOperationError("GIT_SIGNING_FAILED", "Git could not sign the commit non-interactively", detail);
	return new GitOperationError("GIT_FAILED", `Git exited with code ${exitCode}`, detail);
}
function isWithin(parent, candidate) {
	const relative = path.relative(parent, candidate);
	return relative === "" || !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}
async function resolveRepository(workspacePath) {
	const workspace = await realpath(workspacePath);
	const root = await realpath((await runGit(workspace, [
		"-c",
		"core.pager=cat",
		"rev-parse",
		"--show-toplevel"
	])).stdout.toString("utf8").trim());
	if (!isWithin(workspace, root)) throw new GitOperationError("REPOSITORY_OUTSIDE_WORKSPACE", "The Git repository root is outside the selected workspace");
	return root;
}
function validateRelativePath(repoRoot, value) {
	if (value.length === 0 || value.includes("\0") || path.isAbsolute(value)) throw new GitOperationError("INVALID_PATH", "Git paths must be non-empty repository-relative paths");
	const normalized = value.replaceAll("\\", "/");
	if (!isWithin(repoRoot, path.resolve(repoRoot, ...normalized.split("/")))) throw new GitOperationError("INVALID_PATH", "Git path escapes the repository");
	return normalized;
}
function changeKind(x, y) {
	const code = x !== "." ? x : y;
	if (code === "A") return "added";
	if (code === "D") return "deleted";
	if (code === "R") return "renamed";
	if (code === "C") return "copied";
	if (code === "U" || x === "U" || y === "U" || x === "A" && y === "A" || x === "D" && y === "D") return "conflicted";
	return "modified";
}
function fieldAfterSpaces(record, count) {
	let cursor = -1;
	for (let index = 0; index < count; index += 1) {
		cursor = record.indexOf(" ", cursor + 1);
		if (cursor === -1) return "";
	}
	return record.slice(cursor + 1);
}
function parsePorcelainV2(output) {
	const fields = output.toString("utf8").split("\0");
	const files = [];
	let branch = null;
	let detached = false;
	let unborn = false;
	let ahead = 0;
	let behind = 0;
	for (let index = 0; index < fields.length; index += 1) {
		const record = fields[index];
		if (!record) continue;
		if (record.startsWith("# branch.head ")) {
			const head = record.slice(14);
			detached = head === "(detached)";
			branch = detached ? null : head;
			continue;
		}
		if (record.startsWith("# branch.oid ")) {
			unborn = record.slice(13) === "(initial)";
			continue;
		}
		if (record.startsWith("# branch.ab ")) {
			const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
			if (match) {
				ahead = Number(match[1]);
				behind = Number(match[2]);
			}
			continue;
		}
		if (record.startsWith("? ")) {
			files.push({
				path: record.slice(2),
				kind: "untracked",
				staged: false,
				unstaged: true
			});
			continue;
		}
		if (record.startsWith("1 ") || record.startsWith("u ")) {
			const xy = record.slice(2, 4);
			const filePath = fieldAfterSpaces(record, record.startsWith("u ") ? 10 : 8);
			files.push({
				path: filePath,
				kind: record.startsWith("u ") ? "conflicted" : changeKind(xy[0] ?? ".", xy[1] ?? "."),
				staged: (xy[0] ?? ".") !== ".",
				unstaged: (xy[1] ?? ".") !== "."
			});
			continue;
		}
		if (record.startsWith("2 ")) {
			const xy = record.slice(2, 4);
			const filePath = fieldAfterSpaces(record, 9);
			const originalPath = fields[index + 1] ?? "";
			index += 1;
			files.push({
				path: filePath,
				originalPath,
				kind: changeKind(xy[0] ?? ".", xy[1] ?? "."),
				staged: (xy[0] ?? ".") !== ".",
				unstaged: (xy[1] ?? ".") !== "."
			});
		}
	}
	return {
		root: "",
		branch,
		detached,
		unborn,
		ahead,
		behind,
		files,
		hasConflicts: files.some((file) => file.kind === "conflicted")
	};
}
async function readStatus(repoRoot) {
	return {
		...parsePorcelainV2((await runGit(repoRoot, [
			"-c",
			"core.pager=cat",
			"status",
			"--porcelain=v2",
			"-z",
			"--branch",
			"--untracked-files=all"
		])).stdout),
		root: repoRoot
	};
}
async function repositoryInfo(repoRoot) {
	const { files: _files, hasConflicts: _hasConflicts, ...info } = await readStatus(repoRoot);
	return info;
}
async function readDiff(repoRoot, requestedPath, staged) {
	const relativePath = validateRelativePath(repoRoot, requestedPath);
	const args = [
		"--no-pager",
		"diff",
		"--no-ext-diff",
		"--no-textconv",
		"--no-color"
	];
	if (staged) args.push("--cached");
	args.push("--", relativePath);
	let text = "";
	let truncated = false;
	try {
		text = (await runGit(repoRoot, args, { maxBytes: MAX_DIFF_BYTES })).stdout.toString("utf8");
	} catch (error) {
		if (!(error instanceof GitOperationError) || error.code !== "GIT_OUTPUT_LIMIT") throw error;
		text = "Diff exceeds the 512 KiB display limit.";
		truncated = true;
	}
	return {
		path: relativePath,
		staged,
		text,
		binary: /Binary files .* differ/u.test(text),
		truncated
	};
}
async function stagePaths(repoRoot, paths) {
	if (paths.length === 0) throw new GitOperationError("EMPTY_PATHS", "Select at least one file");
	await runGit(repoRoot, [
		"--literal-pathspecs",
		"add",
		"--",
		...paths.map((value) => validateRelativePath(repoRoot, value))
	]);
}
async function unstagePaths(repoRoot, paths) {
	if (paths.length === 0) throw new GitOperationError("EMPTY_PATHS", "Select at least one file");
	const safePaths = paths.map((value) => validateRelativePath(repoRoot, value));
	if ((await runGit(repoRoot, [
		"rev-parse",
		"--verify",
		"HEAD"
	], { allowExitCodes: [1, 128] })).exitCode === 0) await runGit(repoRoot, [
		"--literal-pathspecs",
		"reset",
		"-q",
		"HEAD",
		"--",
		...safePaths
	]);
	else await runGit(repoRoot, [
		"--literal-pathspecs",
		"rm",
		"--cached",
		"-q",
		"--",
		...safePaths
	]);
}
async function createCommit(repoRoot, message) {
	const normalized = message.trim();
	if (normalized.length === 0) throw new GitOperationError("EMPTY_COMMIT_MESSAGE", "Commit message cannot be empty");
	if (Buffer.byteLength(normalized, "utf8") > 64 * 1024) throw new GitOperationError("COMMIT_MESSAGE_LIMIT", "Commit message is too large");
	const status = await readStatus(repoRoot);
	if (status.hasConflicts) throw new GitOperationError("MERGE_CONFLICTS", "Resolve conflicts before committing");
	if (!status.files.some((file) => file.staged)) throw new GitOperationError("NOTHING_STAGED", "There are no staged changes to commit");
	const result = await runGit(repoRoot, [
		"-c",
		"commit.gpgSign=false",
		"commit",
		"--file",
		"-"
	], { input: `${normalized}\n` });
	return {
		hash: (await runGit(repoRoot, ["rev-parse", "HEAD"])).stdout.toString("utf8").trim(),
		summary: result.stdout.toString("utf8").trim().split(/\r?\n/u)[0] ?? normalized
	};
}
var RepositoryMutationQueue = class {
	tails = /* @__PURE__ */ new Map();
	async run(repoRoot, operation) {
		const previous = this.tails.get(repoRoot) ?? Promise.resolve();
		let release;
		const current = new Promise((resolve) => {
			release = resolve;
		});
		const tail = previous.then(() => current);
		this.tails.set(repoRoot, tail);
		await previous;
		try {
			return await operation();
		} finally {
			release();
			if (this.tails.get(repoRoot) === tail) this.tails.delete(repoRoot);
		}
	}
};

//#endregion
//#region src/index.ts
var __runInitializers = void 0 && (void 0).__runInitializers || function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = void 0 && (void 0).__esDecorate || function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) if (kind === "field") initializers.unshift(_);
		else descriptor[key] = _;
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
/** Host Remote service for Git operations confined to registered workspaces. */
let SourceControlService = (() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _repositoryInfo_decorators;
	let _status_decorators;
	let _diff_decorators;
	let _stage_decorators;
	let _unstage_decorators;
	let _commit_decorators;
	return class SourceControlService extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_repositoryInfo_decorators = [Remote("repositoryInfo")];
			_status_decorators = [Remote("status")];
			_diff_decorators = [Remote("diff")];
			_stage_decorators = [Remote("stage")];
			_unstage_decorators = [Remote("unstage")];
			_commit_decorators = [Remote("commit")];
			__esDecorate(this, null, _repositoryInfo_decorators, {
				kind: "method",
				name: "repositoryInfo",
				static: false,
				private: false,
				access: {
					has: (obj) => "repositoryInfo" in obj,
					get: (obj) => obj.repositoryInfo
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _status_decorators, {
				kind: "method",
				name: "status",
				static: false,
				private: false,
				access: {
					has: (obj) => "status" in obj,
					get: (obj) => obj.status
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _diff_decorators, {
				kind: "method",
				name: "diff",
				static: false,
				private: false,
				access: {
					has: (obj) => "diff" in obj,
					get: (obj) => obj.diff
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _stage_decorators, {
				kind: "method",
				name: "stage",
				static: false,
				private: false,
				access: {
					has: (obj) => "stage" in obj,
					get: (obj) => obj.stage
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _unstage_decorators, {
				kind: "method",
				name: "unstage",
				static: false,
				private: false,
				access: {
					has: (obj) => "unstage" in obj,
					get: (obj) => obj.unstage
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _commit_decorators, {
				kind: "method",
				name: "commit",
				static: false,
				private: false,
				access: {
					has: (obj) => "commit" in obj,
					get: (obj) => obj.commit
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		static inject = ["workspaceRegistry"];
		mutations = (__runInitializers(this, _instanceExtraInitializers), new RepositoryMutationQueue());
		constructor(ctx) {
			super(ctx, "sourceControl");
		}
		async repositoryRoot(workspaceId) {
			const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId));
			if (workspace === void 0) throw new Error(`Unknown workspace '${workspaceId}'`);
			return await resolveRepository(workspace.path);
		}
		async repositoryInfo(workspaceId) {
			return await repositoryInfo(await this.repositoryRoot(workspaceId));
		}
		async status(workspaceId) {
			return await readStatus(await this.repositoryRoot(workspaceId));
		}
		async diff(request) {
			return await readDiff(await this.repositoryRoot(request.workspaceId), request.path, request.staged);
		}
		async stage(request) {
			const root = await this.repositoryRoot(request.workspaceId);
			return await this.mutations.run(root, async () => {
				await stagePaths(root, request.paths);
				return await readStatus(root);
			});
		}
		async unstage(request) {
			const root = await this.repositoryRoot(request.workspaceId);
			return await this.mutations.run(root, async () => {
				await unstagePaths(root, request.paths);
				return await readStatus(root);
			});
		}
		async commit(request) {
			const root = await this.repositoryRoot(request.workspaceId);
			return await this.mutations.run(root, async () => await createCommit(root, request.message));
		}
	};
})();

//#endregion
export { SourceControlService, SourceControlService as default };
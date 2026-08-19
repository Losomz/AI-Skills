import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	canonicalize,
	normalizePathForPolicy,
	resolveToolPath,
	type PermissionPathPolicy,
} from "./core.ts";
import { getPicraftScoutCacheRoot } from "../shared/scout-cache-paths.ts";

const AGENT_RESOURCE_DIRS = ["extensions", "git", "npm", "skills", "prompts", "themes", "bin"] as const;
const AGENT_READABLE_FILES = [".gitignore", "settings.json", "models-store.json", "subagent-models.json", "trust.json"] as const;
const AGENT_SENSITIVE_FILES = ["auth.json", "models.json"] as const;
const ATTACHMENT_NAME = /^(?:pi-clipboard-[0-9a-f-]+|orca-paste-[0-9]+-[0-9a-f-]+)[.](?:png|jpe?g|gif|webp|bmp)$/i;
const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";
const MAX_TERMINAL_INPUT_LENGTH = 256 * 1024;
const MAX_PASTED_FILES = 64;
const MAX_FILE_PATH_LENGTH = 32_768;

export interface PermissionRuntimePaths {
	agentDir: string;
	packageDir: string;
	sessionTrustedFiles?: readonly string[];
}

export function buildPermissionPathPolicy(cwd: string, runtime: PermissionRuntimePaths): PermissionPathPolicy {
	const agentDir = canonicalize(runtime.agentDir);
	const packageDir = canonicalize(runtime.packageDir);
	const runtimeReadRoots = [
		join(agentDir, "sessions"),
		join(agentDir, "logs"),
		join(agentDir, "extensions", "pi-permission-system", "logs"),
	];
	const sensitiveReadFiles = AGENT_SENSITIVE_FILES.map((name) => join(agentDir, name));

	return {
		projectRoots: projectRoots(cwd),
		trustedReadRoots: uniquePaths([
			packageDir,
			getPicraftScoutCacheRoot(),
			...AGENT_RESOURCE_DIRS.map((name) => join(agentDir, name)),
			...runtimeReadRoots,
		]),
		trustedReadFiles: uniquePaths([
			...AGENT_READABLE_FILES.map((name) => join(agentDir, name)),
			...sensitiveReadFiles,
		]),
		approvedReadFiles: uniquePaths(runtime.sessionTrustedFiles ?? []),
		sensitiveReadRoots: [],
		sensitiveReadFiles: uniquePaths(sensitiveReadFiles),
	};
}

export function projectRoots(cwd: string): string[] {
	const roots = [canonicalize(cwd)];
	for (const args of [
		["rev-parse", "--show-toplevel"],
		["rev-parse", "--absolute-git-dir"],
		["rev-parse", "--path-format=absolute", "--git-common-dir"],
	]) {
		const value = gitPath(cwd, args);
		if (value) roots.push(value);
	}
	return uniquePaths(roots);
}

export function extractTerminalPasteFiles(data: string): string[] {
	if (
		data.length === 0 ||
		data.length > MAX_TERMINAL_INPUT_LENGTH ||
		!data.includes(BRACKETED_PASTE_START)
	) {
		return [];
	}

	const paths: string[] = [];
	let cursor = 0;
	while (paths.length < MAX_PASTED_FILES) {
		const start = data.indexOf(BRACKETED_PASTE_START, cursor);
		if (start < 0) break;
		const payloadStart = start + BRACKETED_PASTE_START.length;
		const end = data.indexOf(BRACKETED_PASTE_END, payloadStart);
		if (end < 0) break;
		paths.push(...resolvePastedPayload(data.slice(payloadStart, end)).slice(0, MAX_PASTED_FILES - paths.length));
		cursor = end + BRACKETED_PASTE_END.length;
	}
	return uniquePaths(paths);
}

export function extractSubmittedTempFiles(text: string): string[] {
	const tempRoot = canonicalize(tmpdir());
	const normalized = normalizePathForPolicy(text)
		.replaceAll(String.fromCharCode(9), " ")
		.replaceAll(String.fromCharCode(10), " ")
		.replaceAll(String.fromCharCode(13), " ");
	const candidates = normalized.split(String.fromCharCode(32));
	const paths: string[] = [];
	for (const token of candidates) {
		const candidate = token
			.replace(/^[@"'(<{]+/, "")
			.replace(/[>"'),;}]+$/, "")
			.replaceAll("[", "")
			.replaceAll("]", "");
		if (!ATTACHMENT_NAME.test(basename(candidate))) continue;
		const target = canonicalize(candidate);
		if (canonicalize(dirname(target)) === tempRoot && isRegularFile(target)) paths.push(target);
	}
	return uniquePaths(paths);
}

function resolvePastedPayload(payload: string): string[] {
	const file = resolvePastedFile(payload.trim());
	return file ? [file] : [];
}

function resolvePastedFile(value: string): string | undefined {
	const candidate = decodePastedToken(value);
	if (!candidate || candidate.length > MAX_FILE_PATH_LENGTH) return undefined;
	if (!isAbsolutePastedPath(candidate)) return undefined;

	try {
		const target = resolveToolPath(candidate, process.cwd());
		return isRegularFile(target) ? target : undefined;
	} catch {
		return undefined;
	}
}

function decodePastedToken(value: string): string {
	let candidate = value.trim().replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
	if (candidate.startsWith("@")) candidate = candidate.slice(1);
	const quote = candidate[0];
	if (candidate.length >= 2 && (quote === '"' || quote === "'") && candidate.at(-1) === quote) {
		candidate = candidate.slice(1, -1);
		candidate = quote === "'" ? candidate.replaceAll("''", "'") : candidate.replaceAll('\\"', '"');
	} else if (process.platform !== "win32") {
		candidate = candidate.replace(/\\([\\\s'"()[\]{}<>;&|])/g, "$1");
	}
	return candidate;
}

function isAbsolutePastedPath(value: string): boolean {
	const candidate = value.startsWith("@") ? value.slice(1) : value;
	if (candidate === "~" || candidate.startsWith("~/") || candidate.startsWith("~\\")) return true;
	if (candidate.startsWith("file://")) {
		try {
			return isAbsolute(fileURLToPath(candidate));
		} catch {
			return false;
		}
	}
	if (process.platform === "win32" && /^\/(?:mnt\/|cygdrive\/)?[a-z](?:\/|$)/i.test(candidate)) {
		return true;
	}
	return isAbsolute(candidate);
}

function isRegularFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function gitPath(cwd: string, args: string[]): string | undefined {
	try {
		const output = execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (!output) return undefined;
		return canonicalize(isAbsolute(output) ? output : resolve(cwd, output));
	} catch {
		return undefined;
	}
}

function uniquePaths(paths: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const item of paths) {
		const path = canonicalize(item);
		const key = process.platform === "win32" ? path.toLowerCase() : path;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(path);
	}
	return result;
}


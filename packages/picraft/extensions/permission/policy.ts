import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { canonicalize, normalizePathForPolicy, type PermissionPathPolicy } from "./core.ts";

const AGENT_RESOURCE_DIRS = ["extensions", "git", "npm", "skills", "prompts", "themes", "bin"] as const;
const AGENT_READABLE_FILES = [".gitignore", "settings.json", "models-store.json", "subagent-models.json", "trust.json"] as const;
const AGENT_SENSITIVE_FILES = ["auth.json", "models.json"] as const;
const ATTACHMENT_NAME = /^(?:pi-clipboard-[0-9a-f-]+|orca-paste-[0-9]+-[0-9a-f-]+)[.](?:png|jpe?g|gif|webp|bmp)$/i;

export interface PermissionRuntimePaths {
	agentDir: string;
	packageDir: string;
	sessionTrustedFiles?: readonly string[];
}

export function buildPermissionPathPolicy(cwd: string, runtime: PermissionRuntimePaths): PermissionPathPolicy {
	const agentDir = canonicalize(runtime.agentDir);
	const packageDir = canonicalize(runtime.packageDir);
	const sensitiveReadRoots = [
		join(agentDir, "sessions"),
		join(agentDir, "logs"),
		join(agentDir, "extensions", "pi-permission-system", "logs"),
	];
	const sensitiveReadFiles = AGENT_SENSITIVE_FILES.map((name) => join(agentDir, name));

	return {
		projectRoots: projectRoots(cwd),
		trustedReadRoots: uniquePaths([
			packageDir,
			...AGENT_RESOURCE_DIRS.map((name) => join(agentDir, name)),
			...sensitiveReadRoots,
		]),
		trustedReadFiles: uniquePaths([
			...AGENT_READABLE_FILES.map((name) => join(agentDir, name)),
			...sensitiveReadFiles,
			...(runtime.sessionTrustedFiles ?? []),
		]),
		sensitiveReadRoots: uniquePaths(sensitiveReadRoots),
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
		if (canonicalize(dirname(target)) === tempRoot) paths.push(target);
	}
	return uniquePaths(paths);
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


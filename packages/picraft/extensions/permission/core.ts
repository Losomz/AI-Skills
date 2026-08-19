import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type PermissionName = "external_directory" | "read";
export type PermissionEffect = "allow" | "ask" | "deny";

export interface PermissionRequirement {
	permission: PermissionName;
	access?: PathAccess;
	pattern: string;
	alwaysPattern: string;
	reason: string;
}

export interface PermissionRequest {
	toolName: string;
	title: string;
	detail: string;
	requirements: PermissionRequirement[];
	agentName?: string;
}

export interface ToolCallLike {
	toolName: string;
	input: Record<string, unknown>;
}

export type PermissionPolicyDecision =
	| { effect: "allow" }
	| { effect: "ask"; request: PermissionRequest }
	| { effect: "deny"; reason: string };

export interface PermissionPathPolicy {
	projectRoots: readonly string[];
	trustedReadRoots?: readonly string[];
	trustedReadFiles?: readonly string[];
	sensitiveReadRoots?: readonly string[];
	sensitiveReadFiles?: readonly string[];
}

export type PathAccess = "read" | "write" | "unknown";

export interface ToolPathIntent {
	path: string;
	access: PathAccess;
}

const PATH_TOOLS = new Set(["read", "edit", "write", "grep", "find", "ls"]);
const READ_PATH_TOOLS = new Set(["read", "grep", "find", "ls"]);
const SHELL_FILE_COMMANDS = new Set([
	"cd",
	"cat",
	"chmod",
	"chown",
	"cp",
	"mkdir",
	"mv",
	"rm",
	"touch",
]);
const SHELL_SEPARATORS = new Set([";", "&&", "||", "|"]);
const REDIRECTIONS = new Set([">", ">>", "<", "1>", "1>>", "2>", "2>>", "2>&1", ">&1", "&>"]);
const REDIRECTIONS_WITHOUT_TARGET = new Set(["2>&1", ">&1"]);
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9]|lpt[1-9])(?:[.:].*)?$/i;
const EXTERNAL_READ_PACKAGE_ROOT_MARKERS = [
	"package.json",
	"pyproject.toml",
	"Cargo.toml",
	"go.mod",
	"pom.xml",
	"settings.gradle",
	"settings.gradle.kts",
] as const;
const EXTERNAL_READ_PROJECT_ROOT_MARKERS = ["project.godot"] as const;
const EXTERNAL_READ_COMPOUND_PROJECT_ROOT_MARKERS = [
	["Packages", "manifest.json"],
	["ProjectSettings", "ProjectVersion.txt"],
	["Editor", "Unity.exe"],
	["Engine", "Build", "Build.version"],
] as const;

export function isWindowsReservedDevicePath(value: string): boolean {
	if (process.platform !== "win32") return false;
	let normalized = normalizePathForPolicy(value).trim().replace(/^@/, "").replace(/[/]+$/, "");
	if (!normalized || normalized.toLowerCase() === "/dev/null") return false;
	const name = normalized.split("/").at(-1)?.replace(/[ .]+$/, "") ?? "";
	return WINDOWS_DEVICE_NAME.test(name);
}

export function isBashNullDevicePath(value: string): boolean {
	return normalizePathForPolicy(value).trim().toLowerCase() === "/dev/null";
}

function isForbiddenBashTarget(value: string): boolean {
	return value.trim().toLowerCase() === "$null" || isWindowsReservedDevicePath(value);
}

function findForbiddenBashRedirection(command: string): string | undefined {
	const tokens = tokenizeShell(command);
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (!REDIRECTIONS.has(token) || REDIRECTIONS_WITHOUT_TARGET.has(token)) continue;
		const target = tokens[++index];
		if (target && isForbiddenBashTarget(unquote(target))) return unquote(target);
	}
	return undefined;
}

export function findToolPolicyViolation(event: ToolCallLike): string | undefined {
	if (event.toolName === "bash" && typeof event.input.command === "string") {
		const target = findForbiddenBashRedirection(event.input.command);
		if (target) return `Forbidden Bash redirection target: ${target}`;
	}

	const intents = extractToolPathIntents(event, "");
	for (const intent of intents) {
		if (isWindowsReservedDevicePath(intent.path)) {
			return `Forbidden Windows device target: ${intent.path}`;
		}
	}
	return undefined;
}

export function evaluatePermissionPolicy(
	event: ToolCallLike,
	cwd: string,
	policyOrRoots: PermissionPathPolicy | readonly string[],
	agentName?: string,
): PermissionPolicyDecision {
	const violation = findToolPolicyViolation(event);
	if (violation) return { effect: "deny", reason: violation };
	const request = collectPermissionRequest(event, cwd, policyOrRoots, agentName);
	return request ? { effect: "ask", request } : { effect: "allow" };
}

export function wildcardMatch(pattern: string, value: string, caseInsensitive = process.platform === "win32"): boolean {
	let source = "";
	for (const character of pattern) {
		if (character === "*") source += ".*";
		else if (character === "?") source += ".";
		else if ("\\^$+?.()|{}[]".includes(character)) source += `\\${character}`;
		else source += character;
	}
	return new RegExp(`^${source}$`, caseInsensitive ? "i" : "").test(value);
}

export class SessionGrants {
	private readonly rules: PermissionRequirement[] = [];
	private revisionValue = 0;

	private readonly onChange?: () => void;

	constructor(onChange?: () => void) {
		this.onChange = onChange;
	}

	currentRevision(): number {
		return this.revisionValue;
	}

	allows(requirement: PermissionRequirement): boolean {
		return this.rules.some(
			(rule) =>
				rule.permission === requirement.permission &&
				requirementAccess(rule) === requirementAccess(requirement) &&
				wildcardMatch(rule.alwaysPattern, requirement.pattern),
		);
	}

	add(requirements: readonly PermissionRequirement[]): void {
		let changed = false;
		for (const requirement of requirements) {
			if (
				!this.rules.some(
					(rule) =>
						rule.permission === requirement.permission &&
						requirementAccess(rule) === requirementAccess(requirement) &&
						rule.alwaysPattern === requirement.alwaysPattern,
				)
			) {
				this.rules.push({ ...requirement });
				changed = true;
			}
		}
		if (changed) this.changed();
	}

	clear(): void {
		if (this.rules.length === 0) return;
		this.rules.length = 0;
		this.changed();
	}

	remove(permission: PermissionName, alwaysPattern: string, access?: PathAccess): boolean {
		const index = this.rules.findIndex(
			(rule) =>
				rule.permission === permission &&
				rule.alwaysPattern === alwaysPattern &&
				(access === undefined || requirementAccess(rule) === access),
		);
		if (index < 0) return false;
		this.rules.splice(index, 1);
		this.changed();
		return true;
	}

	private changed(): void {
		this.revisionValue++;
		this.onChange?.();
	}

	list(): readonly PermissionRequirement[] {
		return this.rules.map((rule) => ({ ...rule }));
	}
}

export function normalizePathForPolicy(value: string): string {
	return value.replace(/\\/g, "/");
}

export function resolveToolPath(value: string, cwd: string): string {
	const normalized = normalizeToolPathInput(value);
	return canonicalize(isAbsolute(normalized) ? normalized : resolve(cwd, normalized));
}

export function canonicalize(value: string): string {
	let cursor = resolve(value);
	const missing: string[] = [];

	while (!existsSync(cursor)) {
		const parent = dirname(cursor);
		if (parent === cursor) break;
		missing.unshift(cursor.slice(parent.length).replace(/^[/\\]+/, ""));
		cursor = parent;
	}

	const base = existsSync(cursor) ? realpathSync.native(cursor) : cursor;
	return resolve(base, ...missing);
}

export function isInsideRoots(target: string, roots: readonly string[]): boolean {
	const canonicalTarget = canonicalize(target);
	return roots.some((root) => {
		const rel = relative(canonicalize(root), canonicalTarget);
		return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
	});
}

export function isSensitiveEnvPath(target: string): boolean {
	const name = normalizePathForPolicy(target).split("/").at(-1)?.toLowerCase() ?? "";
	return name !== ".env.example" && (name === ".env" || name.startsWith(".env."));
}

export function findExternalReadGrantRoot(target: string): string | undefined {
	const resolvedTarget = canonicalize(target);
	let cursor = isDirectory(resolvedTarget) ? resolvedTarget : dirname(resolvedTarget);
	let packageRoot: string | undefined;

	while (true) {
		if (isBroadExternalGrantRoot(cursor)) return packageRoot;
		const marker = externalReadRootMarker(cursor);
		if (marker === "project") return cursor;
		if (marker === "package" && !packageRoot) packageRoot = cursor;
		const parent = dirname(cursor);
		if (parent === cursor) return packageRoot;
		cursor = parent;
	}
}

export function collectPermissionRequest(
	event: ToolCallLike,
	cwd: string,
	policyOrRoots: PermissionPathPolicy | readonly string[],
	agentName?: string,
): PermissionRequest | undefined {
	const policy: PermissionPathPolicy = "projectRoots" in policyOrRoots
		? policyOrRoots
		: { projectRoots: policyOrRoots };
	const paths = extractToolPathIntents(event, cwd).filter(
		(intent) => !(event.toolName === "bash" && isBashNullDevicePath(intent.path)),
	);
	const requirements: PermissionRequirement[] = [];

	for (const intent of paths) {
		const target = resolveToolPath(intent.path, cwd);
		const policyPath = normalizePathForPolicy(target);
		const trustedRead =
			intent.access === "read" &&
			(isInsideRoots(target, policy.trustedReadRoots ?? []) || isExactPath(target, policy.trustedReadFiles ?? []));

		if (!isInsideRoots(target, policy.projectRoots) && !trustedRead) {
			const grantRoot = intent.access === "read" ? findExternalReadGrantRoot(target) : undefined;
			requirements.push({
				permission: "external_directory",
				access: intent.access,
				pattern: policyPath,
				alwaysPattern: `${normalizePathForPolicy(grantRoot ?? dirname(target))}/*`,
				reason: `Access outside the project: ${policyPath}`,
			});
		}

		const sensitiveRead =
			intent.access === "read" &&
			(isSensitiveEnvPath(target) ||
				isInsideRoots(target, policy.sensitiveReadRoots ?? []) ||
				isExactPath(target, policy.sensitiveReadFiles ?? []));
		if (sensitiveRead) {
			requirements.push({
				permission: "read",
				access: "read",
				pattern: policyPath,
				alwaysPattern: policyPath,
				reason: `Read sensitive file: ${policyPath}`,
			});
		}
	}

	const unique = dedupe(requirements);
	if (unique.length === 0) return undefined;

	return {
		toolName: event.toolName,
		title: titleFor(event),
		detail: detailFor(event),
		requirements: unique,
		...(agentName ? { agentName } : {}),
	};
}

function extractToolPathIntents(event: ToolCallLike, cwd: string): ToolPathIntent[] {
	if (PATH_TOOLS.has(event.toolName)) {
		const value = event.input.path;
		const access: PathAccess = READ_PATH_TOOLS.has(event.toolName) ? "read" : "write";
		if (typeof value === "string" && value.trim()) return [{ path: value, access }];
		return event.toolName === "grep" || event.toolName === "find" || event.toolName === "ls"
			? [{ path: cwd, access }]
			: [];
	}
	if (event.toolName === "bash" && typeof event.input.command === "string") {
		return extractStaticShellPathIntents(event.input.command);
	}

	const conventional = ["path", "filePath", "directory", "cwd"];
	return conventional.flatMap((key) => {
		const value = event.input[key];
		return typeof value === "string" && value.trim() ? [{ path: value, access: "unknown" as const }] : [];
	});
}

export function extractStaticShellPaths(command: string): string[] {
	return extractStaticShellPathIntents(command).map((intent) => intent.path);
}

export function extractStaticShellPathIntents(command: string): ToolPathIntent[] {
	const tokens = tokenizeShell(command);
	const intents: ToolPathIntent[] = [];
	let segment: string[] = [];

	const flush = (): void => {
		if (segment.length === 0) return;
		intents.push(...shellSegmentIntents(segment));
		segment = [];
	};

	for (const token of tokens) {
		if (SHELL_SEPARATORS.has(token)) flush();
		else segment.push(token);
	}
	flush();
	return intents;
}

function shellSegmentIntents(tokens: string[]): ToolPathIntent[] {
	const redirects: ToolPathIntent[] = [];
	const commandTokens: string[] = [];

	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (!REDIRECTIONS.has(token)) {
			commandTokens.push(token);
			continue;
		}
		if (REDIRECTIONS_WITHOUT_TARGET.has(token)) continue;
		const target = tokens[++index];
		if (!target) continue;
		redirects.push({ path: unquote(target), access: token === "<" ? "read" : "write" });
	}

	const commandIndex = commandTokens.findIndex((token) => SHELL_FILE_COMMANDS.has(unquote(token).toLowerCase()));
	if (commandIndex < 0) return redirects;
	const command = unquote(commandTokens[commandIndex]).toLowerCase();
	let args = commandTokens
		.slice(commandIndex + 1)
		.filter((token) => !token.startsWith("-"))
		.map(unquote);

	if (command === "chmod" && args[0] && (/^[0-7]+$/.test(args[0]) || args[0].startsWith("+"))) args = args.slice(1);
	if (command === "chown" && args.length > 0) args = args.slice(1);
	if (args.length === 0) return redirects;

	if (command === "cat" || command === "cd") {
		return [...args.map((path) => ({ path, access: "read" as const })), ...redirects];
	}
	if (command === "cp" && args.length > 1) {
		return [
			...args.slice(0, -1).map((path) => ({ path, access: "read" as const })),
			{ path: args.at(-1)!, access: "write" },
			...redirects,
		];
	}
	return [...args.map((path) => ({ path, access: "write" as const })), ...redirects];
}

function tokenizeShell(command: string): string[] {
	return command.match(/"(?:\\.|[^"\\])*"|'[^']*'|2>>|2>&1|2>|1>>|1>|>&1|&>|>>|&&|\|\||[;|<>]|[^\s;|<>]+/g) ?? [];
}

function unquote(value: string): string {
	if (
		value.length >= 2 &&
		((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
	) {
		return value.slice(1, -1);
	}
	return value;
}

function normalizeToolPathInput(value: string): string {
	let normalized = value.trim().replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
	if (normalized.startsWith("@")) normalized = normalized.slice(1);
	if (normalized.startsWith("file://")) normalized = fileURLToPath(normalized);
	if (normalized === "~" || normalized.startsWith("~/") || normalized.startsWith("~\\")) {
		normalized = resolve(homedir(), normalized.slice(normalized === "~" ? 1 : 2));
	}
	return process.platform === "win32" ? fromWindowsShellPath(normalized) : normalized;
}

function isExactPath(target: string, candidates: readonly string[]): boolean {
	const comparableTarget = comparablePath(canonicalize(target));
	return candidates.some((candidate) => comparablePath(canonicalize(candidate)) === comparableTarget);
}

function externalReadRootMarker(directory: string): "project" | "package" | undefined {
	if (
		isFileOrDirectory(join(directory, ".git")) ||
		EXTERNAL_READ_PROJECT_ROOT_MARKERS.some((marker) => isFile(join(directory, marker))) ||
		EXTERNAL_READ_COMPOUND_PROJECT_ROOT_MARKERS.some((marker) => isFile(join(directory, ...marker)))
	) {
		return "project";
	}
	return EXTERNAL_READ_PACKAGE_ROOT_MARKERS.some((marker) => isFile(join(directory, marker)))
		? "package"
		: undefined;
}

function isFile(target: string): boolean {
	try {
		return statSync(target).isFile();
	} catch {
		return false;
	}
}

function isFileOrDirectory(target: string): boolean {
	try {
		const stat = statSync(target);
		return stat.isFile() || stat.isDirectory();
	} catch {
		return false;
	}
}

function isDirectory(target: string): boolean {
	try {
		return statSync(target).isDirectory();
	} catch {
		return false;
	}
}

function isBroadExternalGrantRoot(directory: string): boolean {
	const resolved = canonicalize(directory);
	if (dirname(resolved) === resolved) return true;

	const broadRoots = [
		homedir(),
		tmpdir(),
		process.env.TEMP,
		process.env.TMP,
		process.env.PROGRAMDATA,
		process.env.ProgramFiles,
		process.env["ProgramFiles(x86)"],
	].filter((item): item is string => Boolean(item?.trim()));
	if (broadRoots.some((root) => comparablePath(canonicalize(root)) === comparablePath(resolved))) return true;

	const normalized = normalizePathForPolicy(resolved).replace(/\/$/, "");
	return /^[a-z]:\/users\/[^/]+(?:\/appdata(?:\/(?:local|locallow|roaming)(?:\/temp)?)?)?$/i.test(normalized) ||
		/^[a-z]:\/(?:programdata|program files(?: \(x86\))?|windows)$/i.test(normalized) ||
		/^\/(?:home|users)\/[^/]+$/i.test(normalized) ||
		normalized === "/tmp" || normalized === "/var/tmp";
}

function comparablePath(value: string): string {
	const normalized = normalizePathForPolicy(value);
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function fromWindowsShellPath(value: string): string {
	if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return value;
	const match = value.match(/^\/(?:mnt\/|cygdrive\/)?([a-zA-Z])(?:\/(.*))?$/);
	return match ? `${match[1].toUpperCase()}:\\${(match[2] ?? "").replace(/\//g, "\\")}` : value;
}

function dedupe(requirements: PermissionRequirement[]): PermissionRequirement[] {
	const seen = new Set<string>();
	return requirements.filter((requirement) => {
		const key = `${requirement.permission}\0${requirementAccess(requirement)}\0${requirement.pattern}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function titleFor(event: ToolCallLike): string {
	if (event.toolName === "bash") return "Shell command requires permission";
	if (event.toolName === "read") return "File read requires permission";
	return `${event.toolName} requires permission`;
}

function detailFor(event: ToolCallLike): string {
	if (event.toolName === "bash") return `$ ${String(event.input.command ?? "")}`;
	const path = event.input.path;
	return typeof path === "string" ? path : JSON.stringify(event.input);
}

export function requirementAccess(requirement: PermissionRequirement): PathAccess {
	return requirement.access ?? (requirement.permission === "read" ? "read" : "unknown");
}

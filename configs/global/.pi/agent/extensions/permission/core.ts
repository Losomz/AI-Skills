import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type PermissionName = "external_directory" | "read";

export interface PermissionRequirement {
	permission: PermissionName;
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

const PATH_TOOLS = new Set(["read", "edit", "write", "grep", "find", "ls"]);
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
const REDIRECTIONS = new Set([">", ">>", "<", "2>", "2>>"]);

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

	allows(requirement: PermissionRequirement): boolean {
		return this.rules.some(
			(rule) => rule.permission === requirement.permission && wildcardMatch(rule.alwaysPattern, requirement.pattern),
		);
	}

	add(requirements: readonly PermissionRequirement[]): void {
		for (const requirement of requirements) {
			if (
				!this.rules.some(
					(rule) =>
						rule.permission === requirement.permission && rule.alwaysPattern === requirement.alwaysPattern,
				)
			) {
				this.rules.push({ ...requirement });
			}
		}
	}

	clear(): void {
		this.rules.length = 0;
	}

	remove(permission: PermissionName, alwaysPattern: string): boolean {
		const index = this.rules.findIndex(
			(rule) => rule.permission === permission && rule.alwaysPattern === alwaysPattern,
		);
		if (index < 0) return false;
		this.rules.splice(index, 1);
		return true;
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

export function collectPermissionRequest(
	event: ToolCallLike,
	cwd: string,
	projectRoots: readonly string[],
	agentName?: string,
): PermissionRequest | undefined {
	const paths = extractToolPaths(event, cwd);
	const requirements: PermissionRequirement[] = [];

	for (const rawPath of paths) {
		const target = resolveToolPath(rawPath, cwd);
		const policyPath = normalizePathForPolicy(target);

		if (!isInsideRoots(target, projectRoots)) {
			requirements.push({
				permission: "external_directory",
				pattern: policyPath,
				alwaysPattern: `${normalizePathForPolicy(dirname(target))}/*`,
				reason: `Access outside the project: ${policyPath}`,
			});
		}

		if (event.toolName === "read" && isSensitiveEnvPath(target)) {
			requirements.push({
				permission: "read",
				pattern: policyPath,
				alwaysPattern: policyPath,
				reason: `Read sensitive environment file: ${policyPath}`,
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

function extractToolPaths(event: ToolCallLike, cwd: string): string[] {
	if (PATH_TOOLS.has(event.toolName)) {
		const value = event.input.path;
		if (typeof value === "string" && value.trim()) return [value];
		return event.toolName === "grep" || event.toolName === "find" || event.toolName === "ls" ? [cwd] : [];
	}
	if (event.toolName === "bash" && typeof event.input.command === "string") {
		return extractStaticShellPaths(event.input.command);
	}

	const conventional = ["path", "filePath", "directory", "cwd"];
	return conventional.flatMap((key) => {
		const value = event.input[key];
		return typeof value === "string" && value.trim() ? [value] : [];
	});
}

export function extractStaticShellPaths(command: string): string[] {
	const tokens = tokenizeShell(command);
	const paths: string[] = [];
	let fileCommand = false;
	let expectingRedirect = false;

	for (const token of tokens) {
		if (SHELL_SEPARATORS.has(token)) {
			fileCommand = false;
			expectingRedirect = false;
			continue;
		}
		if (REDIRECTIONS.has(token)) {
			expectingRedirect = true;
			continue;
		}
		if (expectingRedirect) {
			paths.push(unquote(token));
			expectingRedirect = false;
			continue;
		}
		if (!fileCommand) {
			fileCommand = SHELL_FILE_COMMANDS.has(token.toLowerCase());
			continue;
		}
		if (!token.startsWith("-") && !(token.startsWith("+") && tokens[0]?.toLowerCase() === "chmod")) {
			paths.push(unquote(token));
		}
	}

	return paths;
}

function tokenizeShell(command: string): string[] {
	return command.match(/"(?:\\.|[^"\\])*"|'[^']*'|&&|\|\||2>>|2>|>>|[;|<>]|[^\s;|<>]+/g) ?? [];
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

function fromWindowsShellPath(value: string): string {
	if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return value;
	const match = value.match(/^\/(?:mnt\/|cygdrive\/)?([a-zA-Z])(?:\/(.*))?$/);
	return match ? `${match[1].toUpperCase()}:\\${(match[2] ?? "").replace(/\//g, "\\")}` : value;
}

function dedupe(requirements: PermissionRequirement[]): PermissionRequirement[] {
	const seen = new Set<string>();
	return requirements.filter((requirement) => {
		const key = `${requirement.permission}\0${requirement.pattern}`;
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

import { posix } from "node:path";

import { requirementAccess, type PermissionRequest, type PermissionRequirement } from "./core.ts";

export type PermissionScopeLabel = "External" | "External read" | "External write" | "Sensitive read";

export interface PermissionScope {
	label: PermissionScopeLabel;
	scope: string;
}

export interface PermissionPresentation {
	summary: string;
	target: string;
	requester: string | undefined;
	sessionScopes: PermissionScope[];
}

export type PermissionPromptStage = "decision" | "feedback";

export interface PermissionPromptState {
	stage: PermissionPromptStage;
	selected: number;
	feedback: string;
}

export type PermissionPromptDecision =
	| { kind: "once" }
	| { kind: "always" }
	| { kind: "reject"; feedback?: string };

export type PermissionPromptAction =
	| { type: "move"; delta: -1 | 1 }
	| { type: "submit"; agentName?: string }
	| { type: "escape" }
	| { type: "append"; value: string }
	| { type: "backspace" };

export type PermissionPromptReduction =
	| { state: PermissionPromptState }
	| { decision: PermissionPromptDecision };

export interface PermissionPageLine {
	kind:
		| "header"
		| "blank"
		| "summary"
		| "target"
		| "scope-heading"
		| "scope"
		| "options"
		| "feedback-heading"
		| "feedback-instruction"
		| "feedback-input";
	text: string;
	options?: string[];
}

const DECISION_OPTIONS = ["Allow once", "Allow always", "Reject"] as const;

export interface PermissionGrantChecker {
	allows(requirement: PermissionRequirement): boolean;
}

export function getOutstandingRequirements(
	request: PermissionRequest,
	grants: PermissionGrantChecker,
): PermissionRequirement[] {
	return request.requirements.filter((requirement) => !grants.allows(requirement));
}

/** Convert a permission request into display data without changing the request. */
export function presentPermissionRequest(
	request: PermissionRequest,
	cwd: string,
	home: string,
): PermissionPresentation {
	return {
		summary: summarize(request),
		target: presentTarget(request, cwd, home),
		requester: request.agentName?.trim() || undefined,
		sessionScopes: presentScopes(request, cwd, home),
	};
}

export function createPermissionPromptState(): PermissionPromptState {
	return { stage: "decision", selected: 0, feedback: "" };
}

export function reducePermissionPrompt(
	state: PermissionPromptState,
	action: PermissionPromptAction,
): PermissionPromptReduction {
	if (action.type === "move") {
		if (state.stage !== "decision") return { state };
		return {
			state: {
				...state,
				selected: (state.selected + action.delta + DECISION_OPTIONS.length) % DECISION_OPTIONS.length,
			},
		};
	}

	if (action.type === "escape") {
		if (state.stage === "feedback") {
			return { state: { ...state, stage: "decision", selected: 2, feedback: "" } };
		}
		return { decision: { kind: "reject" } };
	}

	if (action.type === "append") {
		if (state.stage !== "feedback") return { state };
		return { state: { ...state, feedback: state.feedback + action.value } };
	}

	if (action.type === "backspace") {
		if (state.stage !== "feedback") return { state };
		return { state: { ...state, feedback: Array.from(state.feedback).slice(0, -1).join("") } };
	}

	if (state.stage === "feedback") {
		const feedback = state.feedback.trim();
		return { decision: feedback ? { kind: "reject", feedback } : { kind: "reject" } };
	}

	if (state.selected === 0) return { decision: { kind: "once" } };
	if (state.selected === 1) return { decision: { kind: "always" } };
	if (action.agentName?.trim()) {
		return { state: { ...state, stage: "feedback", selected: 2, feedback: "" } };
	}
	return { decision: { kind: "reject" } };
}

export function layoutPermissionOptions(options: readonly string[], width: number): string[][] {
	if (options.length === 0) return [];
	const horizontalWidth = options.reduce((total, option) => total + option.length + 2, 0) + (options.length - 1) * 2;
	return horizontalWidth <= width ? [Array.from(options)] : options.map((option) => [option]);
}

export function permissionPageModel(
	presentation: PermissionPresentation,
	state: PermissionPromptState,
	width: number,
): PermissionPageLine[] {
	if (state.stage === "feedback") {
		const agent = presentation.requester;
		return [
			{
				kind: "feedback-heading",
				text: agent ? `Reject permission [${agent}]` : "Reject permission",
			},
			{
				kind: "feedback-instruction",
				text: agent ? `Tell ${agent} what to do differently` : "Tell the agent what to do differently",
			},
			{ kind: "blank", text: "" },
			{ kind: "feedback-input", text: `> ${state.feedback}|` },
		];
	}

	const agent = presentation.requester ? ` [${presentation.requester}]` : "";
	const lines: PermissionPageLine[] = [
		{ kind: "header", text: `Permission required${agent}` },
		{ kind: "blank", text: "" },
		{ kind: "summary", text: presentation.summary },
		{ kind: "target", text: presentation.target },
	];

	if (presentation.sessionScopes.length === 1) {
		lines.push({
			kind: "scope",
			text: `Session grant  ${presentation.sessionScopes[0].scope}`,
		});
	} else if (presentation.sessionScopes.length > 1) {
		lines.push({ kind: "scope-heading", text: "Session grants" });
		for (const scope of presentation.sessionScopes) {
			lines.push({ kind: "scope", text: `${scope.label}  ${scope.scope}` });
		}
	}

	lines.push({ kind: "blank", text: "" });
	for (const options of layoutPermissionOptions(DECISION_OPTIONS, width)) {
		lines.push({ kind: "options", text: options.join("  "), options });
	}
	return lines;
}

function summarize(request: PermissionRequest): string {
	if (request.toolName === "bash") return "Shell command";

	const hasExternal = request.requirements.some((item) => item.permission === "external_directory");
	const hasSensitive = request.requirements.some((item) => item.permission === "read");
	if (request.toolName === "read") {
		if (hasExternal && hasSensitive) return "Read sensitive file outside project";
		if (hasExternal) return "Read outside project";
		if (hasSensitive) return "Read sensitive file";
	}

	const action = toolLabel(request.toolName);
	if (hasExternal && hasSensitive) return `${action} sensitive file outside project`;
	if (hasExternal) return `${action} outside project`;
	return action;
}

function toolLabel(toolName: string): string {
	const labels: Record<string, string> = {
		edit: "Edit",
		find: "Find",
		grep: "Search",
		ls: "List",
		write: "Write",
	};
	if (labels[toolName]) return labels[toolName];
	return toolName
		.trim()
		.replace(/[-_]+/g, " ")
		.replace(/\b\w/g, (character) => character.toUpperCase());
}

function presentTarget(request: PermissionRequest, cwd: string, home: string): string {
	const detail = normalizeSlashes(request.detail);
	return request.toolName === "bash" ? compactCommand(detail, cwd, home) : compactPath(detail, cwd, home);
}

function presentScopes(request: PermissionRequest, cwd: string, home: string): PermissionScope[] {
	const seen = new Set<string>();
	const scopes: PermissionScope[] = [];

	for (const requirement of request.requirements) {
		const key = `${requirement.permission}\0${requirementAccess(requirement)}\0${requirement.alwaysPattern}`;
		if (seen.has(key)) continue;
		seen.add(key);
		scopes.push({
			label: scopeLabel(requirement),
			scope: compactPath(requirement.alwaysPattern, cwd, home),
		});
	}

	return scopes;
}

function scopeLabel(requirement: PermissionRequirement): PermissionScopeLabel {
	if (requirement.permission === "read") return "Sensitive read";
	const access = requirementAccess(requirement);
	if (access === "read") return "External read";
	if (access === "write") return "External write";
	return "External";
}

function compactCommand(command: string, cwd: string, home: string): string {
	let result = command;
	const normalizedCwd = absolutePath(cwd);
	const normalizedHome = absolutePath(home);

	if (normalizedCwd) result = replacePathPrefix(result, normalizedCwd, ".");
	if (normalizedHome) result = replacePathPrefix(result, normalizedHome, "~");
	return result;
}

function compactPath(value: string, cwd: string, home: string): string {
	const normalized = normalizeSlashes(value);
	const target = absolutePath(normalized);
	if (!target) return normalized;

	const normalizedCwd = absolutePath(cwd);
	const insideCwd = normalizedCwd && relativePath(target, normalizedCwd);
	if (insideCwd !== undefined) return insideCwd;

	const normalizedHome = absolutePath(home);
	const relativeToHome = normalizedHome && relativePath(target, normalizedHome);
	if (relativeToHome !== undefined) return relativeToHome === "." ? "~" : `~/${relativeToHome}`;

	const relativeToCwd = normalizedCwd && relativePathFromCwd(target, normalizedCwd);
	if (relativeToCwd !== undefined) return relativeToCwd;

	return normalized;
}

function replacePathPrefix(value: string, base: string, replacement: string): string {
	if (base === "/" || base.endsWith(":/")) return value;

	const comparableValue = comparable(value);
	const comparableBase = comparable(base);
	let cursor = 0;
	let result = "";

	while (cursor < value.length) {
		const index = comparableValue.indexOf(comparableBase, cursor);
		if (index < 0) break;

		const before = value[index - 1];
		const after = value[index + base.length];
		const validBefore = index === 0 || isCommandBoundary(before);
		const validAfter = after === undefined || after === "/" || isCommandBoundary(after);
		const end = index + base.length;

		if (validBefore && validAfter) {
			result += value.slice(cursor, index) + replacement;
			cursor = end;
		} else {
			result += value.slice(cursor, end);
			cursor = end;
		}
	}

	return result + value.slice(cursor);
}

function relativePath(target: string, base: string): string | undefined {
	const comparableTarget = comparable(target);
	const comparableBase = comparable(base);
	if (comparableTarget !== comparableBase && !comparableTarget.startsWith(`${comparableBase}/`)) return undefined;

	const suffix = target.slice(base.length).replace(/^\/+/, "");
	return suffix || ".";
}

function relativePathFromCwd(target: string, base: string): string | undefined {
	if (pathRoot(target) !== pathRoot(base)) return undefined;
	const relative = posix.relative(base, target);
	return relative || ".";
}

function pathRoot(value: string): string {
	if (value.startsWith("/")) return "/";
	const drive = value.match(/^[A-Za-z]:\//);
	return drive ? drive[0].toLowerCase() : "";
}

function absolutePath(value: string): string | undefined {
	const normalized = normalizeSlashes(value);
	if (!isAbsolutePath(normalized)) return undefined;
	return trimTrailingSlashes(posix.normalize(normalized));
}

function normalizeSlashes(value: string): string {
	return value.replace(/\\/g, "/");
}

function trimTrailingSlashes(value: string): string {
	if (value === "/" || /^[A-Za-z]:\/$/.test(value)) return value;
	return value.replace(/\/+$/, "");
}

function isAbsolutePath(value: string): boolean {
	return value.startsWith("/") || /^[A-Za-z]:\//.test(value);
}

function comparable(value: string): string {
	return isWindowsPath(value) ? value.toLowerCase() : value;
}

function isWindowsPath(value: string): boolean {
	return /^[A-Za-z]:\//.test(value) || value.startsWith("//");
}

function isCommandBoundary(value: string | undefined): boolean {
	return value === undefined || /\s/.test(value) || "\"'`;&|<>()[ ]{}".includes(value);
}

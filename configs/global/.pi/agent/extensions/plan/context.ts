/** Prompt loading and cleanup of Plan-owned hidden context messages. */

import * as fs from "node:fs";
import * as path from "node:path";
import type { RunControl } from "./state.ts";

export const PLAN_CONTEXT_TYPE = "plan-context";

const LEGACY_CONTEXT_TYPES = new Set([PLAN_CONTEXT_TYPE, "plan-mode-context", "plan-execution-context"]);
const FALLBACK_PLAN = `<system-reminder>
# Plan - System Reminder

Plan mode is ACTIVE. Inspect and plan, but do not modify the workspace or system with the main agent.

Available main-agent tools in Plan mode: {{TOOLS}}
</system-reminder>`;
const FALLBACK_INACTIVE = `<system-reminder>
# Plan - Inactive Transition

Plan mode is now INACTIVE. Previous Plan-only restrictions no longer apply. Do not execute an earlier plan merely because the mode changed; follow the user's current request.
</system-reminder>`;
const FALLBACK_EXECUTE = "Execute the approach discussed above. Plan restrictions are removed and the previous tool set is restored.";

export interface PlanPrompts {
	plan: string;
	inactive: string;
	execute: string;
}

export interface PlanDirective extends RunControl {
	owner: "plan";
	content: string;
}

export interface MessageLike {
	role?: unknown;
	customType?: unknown;
	content?: unknown;
	details?: unknown;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function readPrompt(filePath: string, fallback: string, diagnostics: string[]): string {
	try {
		const content = fs.readFileSync(filePath, "utf8").trim();
		if (content) return content;
		diagnostics.push(`Plan prompt fallback used for ${path.basename(filePath)}: file is empty`);
	} catch (error) {
		diagnostics.push(`Plan prompt fallback used for ${path.basename(filePath)}: ${errorText(error)}`);
	}
	return fallback;
}

export function loadPlanPrompts(extensionDir: string): { prompts: PlanPrompts; diagnostics: string[] } {
	const diagnostics: string[] = [];
	const promptsDir = path.join(extensionDir, "prompts");
	return {
		prompts: {
			plan: readPrompt(path.join(promptsDir, "plan.md"), FALLBACK_PLAN, diagnostics),
			inactive: readPrompt(path.join(promptsDir, "inactive.md"), FALLBACK_INACTIVE, diagnostics),
			execute: readPrompt(path.join(promptsDir, "execute.md"), FALLBACK_EXECUTE, diagnostics),
		},
		diagnostics,
	};
}

export function renderPlanPrompt(template: string, tools: readonly string[]): string {
	return template.replace(/\{\{TOOLS\}\}/g, tools.join(", ") || "read/search tools if available");
}

export function buildExecuteMessage(template: string, additionalInstructions?: string): string {
	const extra = additionalInstructions?.trim();
	return extra ? `${template}\n\nAdditional user instructions:\n${extra}` : template;
}

export function createControlPayload(directive: PlanDirective) {
	return {
		customType: PLAN_CONTEXT_TYPE,
		content: directive.content,
		display: false as const,
		details: { owner: directive.owner, kind: directive.kind, revision: directive.revision },
	};
}

function controlDetails(message: MessageLike): RunControl | undefined {
	if (typeof message.details !== "object" || message.details === null || Array.isArray(message.details)) return undefined;
	const details = message.details as Record<string, unknown>;
	if (details.owner !== "plan" || (details.kind !== "active" && details.kind !== "inactive")) return undefined;
	if (typeof details.revision !== "number" || !Number.isSafeInteger(details.revision) || details.revision < 0) return undefined;
	return { kind: details.kind, revision: details.revision };
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (typeof part === "string") return part;
			if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function isLegacyControl(message: MessageLike): boolean {
	if (message.role !== "user" && message.role !== "custom") return false;
	const text = contentText(message.content);
	return (
		/^\s*<system-reminder>\s*(?:\r?\n)+#\s*Plan(?: Mode)?\s*-\s*System Reminder\b[\s\S]*<\/system-reminder>\s*$/i.test(text) ||
		/^\s*\[PLAN MODE ACTIVE\]\s*\r?\n\s*You are in plan mode\s*-\s*a read-only exploration mode\b[\s\S]*$/i.test(text) ||
		/^\s*\[EXECUTING PLAN\s*-\s*Full tool access enabled\]\s*(?:\r?\n){2}\s*Remaining steps:[\s\S]*$/i.test(text)
	);
}

/** Keep at most the current structured Plan control and remove legacy hidden reminders. */
export function normalizePlanContext(messages: readonly MessageLike[], directive?: PlanDirective): MessageLike[] {
	let keepIndex = -1;
	if (directive) {
		for (let index = messages.length - 1; index >= 0; index--) {
			const details = controlDetails(messages[index]);
			if (messages[index].customType === PLAN_CONTEXT_TYPE && details?.kind === directive.kind && details.revision === directive.revision) {
				keepIndex = index;
				break;
			}
		}
	}

	const normalized = messages.filter((message, index) => {
		if (typeof message.customType === "string" && LEGACY_CONTEXT_TYPES.has(message.customType)) return index === keepIndex;
		return !isLegacyControl(message);
	});
	if (directive && keepIndex < 0) {
		normalized.push({ role: "custom", ...createControlPayload(directive), timestamp: Date.now() } as MessageLike);
	}
	return normalized;
}

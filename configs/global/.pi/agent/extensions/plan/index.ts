/**
 * Plan Extension
 *
 * Orchestration and planning mode. The main agent may inspect, search, and
 * analyze, but write/destructive operations are blocked at the tool layer.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isSafeCommand } from "./utils.js";

const PLAN_TOOL_CANDIDATES = ["read", "bash", "grep", "find", "ls", "questionnaire", "subagent"];
const PLAN_STATE_TYPES = new Set(["plan-state", "plan-mode"]);
const PLAN_CONTEXT_TYPES = new Set(["plan-context", "plan-mode-context"]);

const extensionDir = path.dirname(fileURLToPath(import.meta.url));
const promptsDir = path.join(extensionDir, "prompts");

function readPrompt(name: string, fallback: string): string {
	try {
		return fs.readFileSync(path.join(promptsDir, name), "utf-8").trim();
	} catch {
		return fallback.trim();
	}
}

const PLAN_PROMPT_TEMPLATE = readPrompt(
	"plan.md",
	`<system-reminder>
# Plan - System Reminder

Plan mode is ACTIVE. Orchestrate, explore, and plan. Do not edit files or run commands that mutate the workspace/system.

Available main-agent tools in plan mode: {{TOOLS}}
</system-reminder>`,
);

const EXECUTE_PROMPT_TEMPLATE = readPrompt(
	"execute.md",
	"Execute the approach discussed above. Full tool access is now enabled.",
);

function contentToText(content: unknown): string {
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

function isPlanContextMessage(message: AgentMessage & { customType?: string }): boolean {
	if (message.customType && PLAN_CONTEXT_TYPES.has(message.customType)) return true;
	if (message.role !== "user") return false;

	const text = contentToText(message.content);
	return (
		text.includes("Plan - System Reminder") ||
		text.includes("Plan Mode - System Reminder") ||
		text.includes("[PLAN MODE ACTIVE]")
	);
}

function getLatestPlanState(ctx: ExtensionContext): { enabled?: boolean } | undefined {
	return ctx.sessionManager
		.getEntries()
		.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType && PLAN_STATE_TYPES.has(entry.customType))
		.pop() as { data?: { enabled?: boolean } } | undefined;
}

export default function planExtension(pi: ExtensionAPI): void {
	let planEnabled = false;
	let toolsBeforePlan: string[] | undefined;

	pi.registerFlag("plan", {
		description: "Start in plan mode (orchestration + analysis, no write operations)",
		type: "boolean",
		default: false,
	});

	function getPlanTools(): string[] {
		const available = new Set(pi.getAllTools().map((tool) => tool.name));
		const active = new Set(pi.getActiveTools());
		return PLAN_TOOL_CANDIDATES.filter((tool) => available.has(tool) && active.has(tool));
	}

	function renderPlanPrompt(): string {
		const tools = getPlanTools().join(", ") || "read/search tools if available";
		return PLAN_PROMPT_TEMPLATE.replace(/\{\{TOOLS\}\}/g, tools);
	}

	function buildExecuteMessage(additionalInstructions?: string): string {
		const base = EXECUTE_PROMPT_TEMPLATE;
		const extra = additionalInstructions?.trim();
		return extra ? `${base}\n\nAdditional user instructions:\n${extra}` : base;
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (planEnabled) {
			ctx.ui.setStatus("plan", ctx.ui.theme.fg("warning", "⏸ plan"));
		} else {
			ctx.ui.setStatus("plan", undefined);
		}
		ctx.ui.setStatus("plan-mode", undefined);
		ctx.ui.setWidget("plan-todos", undefined);
	}

	function persistState(): void {
		pi.appendEntry("plan-state", { enabled: planEnabled });
	}

	function enablePlan(ctx: ExtensionContext): void {
		if (!planEnabled) toolsBeforePlan = pi.getActiveTools();
		planEnabled = true;
		const tools = getPlanTools();
		pi.setActiveTools(tools);
		ctx.ui.notify(`Plan enabled. Tools: ${tools.join(", ") || "none"}`);
		updateStatus(ctx);
		persistState();
	}

	function disablePlan(ctx: ExtensionContext, notify = true): void {
		planEnabled = false;
		pi.setActiveTools(toolsBeforePlan ?? pi.getActiveTools());
		toolsBeforePlan = undefined;
		if (notify) ctx.ui.notify("Plan disabled. Full access restored.");
		updateStatus(ctx);
		persistState();
	}

	function togglePlan(ctx: ExtensionContext): void {
		if (planEnabled) disablePlan(ctx);
		else enablePlan(ctx);
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (orchestration + analysis, no write operations)",
		handler: async (_args, ctx) => togglePlan(ctx),
	});


	pi.registerShortcut("alt+i", {
		description: "Toggle plan",
		handler: async (ctx) => togglePlan(ctx),
	});

	// Tool-layer guard: prompts guide behavior, but write/destructive bash is blocked here.
	pi.on("tool_call", async (event) => {
		if (!planEnabled || event.toolName !== "bash") return;

		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `Plan: command blocked because it appears to mutate files, dependencies, git state, or the system. Choose Execute or disable /plan before running write operations.\nCommand: ${command}`,
			};
		}
	});

	// Filter stale plan reminders after leaving plan mode.
	pi.on("context", async (event) => {
		if (planEnabled) return;

		return {
			messages: event.messages.filter((message) => !isPlanContextMessage(message as AgentMessage & { customType?: string })),
		};
	});

	pi.on("before_agent_start", async () => {
		if (!planEnabled) return;

		return {
			message: {
				customType: "plan-context",
				content: renderPlanPrompt(),
				display: false,
			},
		};
	});

	pi.on("agent_end", async (event, ctx) => {
		if (event.willRetry) return;
		if (!planEnabled || !ctx.hasUI) return;

		const choice = await ctx.ui.select("Plan - what next?", [
			"Stay",
			"Execute",
			"Execute with additional instructions",
		]);

		let executeMessage: string | undefined;
		if (choice === "Execute") {
			executeMessage = buildExecuteMessage();
		} else if (choice === "Execute with additional instructions") {
			const additionalInstructions = await ctx.ui.input(
				"Additional execution instructions:",
				"Describe what to add or adjust before execution...",
			);

			if (!additionalInstructions?.trim()) {
				ctx.ui.notify("No additional instructions provided. Staying in plan.", "info");
				persistState();
				return;
			}

			executeMessage = buildExecuteMessage(additionalInstructions);
		}

		if (executeMessage) {
			disablePlan(ctx, false);

			// agent_end fires before the active run is fully settled. Defer to the
			// next macrotask so triggerTurn runs when Pi is idle instead of queueing.
			setTimeout(() => {
				pi.sendMessage(
					{
						customType: "plan-execute",
						content: executeMessage,
						display: true,
					},
					{ triggerTurn: true },
				);
			}, 0);
			return;
		}

		persistState();
	});

	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("plan") === true) planEnabled = true;

		const planState = getLatestPlanState(ctx);
		if (planState?.data) planEnabled = planState.data.enabled ?? planEnabled;

		if (planEnabled) {
			toolsBeforePlan = pi.getActiveTools();
			pi.setActiveTools(getPlanTools());
			persistState();
		}

		updateStatus(ctx);
	});
}

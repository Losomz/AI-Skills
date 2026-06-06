/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, only read-only tools are available.
 *
 * Features:
 * - /plan command or Alt+I to toggle
 * - Bash restricted to allowlisted read-only commands
 * - Opencode-style read-only planning reminder
 * - After each plan-mode turn, choose whether to stay, execute, or execute with extra instructions
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type AgentScope, discoverAgents, findAgentByName } from "../subagent/agents.js";
import { isSafeCommand } from "./utils.js";

// Tools
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire", "subagent"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls", "questionnaire", "subagent"];

type SubagentToolInput = {
	agent?: string;
	tasks?: Array<{ agent?: string }>;
	chain?: Array<{ agent?: string }>;
	agentScope?: AgentScope;
};

function getRequestedSubagentNames(input: SubagentToolInput): string[] {
	const names = new Set<string>();
	if (input.agent) names.add(input.agent);
	for (const task of input.tasks ?? []) if (task.agent) names.add(task.agent);
	for (const step of input.chain ?? []) if (step.agent) names.add(step.agent);
	return Array.from(names);
}

function normalizeAgentScope(value: unknown): AgentScope {
	return value === "user" || value === "both" || value === "project" ? value : "project";
}

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

function getLatestUserText(ctx: ExtensionContext): string {
	const entries = ctx.sessionManager.getBranch();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as { type?: string; message?: { role?: string; content?: unknown } };
		if (entry.type === "message" && entry.message?.role === "user") {
			return contentToText(entry.message.content);
		}
	}
	return "";
}

function hasNegatedAgentMention(text: string, agentName: string): boolean {
	const lowerText = text.toLowerCase();
	const lowerName = agentName.toLowerCase();
	const index = lowerText.indexOf(lowerName);
	if (index < 0) return false;
	const prefix = lowerText.slice(Math.max(0, index - 16), index);
	return /(不要|别|禁止|不能|不允许|勿|do not|don't|dont|not)\s*$/.test(prefix);
}

function isExplicitlyRequestedByUser(ctx: ExtensionContext, agentName: string): boolean {
	const latestUserText = getLatestUserText(ctx);
	if (!latestUserText.toLowerCase().includes(agentName.toLowerCase())) return false;
	return !hasNegatedAgentMention(latestUserText, agentName);
}

function validatePlanModeSubagentCall(input: SubagentToolInput, ctx: ExtensionContext): string | undefined {
	const requestedNames = getRequestedSubagentNames(input);
	if (requestedNames.length === 0) return undefined;

	const agentScope = normalizeAgentScope(input.agentScope);
	const { agents } = discoverAgents(ctx.cwd, agentScope);
	const denied: string[] = [];
	const needsExplicitUserRequest: string[] = [];

	for (const agentName of requestedNames) {
		const agent = findAgentByName(agents, agentName);
		const policy = agent?.planMode ?? "explicit";
		if (policy === "deny") denied.push(agentName);
		else if (policy === "explicit") needsExplicitUserRequest.push(agentName);
	}

	if (denied.length > 0) {
		return `Plan mode: subagent blocked by agent policy: ${denied.join(", ")}.`;
	}

	const missingExplicitRequest = needsExplicitUserRequest.filter((agentName) => !isExplicitlyRequestedByUser(ctx, agentName));
	if (missingExplicitRequest.length > 0) {
		return `Plan mode: writable or unrestricted subagents require an explicit user request. Blocked: ${missingExplicitRequest.join(", ")}. Ask the user to name the subagent if they want it to run.`;
	}

	return undefined;
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let toolsBeforePlanMode: string[] | undefined;

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		ctx.ui.setWidget("plan-todos", undefined);
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		planModeEnabled = !planModeEnabled;

		if (planModeEnabled) {
			toolsBeforePlanMode = pi.getActiveTools();
			pi.setActiveTools(PLAN_MODE_TOOLS);
			ctx.ui.notify(`Plan mode enabled. Tools: ${PLAN_MODE_TOOLS.join(", ")}`);
		} else {
			pi.setActiveTools(toolsBeforePlanMode ?? NORMAL_MODE_TOOLS);
			toolsBeforePlanMode = undefined;
			ctx.ui.notify("Plan mode disabled. Full access restored.");
		}
		updateStatus(ctx);
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
		});
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	pi.registerCommand("todos", {
		description: "Show plan-mode status",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				"Plan mode no longer extracts or tracks numbered todos. Use /plan to stay in read-only planning, then choose Execute when ready, optionally with additional instructions.",
				"info",
			);
		},
	});

	pi.registerShortcut("alt+i", {
		description: "Toggle plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	// Block destructive bash commands and unrequested writable subagents in plan mode
	pi.on("tool_call", async (event, ctx) => {
		if (!planModeEnabled) return;

		if (event.toolName === "bash") {
			const command = event.input.command as string;
			if (!isSafeCommand(command)) {
				return {
					block: true,
					reason: `Plan mode: command blocked (not allowlisted). Choose Execute or use /plan to disable plan mode first.\nCommand: ${command}`,
				};
			}
		}

		if (event.toolName === "subagent") {
			const reason = validatePlanModeSubagentCall(event.input as SubagentToolInput, ctx);
			if (reason) return { block: true, reason };
		}
	});

	// Filter out stale plan mode context when not in plan mode
	pi.on("context", async (event) => {
		if (planModeEnabled) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "plan-mode-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("Plan Mode - System Reminder") && !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) =>
							c.type === "text" &&
							(((c as TextContent).text?.includes("Plan Mode - System Reminder") ?? false) ||
								((c as TextContent).text?.includes("[PLAN MODE ACTIVE]") ?? false)),
					);
				}
				return true;
			}),
		};
	});

	// Inject plan context before agent starts
	pi.on("before_agent_start", async () => {
		if (!planModeEnabled) return;

		return {
			message: {
				customType: "plan-mode-context",
				content: `<system-reminder>
# Plan Mode - System Reminder

CRITICAL: Plan mode ACTIVE - the main agent is in READ-ONLY phase.
STRICTLY FORBIDDEN for the main agent: ANY file edits, modifications, or system
changes. Do NOT use edit/write tools, and do NOT use bash or other tools to
manipulate files. Bash commands may ONLY read, inspect, search, or analyze.
This constraint overrides all other instructions for the main agent.

---

## Responsibility

Your current responsibility is to think, read, search, and analyze the codebase
to construct a well-formed approach for the user's goal. The result should be
comprehensive yet concise, detailed enough to execute effectively while avoiding
unnecessary verbosity.

Ask the user clarifying questions when requirements are ambiguous, when there
are important tradeoffs, or when you need confirmation before choosing an
approach. Do not make large assumptions about user intent.

You do NOT need to force a numbered plan or a specific "Plan:" section. Use the
format that best fits the task: a short explanation, a concise checklist, a few
bullets, or a structured plan are all acceptable.

Subagent policy: you may proactively call only subagents whose frontmatter
allows planMode: auto. Do NOT choose writable/unrestricted subagents yourself.
If the user explicitly names a subagent and asks you to delegate a task to it,
you may call that subagent; the subagent runs according to its own declared
capabilities.

---

## Important

The user indicated that they do not want the main agent to execute yet. You MUST
NOT make edits, run non-readonly bash commands, change configs, install
dependencies, create files, or make commits from the main agent. Only describe
what you would do until the user chooses Execute or Execute with additional
instructions, except when the user explicitly delegates a task to a named
subagent.
</system-reminder>`,
				display: false,
			},
		};
	});

	// Prompt for next action after each plan-mode turn
	pi.on("agent_end", async (event, ctx) => {
		if (event.willRetry) return;
		if (!planModeEnabled || !ctx.hasUI) return;

		const choice = await ctx.ui.select("Plan mode - what next?", [
			"Stay",
			"Execute",
			"Execute with additional instructions",
		]);

		let executeMessage: string | undefined;
		if (choice === "Execute") {
			executeMessage = "Execute the approach discussed above. Full tool access is now enabled.";
		} else if (choice === "Execute with additional instructions") {
			const additionalInstructions = await ctx.ui.input(
				"Additional execution instructions:",
				"Describe what to add or adjust before execution...",
			);

			if (!additionalInstructions?.trim()) {
				ctx.ui.notify("No additional instructions provided. Staying in plan mode.", "info");
				persistState();
				return;
			}

			executeMessage = `Execute the approach discussed above. Full tool access is now enabled.\n\nAdditional user instructions:\n${additionalInstructions.trim()}`;
		}

		if (executeMessage) {
			planModeEnabled = false;
			pi.setActiveTools(toolsBeforePlanMode ?? NORMAL_MODE_TOOLS);
			toolsBeforePlanMode = undefined;
			updateStatus(ctx);
			persistState();

			// agent_end is emitted before the active run is fully settled. Defer to the
			// next macrotask so triggerTurn runs when Pi is idle instead of queueing.
			setTimeout(() => {
				pi.sendMessage(
					{
						customType: "plan-mode-execute",
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

	// Restore state on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		const planModeEntry = ctx.sessionManager
			.getEntries()
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: { enabled: boolean } } | undefined;

		if (planModeEntry?.data) {
			planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
		}

		if (planModeEnabled) {
			pi.setActiveTools(PLAN_MODE_TOOLS);
		} else {
			pi.setActiveTools(NORMAL_MODE_TOOLS);
		}
		updateStatus(ctx);
	});
}

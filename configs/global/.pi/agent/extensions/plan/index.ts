/** Plan extension: Pi integration and the single mode-transition entry point. */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	buildExecuteMessage,
	createControlPayload,
	loadPlanPrompts,
	normalizePlanContext,
	renderPlanPrompt,
	type MessageLike,
	type PlanDirective,
	type PlanPrompts,
} from "./context.ts";
import {
	findLatestPlanState,
	modeFromState,
	PLAN_STATE_TYPE,
	toPersistedState,
	type ModeOrigin,
	type PersistedPlanStateV2,
	type PlanMode,
	type RuntimePlanState,
	type SessionEntryLike,
} from "./state.ts";
import { findToolViolation, restoreAvailableTools, selectPlanTools } from "./utils.ts";

const defaultExtensionDir = path.dirname(fileURLToPath(import.meta.url));

export interface PlanExtensionOptions {
	extensionDir?: string;
	prompts?: PlanPrompts;
	schedule?: (task: () => void) => void;
}

interface ModeResult {
	kind: "applied" | "pending" | "canceled" | "unchanged";
	mode: PlanMode;
}

function unique(names: readonly string[]): string[] {
	return Array.from(new Set(names));
}

export function registerPlanExtension(pi: ExtensionAPI, options: PlanExtensionOptions = {}): void {
	const loaded = options.prompts
		? { prompts: options.prompts, diagnostics: [] as string[] }
		: loadPlanPrompts(options.extensionDir ?? defaultExtensionDir);
	const prompts = loaded.prompts;
	const schedule = options.schedule ?? ((task: () => void) => setImmediate(task));
	const reportedDiagnostics = new Set<string>();

	let state: RuntimePlanState = { mode: "execute", revision: 0 };
	let beforeStartSeen = false;
	let actionPromptOpen = false;
	let executeGeneration = 0;
	let pendingExecuteMessage: string | undefined;

	function availableTools(): string[] {
		return unique(pi.getAllTools().map((tool) => tool.name));
	}

	function persist(): void {
		pi.appendEntry(PLAN_STATE_TYPE, toPersistedState(state));
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		const text = state.pending
			? ctx.ui.theme.fg("warning", `⏳ ${state.mode} → ${state.pending.target}`)
			: state.mode === "plan"
				? ctx.ui.theme.fg("warning", "⏸ plan")
				: undefined;
		ctx.ui.setStatus("plan", text);
		ctx.ui.setStatus("plan-mode", undefined);
		ctx.ui.setWidget("plan-todos", undefined);
	}

	function notify(ctx: ExtensionContext, message: string): void {
		if (ctx.hasUI) ctx.ui.notify(message, "info");
	}

	function reportDiagnostics(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		for (const diagnostic of loaded.diagnostics) {
			if (reportedDiagnostics.has(diagnostic)) continue;
			reportedDiagnostics.add(diagnostic);
			ctx.ui.notify(diagnostic, "warning");
		}
	}

	/** Every mode source, including hydration, passes through this function. */
	function requestMode(
		target: PlanMode,
		origin: ModeOrigin,
		ctx: ExtensionContext,
		restored?: PersistedPlanStateV2,
	): ModeResult {
		if (origin === "hydrate") {
			const targetState = restored ?? { enabled: false, revision: 0 };
			const active = unique(pi.getActiveTools());
			const available = availableTools();
			const outgoingSnapshot = state.mode === "plan" ? state.toolsBeforePlan : undefined;
			const activeSet = new Set(active);
			const disabledInOutgoingPlan = new Set(
				state.mode === "plan" && outgoingSnapshot
					? selectPlanTools(available, outgoingSnapshot).filter((name) => !activeSet.has(name))
					: [],
			);
			const keepCurrentChoices = (baseline: string[]) =>
				state.mode === "execute"
					? baseline.filter((name) => activeSet.has(name))
					: baseline.filter((name) => !disabledInOutgoingPlan.has(name));

			if (target === "plan") {
				const savedBaseline = targetState.toolsBeforePlan ?? outgoingSnapshot ?? active;
				// Use the target branch snapshot, while carrying explicit /tools disables
				// instead of the automatic restrictions from the outgoing Plan branch.
				const baseline = keepCurrentChoices(savedBaseline);
				pi.setActiveTools(selectPlanTools(available, baseline));
				state = {
					mode: "plan",
					revision: targetState.revision,
					toolsBeforePlan: [...baseline],
				};
			} else {
				const savedBaseline = targetState.toolsBeforePlan ?? outgoingSnapshot;
				const baseline = savedBaseline ? keepCurrentChoices(savedBaseline) : undefined;
				if (baseline) pi.setActiveTools(restoreAvailableTools(baseline, available));
				state = {
					mode: "execute",
					revision: targetState.revision,
					toolsBeforePlan: baseline ? [...baseline] : undefined,
					notice: targetState.notice ? { ...targetState.notice } : undefined,
				};
			}
			beforeStartSeen = false;
			updateStatus(ctx);
			return { kind: "applied", mode: state.mode };
		}

		if (!ctx.isIdle()) {
			if (target === state.mode) {
				const canceled = state.pending !== undefined;
				state.pending = undefined;
				updateStatus(ctx);
				if (canceled && origin === "manual") notify(ctx, "Pending Plan mode switch canceled.");
				return { kind: canceled ? "canceled" : "unchanged", mode: state.mode };
			}
			state.pending = { target, origin };
			updateStatus(ctx);
			if (origin === "manual") {
				notify(ctx, `Plan mode will switch to ${target} after the current run settles; this run remains in ${state.mode}.`);
			}
			return { kind: "pending", mode: state.mode };
		}

		if (target === state.mode) {
			state.pending = undefined;
			updateStatus(ctx);
			return { kind: "unchanged", mode: state.mode };
		}

		const revision = state.revision + 1;
		const available = availableTools();
		if (target === "plan") {
			const baseline = unique(pi.getActiveTools());
			const tools = selectPlanTools(available, baseline);
			pi.setActiveTools(tools);
			state = { mode: "plan", revision, toolsBeforePlan: baseline };
			if (origin === "manual") notify(ctx, `Plan enabled. Tools: ${tools.join(", ") || "none"}.`);
		} else {
			const baseline = state.toolsBeforePlan ?? unique(pi.getActiveTools());
			pi.setActiveTools(restoreAvailableTools(baseline, available));
			state = {
				mode: "execute",
				revision,
				toolsBeforePlan: [...baseline],
				notice: origin === "manual" ? { kind: "inactive", revision } : undefined,
			};
			if (origin === "manual") notify(ctx, "Plan disabled. The previous plan will not be executed automatically.");
		}
		persist();
		updateStatus(ctx);
		return { kind: "applied", mode: state.mode };
	}

	function invalidateDeferredExecute(): void {
		pendingExecuteMessage = undefined;
		executeGeneration += 1;
	}

	function handleManualToggle(ctx: ExtensionContext): void {
		invalidateDeferredExecute();
		reportDiagnostics(ctx);
		const desired = state.pending?.target ?? state.mode;
		requestMode(desired === "plan" ? "execute" : "plan", "manual", ctx);
	}

	function currentDirective(): PlanDirective | undefined {
		if (!state.runControl) return undefined;
		return {
			owner: "plan",
			...state.runControl,
			content:
				state.runControl.kind === "active" ? renderPlanPrompt(prompts.plan, pi.getActiveTools()) : prompts.inactive,
		};
	}

	function scheduleExecute(content: string): void {
		const generation = ++executeGeneration;
		schedule(() => {
			if (generation !== executeGeneration || state.mode !== "execute" || state.pending?.target === "plan") return;
			pi.sendMessage(
				{
					customType: "plan-execute",
					content,
					display: true,
					details: { owner: "plan", kind: "execute", revision: state.revision },
				},
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		});
	}

	pi.registerFlag("plan", {
		description: "Start in plan mode (analysis, no main-agent write operations)",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("plan", {
		description: "Toggle plan mode",
		handler: async (_args, ctx) => handleManualToggle(ctx),
	});

	pi.registerShortcut("alt+i", {
		description: "Toggle plan mode",
		handler: handleManualToggle,
	});

	pi.on("tool_call", async (event) => {
		if ((state.runMode ?? state.mode) !== "plan") return;
		const violation = findToolViolation(event.toolName, event.input);
		if (violation) return { block: true, reason: `Plan: ${violation}. Disable Plan or choose Execute first.` };
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		reportDiagnostics(ctx);
		beforeStartSeen = true;
		state.runMode = state.mode;
		if (state.mode === "plan") {
			state.runControl = { kind: "active", revision: state.revision };
		} else if (state.notice) {
			state.runControl = { kind: "inactive", revision: state.notice.revision };
			state.notice = undefined;
			persist();
		} else {
			state.runControl = undefined;
		}
		const directive = currentDirective();
		return directive ? { message: createControlPayload(directive) } : undefined;
	});

	// Custom triggerTurn runs bypass before_agent_start.
	pi.on("agent_start", async () => {
		if (beforeStartSeen) {
			beforeStartSeen = false;
			return;
		}
		// A retry/compaction retry starts another low-level run before agent_settled.
		// Keep the top-level run snapshot and its one-time inactive directive intact.
		if (state.runMode !== undefined) return;
		state.runMode = state.mode;
		state.runControl = state.mode === "plan" ? { kind: "active", revision: state.revision } : undefined;
	});

	pi.on("context", async (event) => ({
		messages: normalizePlanContext(event.messages as unknown as MessageLike[], currentDirective()) as unknown as typeof event.messages,
	}));

	pi.on("agent_settled", async (_event, ctx) => {
		// Another extension may already have started a new turn. Its lifecycle hooks
		// own runMode/runControl now, so leave both pending and run state untouched.
		if (!ctx.isIdle()) return;

		const completedRunMode = state.runMode;
		state.runMode = undefined;
		state.runControl = undefined;
		beforeStartSeen = false;

		if (state.pending) {
			const pending = state.pending;
			const executeMessage = pending.target === "execute" ? pendingExecuteMessage : undefined;
			pendingExecuteMessage = undefined;
			requestMode(pending.target, pending.origin, ctx);
			if (executeMessage && state.mode === "execute") scheduleExecute(executeMessage);
			return;
		}

		if (completedRunMode !== "plan" || state.mode !== "plan" || !ctx.hasUI || actionPromptOpen) return;
		actionPromptOpen = true;
		const promptGeneration = executeGeneration;
		try {
			const choice = await ctx.ui.select("Plan - what next?", ["Stay", "Execute", "Execute with additional instructions"]);
			if (promptGeneration !== executeGeneration) return;
			let executeMessage: string | undefined;
			if (choice === "Execute") {
				executeMessage = buildExecuteMessage(prompts.execute);
			} else if (choice === "Execute with additional instructions") {
				const extra = await ctx.ui.input("Additional execution instructions:", "Describe what to add before execution...");
				if (promptGeneration !== executeGeneration) return;
				if (!extra?.trim()) {
					notify(ctx, "No additional instructions provided. Staying in Plan.");
					return;
				}
				executeMessage = buildExecuteMessage(prompts.execute, extra);
			}
			if (!executeMessage) return;

			const result = requestMode("execute", "execute", ctx);
			if (result.kind === "pending") pendingExecuteMessage = executeMessage;
			else if (result.mode === "execute") scheduleExecute(executeMessage);
		} finally {
			actionPromptOpen = false;
		}
	});

	function hydrateCurrentBranch(ctx: ExtensionContext): void {
		invalidateDeferredExecute();
		const restored = findLatestPlanState(ctx.sessionManager.getBranch() as unknown as SessionEntryLike[]);
		requestMode(modeFromState(restored), "hydrate", ctx, restored);
	}

	pi.on("session_start", async (_event, ctx) => {
		reportDiagnostics(ctx);
		hydrateCurrentBranch(ctx);
		if (pi.getFlag("plan") === true) requestMode("plan", "startup", ctx);
	});

	pi.on("session_tree", async (_event, ctx) => hydrateCurrentBranch(ctx));
	pi.on("session_shutdown", async () => invalidateDeferredExecute());
}

export default function planExtension(pi: ExtensionAPI): void {
	registerPlanExtension(pi);
}

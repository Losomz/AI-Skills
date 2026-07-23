/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Supports three modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import * as os from "node:os";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import { type ExtensionAPI, type ExtensionContext, getAgentDir, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { type AgentConfig, type AgentScope, discoverAgents, findAgentByName } from "./agents.js";
import {
	runAgentProcess,
	type AgentProcessStatus,
} from "./agent-runner.js";
import { getModelAvailability, getThinkingLevelCompatibility } from "./model-catalog.js";
import {
	formatModelReference,
	getSubagentModelConfigPath,
	isEffectiveAgentConfig,
	loadSubagentModelConfig,
	modelReferenceFrom,
	parseCanonicalModelReference,
	resolveAgentModels,
	type EffectiveAgentConfig,
	type ModelReference,
} from "./model-overrides.js";
import { registerSubagentConfiguration } from "./model-picker.js";
import {
	buildShortcutInvocationPrompt,
	getHashShortcutCompletions,
	parseShortcutPlan,
	SUBAGENT_SHORTCUT_HINT_VALUE,
} from "./shortcuts.js";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const COLLAPSED_ITEM_COUNT = 10;
const PER_TASK_OUTPUT_CAP = 50 * 1024;
const READ_ONLY_TOOL_NAMES = new Set(["read", "grep", "find", "ls", "bash", "questionnaire"]);

function getAgentCapability(agent: AgentConfig): string {
	if (!agent.tools || agent.tools.length === 0) return "full-access/writable";
	if (agent.tools.every((tool) => READ_ONLY_TOOL_NAMES.has(tool.toLowerCase()))) return "read-only";
	return "limited-tools";
}

function formatAgentInventoryLine(agent: AgentConfig, includeModel = true): string {
	const tools = agent.tools && agent.tools.length > 0 ? agent.tools.join(",") : "default/full";
	const modelSource = isEffectiveAgentConfig(agent)
		? agent.modelSource === "override"
			? " (configured)"
			: agent.modelSource === "main-agent"
				? " (main Agent default)"
				: agent.modelSource === "profile"
					? " (profile)"
					: ""
		: "";
	const model = includeModel && agent.model ? `, model:${agent.model}${modelSource}` : "";
	const thinking = isEffectiveAgentConfig(agent)
		? agent.thinkingLevel
			? `, thinking:${agent.thinkingLevel}${agent.thinkingSource === "override" ? " (configured)" : agent.thinkingSource === "profile" ? " (profile)" : ""}`
			: ", thinking:default"
		: agent.thinkingLevel
			? `, thinking:${agent.thinkingLevel} (profile)`
			: ", thinking:default";
	return `- ${agent.name}: ${getAgentCapability(agent)}, tools:${tools}${model}${thinking}. ${agent.description}`;
}

function formatAgentInventory(agents: AgentConfig[], includeModel = true): string {
	if (agents.length === 0) return "Available subagents: none.";
	return [
		"Available subagents (names are case-insensitive; use the canonical names below):",
		...agents.map((agent) => formatAgentInventoryLine(agent, includeModel)),
	].join("\n");
}

function buildSubagentSystemHint(agents: AgentConfig[]): string {
	return `<system-reminder>\n# Subagent Inventory\n\n${formatAgentInventory(agents)}\n\nUse the subagent tool proactively when delegation would help. Explore and Scout are read-only research agents and may be used for investigation; General has write/full access and should be used for implementation or explicitly delegated writable work. You can call subagent with {"list": true} to refresh this inventory.\n</system-reminder>`;
}

function discoverEffectiveAgents(cwd: string, scope: AgentScope, mainModel?: ModelReference) {
	const discovery = discoverAgents(cwd, scope);
	const loaded = loadSubagentModelConfig(getSubagentModelConfigPath(getAgentDir()));
	return {
		...discovery,
		agents: resolveAgentModels(discovery.agents, loaded.config, mainModel),
		modelConfigError: loaded.error,
	};
}

function getRequestedAgentNames(params: {
	agent?: string;
	tasks?: Array<{ agent: string }>;
	chain?: Array<{ agent: string }>;
}): string[] {
	const names: string[] = [];
	if (params.agent) names.push(params.agent);
	if (params.tasks) names.push(...params.tasks.map((task) => task.agent));
	if (params.chain) names.push(...params.chain.map((step) => step.agent));
	return [...new Set(names.map((name) => name.trim().toLowerCase()))];
}

function findUnavailableAgentModels(
	ctx: ExtensionContext,
	agents: EffectiveAgentConfig[],
	requestedNames: string[],
): string[] {
	const issues: string[] = [];
	for (const requestedName of requestedNames) {
		const agent = findAgentByName(agents, requestedName);
		if (!agent || !isEffectiveAgentConfig(agent)) continue;
		let modelReference: ModelReference | undefined;
		if (agent.modelSource === "override" && agent.modelOverride) {
			modelReference = agent.modelOverride;
			const availability = getModelAvailability(ctx.modelRegistry, agent.modelOverride);
			if (availability !== "available") {
				issues.push(`${agent.name}: configured model ${formatModelReference(agent.modelOverride)} is ${availability.replace("-", " ")}`);
			}
		} else if (agent.modelSource === "main-agent" && agent.mainModel) {
			modelReference = agent.mainModel;
			const availability = getModelAvailability(ctx.modelRegistry, agent.mainModel);
			if (availability === "runtime-only") {
				issues.push(`${agent.name}: main Agent model ${formatModelReference(agent.mainModel)} uses parent-only runtime credentials`);
			}
		} else if (agent.model) {
			modelReference = parseCanonicalModelReference(agent.model);
		}
		if (
			agent.thinkingLevel
			&& modelReference
			&& getThinkingLevelCompatibility(ctx.modelRegistry, modelReference, agent.thinkingLevel) === "unsupported"
		) {
			issues.push(
				`${agent.name}: ${agent.thinkingSource} thinking level ${agent.thinkingLevel} is unsupported by ${formatModelReference(modelReference)}`,
			);
		}
	}
	return issues;
}

type RunStatus = AgentProcessStatus;

interface ActiveRun {
	runId: string;
	agent: string;
	task: string;
	model?: string;
	pid?: number;
	status: RunStatus;
	startedAt: number;
	updatedAt: number;
}

const activeRuns = new Map<string, ActiveRun>();

function createRunId(agentName: string): string {
	return `${agentName}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function statusIcon(status: RunStatus): string {
	switch (status) {
		case "pending":
			return "…";
		case "running":
			return "⏳";
		case "completed":
			return "✓";
		case "aborted":
			return "■";
		case "failed":
			return "✗";
	}
}

function updateSubagentWidget(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;

	const runs = Array.from(activeRuns.values()).filter((run) => run.status === "pending" || run.status === "running");
	if (runs.length === 0) {
		ctx.ui.setWidget("subagent-runs", undefined);
		ctx.ui.setStatus("subagent-runs", undefined);
		return;
	}

	const now = Date.now();
	const lines = [`Subagents running (${runs.length}):`];
	for (const run of runs.slice(0, 6)) {
		const taskPreview = run.task.length > 48 ? `${run.task.slice(0, 48)}...` : run.task;
		const pid = run.pid ? `pid=${run.pid}` : "pid=?";
		const model = run.model ? ` ${run.model}` : "";
		lines.push(`  ${statusIcon(run.status)} ${run.agent} ${pid} ${formatDuration(now - run.startedAt)}${model} — ${taskPreview}`);
	}
	if (runs.length > 6) lines.push(`  ... +${runs.length - 6} more`);

	ctx.ui.setWidget("subagent-runs", lines, { placement: "aboveEditor" });
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "find ") + themeFg("accent", pattern) + themeFg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

interface SingleResult {
	runId?: string;
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	pid?: number;
	status?: RunStatus;
	startedAt?: number;
	endedAt?: number;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
}

function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

function isFailedResult(result: SingleResult): boolean {
	return (
		result.exitCode !== 0 ||
		result.status === "failed" ||
		result.status === "aborted" ||
		result.stopReason === "error" ||
		result.stopReason === "aborted"
	);
}

function getResultOutput(result: SingleResult): string {
	if (isFailedResult(result)) {
		return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
	}
	return getFinalOutput(result.messages) || "(no output)";
}

function truncateParallelOutput(output: string): string {
	const byteLength = Buffer.byteLength(output, "utf8");
	if (byteLength <= PER_TASK_OUTPUT_CAP) return output;

	let truncated = output.slice(0, PER_TASK_OUTPUT_CAP);
	while (Buffer.byteLength(truncated, "utf8") > PER_TASK_OUTPUT_CAP) {
		truncated = truncated.slice(0, -1);
	}
	return `${truncated}\n\n[Output truncated: ${byteLength - Buffer.byteLength(truncated, "utf8")} bytes omitted. Full output preserved in tool details.]`;
}

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, any> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

function getRunDuration(result: SingleResult): string | undefined {
	if (!result.startedAt) return undefined;
	return formatDuration((result.endedAt ?? Date.now()) - result.startedAt);
}

function formatRunMeta(result: SingleResult): string {
	const parts: string[] = [];
	if (result.runId) parts.push(`id:${result.runId}`);
	if (result.status) parts.push(`status:${result.status}`);
	if (result.pid) parts.push(`pid:${result.pid}`);
	const duration = getRunDuration(result);
	if (duration) parts.push(`duration:${duration}`);
	if (result.model) parts.push(`model:${result.model}`);
	return parts.join("  ");
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

function emitRunProgressUpdate(
	ctx: ExtensionContext,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
	result: SingleResult,
): void {
	if (onUpdate) {
		onUpdate({
			content: [{ type: "text", text: getFinalOutput(result.messages) || "(running...)" }],
			details: makeDetails([result]),
		});
	}

	if (!ctx.hasUI) return;
	if (result.status === "pending" || result.status === "running") {
		activeRuns.set(result.runId ?? "", {
			runId: result.runId ?? createRunId(result.agent),
			agent: result.agent,
			task: result.task,
			model: result.model,
			pid: result.pid,
			status: result.status,
			startedAt: result.startedAt ?? Date.now(),
			updatedAt: Date.now(),
		});
	} else {
		activeRuns.delete(result.runId ?? result.agent);
	}
	updateSubagentWidget(ctx);
}

async function runSingleAgent(
	ctx: ExtensionContext,
	defaultCwd: string,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	step: number | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
): Promise<SingleResult> {
	const agent = findAgentByName(agents, agentName);
	const runId = createRunId(agent?.name ?? agentName);
	const startedAt = Date.now();

	if (!agent) {
		const available = formatAgentInventory(agents);
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: "${agentName}".\n${available}`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			step,
		};
	}

	const currentResult: SingleResult = {
		runId,
		agent: agent.name,
		agentSource: agent.source,
		task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		model: agent.model,
		status: "pending",
		startedAt,
		step,
	};

	emitRunProgressUpdate(ctx, onUpdate, makeDetails, currentResult);

	try {
		const runnerResult = await runAgentProcess({
			profile: agent,
			task,
			cwd: cwd ?? defaultCwd,
			signal,
			onUpdate: (partial) => {
				currentResult.agent = partial.agent;
				currentResult.pid = partial.pid;
				currentResult.model = partial.model ?? currentResult.model;
				currentResult.status = partial.status;
				currentResult.startedAt = partial.startedAt;
				currentResult.endedAt = partial.endedAt;
				currentResult.stopReason = partial.stopReason;
				currentResult.errorMessage = partial.errorMessage;
				currentResult.messages = partial.messages;
				currentResult.usage = partial.usage;
				currentResult.exitCode = partial.exitCode;
				currentResult.stderr = partial.stderr;
				emitRunProgressUpdate(ctx, onUpdate, makeDetails, { ...currentResult, step });
			},
		});
		currentResult.runId = runnerResult.runId;
		currentResult.pid = runnerResult.pid;
		currentResult.exitCode = runnerResult.exitCode;
		currentResult.messages = runnerResult.messages;
		currentResult.stderr = runnerResult.stderr;
		currentResult.usage = runnerResult.usage;
		currentResult.model = runnerResult.model;
		currentResult.status = runnerResult.status;
		currentResult.startedAt = runnerResult.startedAt;
		currentResult.endedAt = runnerResult.endedAt;
		currentResult.stopReason = runnerResult.stopReason;
		currentResult.errorMessage = runnerResult.errorMessage;
		return currentResult;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		currentResult.exitCode = 1;
		currentResult.status = "failed";
		currentResult.errorMessage = message;
		currentResult.stderr = message;
		currentResult.endedAt = Date.now();
		emitRunProgressUpdate(ctx, onUpdate, makeDetails, currentResult);
		return currentResult;
	} finally {
		if (ctx.hasUI) {
			activeRuns.delete(runId);
			updateSubagentWidget(ctx);
		}
	}
}

export { runAgentProcess } from "./agent-runner.js";
export type {
	AgentProcessResult,
	AgentProcessStatus,
	AgentProcessOptions,
	AgentProcessUpdate,
} from "./agent-runner.js";

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description: 'Which agent directories to use. Default: "project" for bundled extension agents. Use "both" to include user-level agents too.',
	default: "project",
});

const SubagentParams = Type.Object({
	list: Type.Optional(Type.Boolean({ description: "List/discover available subagents and their capabilities without running any task" })),
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode). Case-insensitive." })),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({ description: "Prompt before running extension-local agents. Default: false for bundled agents.", default: false }),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
});

export default function (pi: ExtensionAPI) {
	registerSubagentConfiguration(pi);

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;

		ctx.ui.addAutocompleteProvider((current) => ({
			async getSuggestions(lines, cursorLine, cursorCol, options) {
				const base = await current.getSuggestions(lines, cursorLine, cursorCol, options);
				const line = lines[cursorLine] ?? "";
				const beforeCursor = line.slice(0, cursorCol);
				const match = beforeCursor.match(/(?:^|\s)#([\p{L}\p{N}_-]*)$/u);
				if (!match) return base;

				const discovery = discoverAgents(ctx.cwd, "project");
				const shortcutItems = getHashShortcutCompletions(discovery.agents, match[1] ?? "");
				if (shortcutItems.length === 0) return base;

				return {
					prefix: `#${match[1] ?? ""}`,
					items: [...shortcutItems, ...(base?.items ?? [])],
				};
			},

			applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
				if (item.value === SUBAGENT_SHORTCUT_HINT_VALUE) {
					return { lines, cursorLine, cursorCol };
				}
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			},

			shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
				return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
			},
		}));
	});

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return { action: "continue" };

		const discovery = discoverAgents(ctx.cwd, "project");
		const plan = parseShortcutPlan(event.text.trim(), discovery.agents);
		if (!plan) return { action: "continue" };

		if (plan.tasks.some((task) => !task.task.trim())) {
			if (ctx.hasUI) ctx.ui.notify("Subagent shortcut task is empty", "info");
			return { action: "handled" };
		}

		return {
			action: "transform",
			text: buildShortcutInvocationPrompt(plan),
		};
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const discovery = discoverEffectiveAgents(ctx.cwd, "project", modelReferenceFrom(ctx.model));
		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildSubagentSystemHint(discovery.agents)}`,
		};
	});

	const initialInventory = formatAgentInventory(discoverEffectiveAgents(process.cwd(), "project").agents, false);

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context.",
			"Modes: list/discover ({list:true}), single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
			'Default agent scope is "project" (extension-local agents from this subagent extension\'s agents/ directory).',
			'Agent names are case-insensitive. Use agentScope: "both" to also include user-level agents from ~/.pi/agent/agents.',
			initialInventory,
		].join(" "),
		promptSnippet: `Delegate work to isolated subagents. ${initialInventory.replace(/\n/g, " ")}`,
		promptGuidelines: [
			"Use subagent when a task benefits from isolated context, parallel exploration, or a specialized agent listed in the subagent inventory.",
			"Use subagent with Explore for read-only codebase exploration and Scout for read-only external/upstream research when that can reduce main-context work.",
			"Use subagent with General for implementation or other writable/full-access delegated work; General may edit files.",
			"Use subagent with {list: true} when the available subagent inventory is unclear.",
		],
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const agentScope: AgentScope = params.agentScope ?? "project";
			const discovery = discoverEffectiveAgents(ctx.cwd, agentScope, modelReferenceFrom(ctx.model));
			const agents = discovery.agents;
			const confirmProjectAgents = params.confirmProjectAgents ?? false;

			const hasList = params.list === true;
			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);
			const modeCount = Number(hasList) + Number(hasChain) + Number(hasTasks) + Number(hasSingle);

			const makeDetails =
				(mode: "single" | "parallel" | "chain") =>
				(results: SingleResult[]): SubagentDetails => ({
					mode,
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
					results,
				});

			if (modeCount !== 1) {
				const available = formatAgentInventory(agents);
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters. Provide exactly one mode.\n${available}`,
						},
					],
					details: makeDetails("single")([]),
				};
			}

			if (hasList) {
				const configWarning = discovery.modelConfigError
					? `\n\nSubagent configuration warning: ${discovery.modelConfigError}`
					: "";
				return {
					content: [{ type: "text", text: `${formatAgentInventory(agents)}${configWarning}` }],
					details: makeDetails("single")([]),
				};
			}

			if (discovery.modelConfigError && ctx.hasUI) {
				ctx.ui.notify(`${discovery.modelConfigError} Falling back to agent profile, main Agent, or child Pi defaults.`, "warning");
			}

			const modelIssues = findUnavailableAgentModels(ctx, agents, getRequestedAgentNames(params));
			if (modelIssues.length > 0) {
				return {
					content: [
						{
							type: "text",
							text: `A subagent model or thinking setting cannot be used by the child process. Run /subagent to choose compatible settings or return to Default.\n${modelIssues.join("\n")}`,
						},
					],
					details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
					isError: true,
				};
			}

			if ((agentScope === "project" || agentScope === "both") && confirmProjectAgents && ctx.hasUI) {
				const requestedAgentNames = new Set<string>();
				if (params.chain) for (const step of params.chain) requestedAgentNames.add(step.agent);
				if (params.tasks) for (const t of params.tasks) requestedAgentNames.add(t.agent);
				if (params.agent) requestedAgentNames.add(params.agent);

				const projectAgentsRequested = Array.from(requestedAgentNames)
					.map((name) => findAgentByName(agents, name))
					.filter((a): a is AgentConfig => a?.source === "project");

				if (projectAgentsRequested.length > 0) {
					const names = projectAgentsRequested.map((a) => a.name).join(", ");
					const dir = discovery.projectAgentsDir ?? "(unknown)";
					const ok = await ctx.ui.confirm(
						"Run extension-local subagents?",
						`Agents: ${names}\nSource: ${dir}\n\nExtension-local agents are repo-controlled. Only continue for trusted repositories.`,
					);
					if (!ok)
						return {
							content: [{ type: "text", text: "Canceled: extension-local agents not approved." }],
							details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
						};
				}
			}

			if (params.chain && params.chain.length > 0) {
				const results: SingleResult[] = [];
				let previousOutput = "";

				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i];
					const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);

					// Create update callback that includes all previous results
					const chainUpdate: OnUpdateCallback | undefined = onUpdate
						? (partial) => {
								// Combine completed results with current streaming result
								const currentResult = partial.details?.results[0];
								if (currentResult) {
									const allResults = [...results, currentResult];
									onUpdate({
										content: partial.content,
										details: makeDetails("chain")(allResults),
									});
								}
							}
						: undefined;

					const result = await runSingleAgent(
						ctx,
						ctx.cwd,
						agents,
						step.agent,
						taskWithContext,
						step.cwd,
						i + 1,
						signal,
						chainUpdate,
						makeDetails("chain"),
					);
					results.push(result);

					const isError = isFailedResult(result);
					if (isError) {
						const errorMsg =
							result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
						return {
							content: [{ type: "text", text: `Chain stopped at step ${i + 1} (${step.agent}): ${errorMsg}` }],
							details: makeDetails("chain")(results),
							isError: true,
						};
					}
					previousOutput = getFinalOutput(result.messages);
				}
				return {
					content: [{ type: "text", text: getFinalOutput(results[results.length - 1].messages) || "(no output)" }],
					details: makeDetails("chain")(results),
				};
			}

			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > MAX_PARALLEL_TASKS)
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
							},
						],
						details: makeDetails("parallel")([]),
					};

				// Track all results for streaming updates
				const allResults: SingleResult[] = new Array(params.tasks.length);

				// Initialize placeholder results
				for (let i = 0; i < params.tasks.length; i++) {
					allResults[i] = {
						agent: params.tasks[i].agent,
						agentSource: "unknown",
						task: params.tasks[i].task,
						exitCode: -1, // -1 = still running
						messages: [],
						stderr: "",
						usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
					};
				}

				const emitParallelUpdate = () => {
					if (onUpdate) {
						const running = allResults.filter((r) => r.exitCode === -1).length;
						const done = allResults.filter((r) => r.exitCode !== -1).length;
						onUpdate({
							content: [
								{ type: "text", text: `Parallel: ${done}/${allResults.length} done, ${running} running...` },
							],
							details: makeDetails("parallel")([...allResults]),
						});
					}
				};

				const results = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (t, index) => {
					const result = await runSingleAgent(
						ctx,
						ctx.cwd,
						agents,
						t.agent,
						t.task,
						t.cwd,
						undefined,
						signal,
						// Per-task update callback
						(partial) => {
							if (partial.details?.results[0]) {
								allResults[index] = partial.details.results[0];
								emitParallelUpdate();
							}
						},
						makeDetails("parallel"),
					);
					allResults[index] = result;
					emitParallelUpdate();
					return result;
				});

				const successCount = results.filter((r) => !isFailedResult(r)).length;
				const summaries = results.map((r) => {
					const output = truncateParallelOutput(getResultOutput(r));
					const status = isFailedResult(r)
						? `failed${r.stopReason && r.stopReason !== "end" ? ` (${r.stopReason})` : ""}`
						: "completed";
					return `### [${r.agent}] ${status}\n\n${output}`;
				});
				return {
					content: [
						{
							type: "text",
							text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`,
						},
					],
					details: makeDetails("parallel")(results),
				};
			}

			if (params.agent && params.task) {
				const result = await runSingleAgent(
					ctx,
					ctx.cwd,
					agents,
					params.agent,
					params.task,
					params.cwd,
					undefined,
					signal,
					onUpdate,
					makeDetails("single"),
				);
				const isError = isFailedResult(result);
				if (isError) {
					const errorMsg =
						result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
					return {
						content: [{ type: "text", text: `Agent ${result.stopReason || "failed"}: ${errorMsg}` }],
						details: makeDetails("single")([result]),
						isError: true,
					};
				}
				return {
					content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
					details: makeDetails("single")([result]),
				};
			}

			return {
				content: [{ type: "text", text: `Invalid parameters.\n${formatAgentInventory(agents)}` }],
				details: makeDetails("single")([]),
			};
		},

		renderCall(args, theme, _context) {
			const scope: AgentScope = args.agentScope ?? "project";
			if (args.list === true) {
				return new Text(
					theme.fg("toolTitle", theme.bold("subagent ")) +
						theme.fg("accent", "list") +
						theme.fg("muted", ` [${scope}]`),
					0,
					0,
				);
			}
			if (args.chain && args.chain.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `chain (${args.chain.length} steps)`) +
					theme.fg("muted", ` [${scope}]`);
				for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
					const step = args.chain[i];
					// Clean up {previous} placeholder for display
					const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
					const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
					text +=
						"\n  " +
						theme.fg("muted", `${i + 1}.`) +
						" " +
						theme.fg("accent", step.agent) +
						theme.fg("dim", ` ${preview}`);
				}
				if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			if (args.tasks && args.tasks.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
					theme.fg("muted", ` [${scope}]`);
				for (const t of args.tasks.slice(0, 3)) {
					const preview = t.task.length > 40 ? `${t.task.slice(0, 40)}...` : t.task;
					text += `\n  ${theme.fg("accent", t.agent)}${theme.fg("dim", ` ${preview}`)}`;
				}
				if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			const agentName = args.agent || "...";
			const preview = args.task ? (args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task) : "...";
			let text =
				theme.fg("toolTitle", theme.bold("subagent ")) +
				theme.fg("accent", agentName) +
				theme.fg("muted", ` [${scope}]`);
			text += `\n  ${theme.fg("dim", preview)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as SubagentDetails | undefined;
			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}

			const mdTheme = getMarkdownTheme();

			const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
				const toShow = limit ? items.slice(-limit) : items;
				const skipped = limit && items.length > limit ? items.length - limit : 0;
				let text = "";
				if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
				for (const item of toShow) {
					if (item.type === "text") {
						const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
						text += `${theme.fg("toolOutput", preview)}\n`;
					} else {
						text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
					}
				}
				return text.trimEnd();
			};

			if (details.mode === "single" && details.results.length === 1) {
				const r = details.results[0];
				const isRunning = r.status === "pending" || r.status === "running" || r.exitCode === -1;
				const isError = !isRunning && (r.status === "failed" || r.status === "aborted" || r.exitCode !== 0 || r.stopReason === "error" || r.stopReason === "aborted");
				const icon = isRunning ? theme.fg("warning", statusIcon(r.status ?? "running")) : isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
				const displayItems = getDisplayItems(r.messages);
				const finalOutput = getFinalOutput(r.messages);

				if (expanded) {
					const container = new Container();
					let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
					if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
					container.addChild(new Text(header, 0, 0));
					const runMeta = formatRunMeta(r);
					if (runMeta) container.addChild(new Text(theme.fg("dim", runMeta), 0, 0));
					if (isError && r.errorMessage)
						container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
					container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
					if (displayItems.length === 0 && !finalOutput) {
						container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
					} else {
						for (const item of displayItems) {
							if (item.type === "toolCall")
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
						}
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}
					}
					const usageStr = formatUsageStats(r.usage, r.model);
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
					}
					return container;
				}

				let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
				const runMeta = formatRunMeta(r);
				if (runMeta) text += `\n${theme.fg("dim", runMeta)}`;
				if (isError && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
				if (isError && r.errorMessage) text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
				else if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
				else {
					text += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
					if (displayItems.length > COLLAPSED_ITEM_COUNT) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				}
				const usageStr = formatUsageStats(r.usage, r.model);
				if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
				return new Text(text, 0, 0);
			}

			const aggregateUsage = (results: SingleResult[]) => {
				const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
				for (const r of results) {
					total.input += r.usage.input;
					total.output += r.usage.output;
					total.cacheRead += r.usage.cacheRead;
					total.cacheWrite += r.usage.cacheWrite;
					total.cost += r.usage.cost;
					total.turns += r.usage.turns;
				}
				return total;
			};

			if (details.mode === "chain") {
				const successCount = details.results.filter((r) => r.exitCode === 0).length;
				const icon = successCount === details.results.length ? theme.fg("success", "✓") : theme.fg("error", "✗");

				if (expanded) {
					const container = new Container();
					container.addChild(
						new Text(
							icon +
								" " +
								theme.fg("toolTitle", theme.bold("chain ")) +
								theme.fg("accent", `${successCount}/${details.results.length} steps`),
							0,
							0,
						),
					);

					for (const r of details.results) {
						const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(
								`${theme.fg("muted", `─── Step ${r.step}: `) + theme.fg("accent", r.agent)} ${rIcon}`,
								0,
								0,
							),
						);
						container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const stepUsage = formatUsageStats(r.usage, r.model);
						if (stepUsage) container.addChild(new Text(theme.fg("dim", stepUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
					}
					return container;
				}

				// Collapsed view
				let text =
					icon +
					" " +
					theme.fg("toolTitle", theme.bold("chain ")) +
					theme.fg("accent", `${successCount}/${details.results.length} steps`);
				for (const r of details.results) {
					const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
					const displayItems = getDisplayItems(r.messages);
					text += `\n\n${theme.fg("muted", `─── Step ${r.step}: `)}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				const usageStr = formatUsageStats(aggregateUsage(details.results));
				if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			if (details.mode === "parallel") {
				const running = details.results.filter((r) => r.exitCode === -1).length;
				const successCount = details.results.filter((r) => r.exitCode !== -1 && !isFailedResult(r)).length;
				const failCount = details.results.filter((r) => r.exitCode !== -1 && isFailedResult(r)).length;
				const isRunning = running > 0;
				const icon = isRunning
					? theme.fg("warning", "⏳")
					: failCount > 0
						? theme.fg("warning", "◐")
						: theme.fg("success", "✓");
				const status = isRunning
					? `${successCount + failCount}/${details.results.length} done, ${running} running`
					: `${successCount}/${details.results.length} tasks`;

				if (expanded && !isRunning) {
					const container = new Container();
					container.addChild(
						new Text(
							`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
							0,
							0,
						),
					);

					for (const r of details.results) {
						const rIcon = isFailedResult(r) ? theme.fg("error", "✗") : theme.fg("success", "✓");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(`${theme.fg("muted", "─── ") + theme.fg("accent", r.agent)} ${rIcon}`, 0, 0),
						);
						container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const taskUsage = formatUsageStats(r.usage, r.model);
						if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
					}
					return container;
				}

				// Collapsed view (or still running)
				let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
				for (const r of details.results) {
					const rIcon =
						r.exitCode === -1
							? theme.fg("warning", "⏳")
							: isFailedResult(r)
								? theme.fg("error", "✗")
								: theme.fg("success", "✓");
					const displayItems = getDisplayItems(r.messages);
					text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0)
						text += `\n${theme.fg("muted", r.exitCode === -1 ? "(running...)" : "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				if (!isRunning) {
					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				}
				if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
		},
	});
}

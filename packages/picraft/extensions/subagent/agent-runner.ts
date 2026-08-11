import type { Message } from "@earendil-works/pi-ai";
import type { AgentConfig } from "./agents.js";
import type { AgentThinkingLevel } from "./thinking.js";
import {
	buildPiProcessArgs,
	resolvePiInvocation,
	runPiProcess,
	type PiProcessInvocation,
	type PiProcessResult,
	type PiProcessStatus,
	type PiProcessUpdate,
	type PiProcessUsage,
	type PiRuntimeInfo,
} from "../shared/pi-process-runner.ts";

export type AgentProcessStatus = PiProcessStatus;
export type AgentProcessUsage = PiProcessUsage;
export type { PiProcessInvocation, PiRuntimeInfo };
export { resolvePiInvocation };

export interface AgentProcessUpdate {
	runId: string;
	agent: string;
	status: AgentProcessStatus;
	pid?: number;
	model?: string;
	startedAt: number;
	endedAt?: number;
	messages: Message[];
	usage: AgentProcessUsage;
	exitCode: number;
	output: string;
	stderr: string;
	failed: boolean;
	stopReason?: string;
	errorMessage?: string;
}

export interface AgentProcessResult extends AgentProcessUpdate {
	exitCode: number;
	output: string;
	stderr: string;
	failed: boolean;
}

export interface AgentProcessOptions {
	profile: AgentConfig;
	task: string;
	cwd: string;
	parentSessionId?: string;
	signal?: AbortSignal;
	onUpdate?: (update: AgentProcessUpdate) => void;
}

export interface AgentProcessConfig {
	model?: string;
	thinkingLevel?: AgentThinkingLevel;
	tools?: string[];
}

export function buildAgentProcessArgs(
	profile: AgentProcessConfig,
	task: string,
	systemPromptPath?: string,
): string[] {
	return buildPiProcessArgs(profile, task, systemPromptPath);
}

function escapeXmlAttribute(value: string): string {
	return value
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function buildSubagentSystemPrompt(profile: AgentConfig): string {
	const agentName = escapeXmlAttribute(profile.name.trim() || "Subagent");
	return `<active_agent name="${agentName}"></active_agent>\n\n${profile.systemPrompt}`;
}

function buildSubagentEnvironment(profile: AgentConfig, parentSessionId: string | undefined): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		PI_IS_SUBAGENT: "1",
		PI_SUBAGENT_NAME: profile.name,
	};
	if (parentSessionId?.trim()) env.PI_SUBAGENT_PARENT_SESSION = parentSessionId.trim();
	else delete env.PI_SUBAGENT_PARENT_SESSION;
	return env;
}

export function getSubagentNameFromEnvironment(env: NodeJS.ProcessEnv = process.env): string | undefined {
	if (!env.PI_IS_SUBAGENT?.trim()) return undefined;
	return env.PI_SUBAGENT_NAME?.trim() || undefined;
}

function toAgentUpdate(update: PiProcessUpdate): AgentProcessUpdate {
	return {
		runId: update.runId,
		agent: update.name,
		status: update.status,
		pid: update.pid,
		model: update.model,
		startedAt: update.startedAt,
		endedAt: update.endedAt,
		messages: update.messages,
		usage: update.usage,
		exitCode: update.exitCode,
		output: update.output,
		stderr: update.stderr,
		failed: update.failed,
		stopReason: update.stopReason,
		errorMessage: update.errorMessage,
	};
}

function toAgentResult(result: PiProcessResult): AgentProcessResult {
	return toAgentUpdate(result);
}

export async function runAgentProcess(options: AgentProcessOptions): Promise<AgentProcessResult> {
	const result = await runPiProcess({
		config: {
			name: options.profile.name,
			model: options.profile.model,
			thinkingLevel: options.profile.thinkingLevel,
			tools: options.profile.tools,
			systemPrompt: buildSubagentSystemPrompt(options.profile),
		},
		task: options.task,
		cwd: options.cwd,
		env: buildSubagentEnvironment(options.profile, options.parentSessionId),
		signal: options.signal,
		onUpdate: options.onUpdate ? (update) => options.onUpdate?.(toAgentUpdate(update)) : undefined,
	});
	return toAgentResult(result);
}

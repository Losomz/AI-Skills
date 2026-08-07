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
			systemPrompt: options.profile.systemPrompt,
		},
		task: options.task,
		cwd: options.cwd,
		signal: options.signal,
		onUpdate: options.onUpdate ? (update) => options.onUpdate?.(toAgentUpdate(update)) : undefined,
	});
	return toAgentResult(result);
}

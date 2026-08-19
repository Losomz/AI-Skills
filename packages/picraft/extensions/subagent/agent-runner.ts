import * as path from "node:path";
import { fileURLToPath } from "node:url";
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
export const SCOUT_REPOSITORY_CAPABILITY_ENV = "PI_SUBAGENT_SCOUT_REPOSITORY";
const BUNDLED_SCOUT_PROFILE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "agents", "scout.md");

function comparableProfilePath(value: string): string {
	const resolved = path.resolve(value);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function getBundledScoutProfilePath(): string {
	return BUNDLED_SCOUT_PROFILE_PATH;
}

export function isTrustedBundledScoutProfile(profile: Pick<AgentConfig, "name" | "source" | "filePath">): boolean {
	return (
		profile.source === "project" &&
		profile.name.trim().toLowerCase() === "scout" &&
		comparableProfilePath(profile.filePath) === comparableProfilePath(BUNDLED_SCOUT_PROFILE_PATH)
	);
}

export function isScoutRepositoryCapabilityEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return (
		env.PI_IS_SUBAGENT === "1" &&
		env[SCOUT_REPOSITORY_CAPABILITY_ENV] === "1" &&
		getSubagentNameFromEnvironment(env)?.toLowerCase() === "scout"
	);
}

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
	delete env[SCOUT_REPOSITORY_CAPABILITY_ENV];
	if (isTrustedBundledScoutProfile(profile)) {
		env[SCOUT_REPOSITORY_CAPABILITY_ENV] = "1";
		env.GIT_TERMINAL_PROMPT = "0";
		env.GCM_INTERACTIVE = "Never";
		env.GIT_LFS_SKIP_SMUDGE = "1";
	}
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

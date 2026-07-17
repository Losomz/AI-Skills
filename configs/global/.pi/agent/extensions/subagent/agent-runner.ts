import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import type { AgentConfig } from "./agents.js";

export type AgentProcessStatus = "pending" | "running" | "completed" | "failed" | "aborted";

export interface AgentProcessUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
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
	signal?: AbortSignal;
	onUpdate?: (update: AgentProcessUpdate) => void;
}

export interface PiRuntimeInfo {
	execPath: string;
	argv1?: string;
}

export interface PiProcessInvocation {
	command: string;
	args: string[];
	shell: false;
}

export interface AgentProcessConfig {
	model?: string;
	tools?: string[];
}

export function buildAgentProcessArgs(
	profile: AgentProcessConfig,
	task: string,
	systemPromptPath?: string,
): string[] {
	const args = ["--mode", "json", "-p", "--no-session"];
	if (profile.model) args.push("--model", profile.model);
	if (profile.tools?.length) args.push("--tools", profile.tools.join(","));
	if (systemPromptPath) args.push("--append-system-prompt", systemPromptPath);
	args.push(`Task: ${task}`);
	return args;
}

function createUsage(): AgentProcessUsage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

function createRunId(agentName: string): string {
	return `${agentName}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function getFinalOutput(messages: Message[]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== "assistant") continue;
		for (const part of message.content) {
			if (part.type === "text") return part.text;
		}
	}
	return "";
}

function addUsage(target: AgentProcessUsage, message: Message): void {
	if (message.role !== "assistant" || !message.usage) return;
	const usage = message.usage;
	target.input += usage.input || 0;
	target.output += usage.output || 0;
	target.cacheRead += usage.cacheRead || 0;
	target.cacheWrite += usage.cacheWrite || 0;
	target.cost += usage.cost?.total || 0;
	target.contextTokens = usage.totalTokens || target.contextTokens;
}

function cloneUpdate(result: AgentProcessResult): AgentProcessUpdate {
	return {
		runId: result.runId,
		agent: result.agent,
		status: result.status,
		pid: result.pid,
		model: result.model,
		startedAt: result.startedAt,
		endedAt: result.endedAt,
		messages: [...result.messages],
		usage: { ...result.usage },
		exitCode: result.exitCode,
		output: result.output,
		stderr: result.stderr,
		failed: result.failed,
		stopReason: result.stopReason,
		errorMessage: result.errorMessage,
	};
}

export function resolvePiInvocation(
	args: string[],
	runtime: PiRuntimeInfo = { execPath: process.execPath, argv1: process.argv[1] },
): PiProcessInvocation {
	const executableName = path.basename(runtime.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(executableName);
	if (!isGenericRuntime) return { command: runtime.execPath, args: [...args], shell: false };

	if (!runtime.argv1 || runtime.argv1.startsWith("/$bunfs/root/")) {
		throw new Error(`Unable to resolve the Pi CLI entry from ${runtime.execPath}`);
	}
	const cliEntry = path.isAbsolute(runtime.argv1) ? runtime.argv1 : path.resolve(runtime.argv1);
	return { command: runtime.execPath, args: [cliEntry, ...args], shell: false };
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-agent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(dir, `prompt-${safeName}.md`);
	try {
		await fs.promises.writeFile(filePath, prompt, { encoding: "utf8", mode: 0o600 });
		return { dir, filePath };
	} catch (error) {
		fs.rmSync(dir, { force: true, recursive: true });
		throw error;
	}
}

function removeTempPrompt(filePath: string | undefined, dir: string | undefined): void {
	if (filePath) {
		try {
			fs.rmSync(filePath, { force: true });
		} catch {
			/* best effort */
		}
	}
	if (dir) {
		try {
			fs.rmSync(dir, { force: true, recursive: true });
		} catch {
			/* best effort */
		}
	}
}

function normalizeFailure(result: AgentProcessResult, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	result.status = "failed";
	result.failed = true;
	result.exitCode = 1;
	result.errorMessage = message.startsWith("Failed to") ? message : `Failed to run Pi subprocess: ${message}`;
	result.stderr = result.stderr ? `${result.stderr}\n${result.errorMessage}` : result.errorMessage;
	result.output = result.errorMessage;
	result.endedAt = Date.now();
}

export async function runAgentProcess(options: AgentProcessOptions): Promise<AgentProcessResult> {
	const result: AgentProcessResult = {
		runId: createRunId(options.profile.name),
		agent: options.profile.name,
		status: "pending",
		model: options.profile.model,
		startedAt: Date.now(),
		messages: [],
		usage: createUsage(),
		exitCode: 0,
		output: "",
		stderr: "",
		failed: false,
	};
	const emitUpdate = (): void => {
		try {
			options.onUpdate?.(cloneUpdate(result));
		} catch {
			// Observers must not control the subprocess lifecycle.
		}
	};

	let promptDir: string | undefined;
	let promptPath: string | undefined;
	emitUpdate();

	try {
		if (options.profile.systemPrompt.trim()) {
			const prompt = await writePromptToTempFile(options.profile.name, options.profile.systemPrompt);
			promptDir = prompt.dir;
			promptPath = prompt.filePath;
		}

		const args = buildAgentProcessArgs(options.profile, options.task, promptPath);
		const invocation = resolvePiInvocation(args);
		const processResult = await new Promise<AgentProcessResult>((resolve) => {
			const proc = spawn(invocation.command, invocation.args, {
				cwd: options.cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let buffer = "";
			let settled = false;
			let abortRequested = false;
			let killTimer: NodeJS.Timeout | undefined;

			const clearKillTimer = (): void => {
				if (!killTimer) return;
				clearTimeout(killTimer);
				killTimer = undefined;
			};
			const detach = (): void => {
				clearKillTimer();
				options.signal?.removeEventListener("abort", abortProcess);
				proc.stdout.off("data", onStdout);
				proc.stderr.off("data", onStderr);
				proc.off("error", onError);
				proc.off("close", onClose);
			};
			const parseLine = (line: string): void => {
				const normalizedLine = line.trim();
				if (!normalizedLine) return;
				let event: { type?: string; message?: Message };
				try {
					event = JSON.parse(normalizedLine);
				} catch {
					return;
				}
				if (!event.message || (event.type !== "message_end" && event.type !== "tool_result_end")) return;
				result.messages.push(event.message);
				if (event.message.role === "assistant") {
					result.usage.turns++;
					addUsage(result.usage, event.message);
					if (!result.model && event.message.model) result.model = event.message.model;
					if (event.message.stopReason) result.stopReason = event.message.stopReason;
					if (event.message.errorMessage) result.errorMessage = event.message.errorMessage;
				}
				emitUpdate();
			};
			const onStdout = (chunk: Buffer): void => {
				buffer += chunk.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) parseLine(line);
			};
			const onStderr = (chunk: Buffer): void => {
				result.stderr += chunk.toString();
			};
			const finish = (status: AgentProcessStatus, exitCode: number): void => {
				if (settled) return;
				settled = true;
				if (buffer.trim()) parseLine(buffer);
				result.status = status;
				result.exitCode = exitCode;
				result.failed = status !== "completed";
				result.endedAt = Date.now();
				if (status === "aborted") result.stopReason = "aborted";
				const finalOutput = getFinalOutput(result.messages);
				result.output = status === "completed"
					? finalOutput
					: result.errorMessage || result.stderr.trim() || finalOutput || "Agent process failed";
				detach();
				emitUpdate();
				resolve(result);
			};
			const onError = (error: Error): void => {
				result.errorMessage = `Failed to start Pi subprocess: ${error.message}`;
				result.stderr = result.stderr ? `${result.stderr}\n${result.errorMessage}` : result.errorMessage;
				finish("failed", 1);
			};
			const onClose = (code: number | null): void => {
				if (abortRequested) {
					finish("aborted", code ?? 1);
					return;
				}
				const exitCode = code ?? 1;
				const failedByMessage = result.stopReason === "error" || Boolean(result.errorMessage);
				finish(exitCode === 0 && !failedByMessage ? "completed" : "failed", exitCode);
			};
			function abortProcess(): void {
				if (settled || abortRequested) return;
				abortRequested = true;
				killTimer = setTimeout(() => {
					if (!settled) {
						try {
							proc.kill("SIGKILL");
						} catch {
							/* process already exited */
						}
					}
				}, 5000);
				killTimer.unref?.();
				try {
					proc.kill("SIGTERM");
				} catch {
					/* close/error will settle the run */
				}
			}

			proc.stdout.on("data", onStdout);
			proc.stderr.on("data", onStderr);
			proc.once("error", onError);
			proc.once("close", onClose);
			if (options.signal?.aborted) abortProcess();
			else options.signal?.addEventListener("abort", abortProcess, { once: true });

			result.pid = proc.pid;
			result.status = "running";
			emitUpdate();
		});
		return processResult;
	} catch (error) {
		if (result.status !== "failed" && result.status !== "aborted") {
			normalizeFailure(result, error);
			emitUpdate();
		}
		return result;
	} finally {
		removeTempPrompt(promptPath, promptDir);
	}
}

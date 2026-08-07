import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@earendil-works/pi-ai";

export type PiProcessStatus = "pending" | "running" | "completed" | "failed" | "aborted";

export interface PiProcessUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export interface PiProcessUpdate {
	runId: string;
	name: string;
	status: PiProcessStatus;
	pid?: number;
	model?: string;
	startedAt: number;
	endedAt?: number;
	messages: Message[];
	usage: PiProcessUsage;
	exitCode: number;
	output: string;
	stderr: string;
	failed: boolean;
	stopReason?: string;
	errorMessage?: string;
}

export interface PiProcessResult extends PiProcessUpdate {
	exitCode: number;
	output: string;
	stderr: string;
	failed: boolean;
}

export interface PiProcessConfig {
	name: string;
	model?: string;
	thinkingLevel?: string;
	tools?: string[];
	systemPrompt: string;
}

export interface PiProcessOptions {
	config: PiProcessConfig;
	task: string;
	cwd: string;
	env?: NodeJS.ProcessEnv;
	signal?: AbortSignal;
	onUpdate?: (update: PiProcessUpdate) => void;
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

export function buildPiProcessArgs(
	config: Pick<PiProcessConfig, "model" | "thinkingLevel" | "tools">,
	task: string,
	systemPromptPath?: string,
): string[] {
	const args = ["--mode", "json", "-p", "--no-session"];
	if (config.model) args.push("--model", config.model);
	if (config.thinkingLevel !== undefined) args.push("--thinking", config.thinkingLevel);
	if (config.tools?.length) args.push("--tools", config.tools.join(","));
	if (systemPromptPath) args.push("--append-system-prompt", systemPromptPath);
	args.push(`Task: ${task}`);
	return args;
}

function createUsage(): PiProcessUsage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

function createRunId(name: string): string {
	return `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
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

function addUsage(target: PiProcessUsage, message: Message): void {
	if (message.role !== "assistant" || !message.usage) return;
	const usage = message.usage;
	target.input += usage.input || 0;
	target.output += usage.output || 0;
	target.cacheRead += usage.cacheRead || 0;
	target.cacheWrite += usage.cacheWrite || 0;
	target.cost += usage.cost?.total || 0;
	target.contextTokens = usage.totalTokens || target.contextTokens;
}

function cloneUpdate(result: PiProcessResult): PiProcessUpdate {
	return {
		runId: result.runId,
		name: result.name,
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

async function writePromptToTempFile(name: string, prompt: string): Promise<{ dir: string; filePath: string }> {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-process-"));
	const safeName = name.replace(/[^\w.-]+/g, "_");
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

function normalizeFailure(result: PiProcessResult, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	result.status = "failed";
	result.failed = true;
	result.exitCode = 1;
	result.errorMessage = message.startsWith("Failed to") ? message : `Failed to run Pi subprocess: ${message}`;
	result.stderr = result.stderr ? `${result.stderr}\n${result.errorMessage}` : result.errorMessage;
	result.output = result.errorMessage;
	result.endedAt = Date.now();
}

export async function runPiProcess(options: PiProcessOptions): Promise<PiProcessResult> {
	const result: PiProcessResult = {
		runId: createRunId(options.config.name),
		name: options.config.name,
		status: "pending",
		model: options.config.model,
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
		if (options.config.systemPrompt.trim()) {
			const prompt = await writePromptToTempFile(options.config.name, options.config.systemPrompt);
			promptDir = prompt.dir;
			promptPath = prompt.filePath;
		}

		const args = buildPiProcessArgs(options.config, options.task, promptPath);
		const invocation = resolvePiInvocation(args);
		const processResult = await new Promise<PiProcessResult>((resolve) => {
			const proc = spawn(invocation.command, invocation.args, {
				cwd: options.cwd,
				env: options.env,
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
			const finish = (status: PiProcessStatus, exitCode: number): void => {
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
					: result.errorMessage || result.stderr.trim() || finalOutput || "Pi process failed";
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

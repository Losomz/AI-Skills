import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { connectMcpServer, type McpCallResult, type McpConnection, type McpToolInfo } from "./client.ts";
import { loadGlobalMcpConfig, loadProjectMcpConfig, mcpConfigDescription } from "./config.ts";
import { configureMcpServer, selectMcpServer } from "./ui.ts";
import {
	getSelectedTools,
	mcpToolName,
	persistMcpState,
	restoreMcpState,
	selectedToolNames,
	setServerEnabled,
	setToolEnabled,
	type McpPersistedState,
	type McpServerRuntime,
} from "./state.ts";

interface RegisteredMcpTool {
	tool: McpToolInfo;
	name: string;
}

interface PendingConnection {
	promise: Promise<boolean>;
	controller: AbortController;
	runtime: McpServerRuntime;
	generation: number;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function toPiContent(result: McpCallResult): Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> {
	return result.content;
}

function closeWithTimeout(connection: McpConnection, timeoutMs = 2_000): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, timeoutMs);
		void connection.close().catch(() => undefined).finally(() => {
			clearTimeout(timer);
			resolve();
		});
	});
}

function waitForPromises(promises: readonly Promise<unknown>[], timeoutMs: number): Promise<void> {
	if (promises.length === 0) return Promise.resolve();
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, timeoutMs);
		Promise.all(promises).then(() => {
			clearTimeout(timer);
			resolve();
		}, () => {
			clearTimeout(timer);
			resolve();
		});
	});
}

function registerMcpTool(
	pi: ExtensionAPI,
	serverName: string,
	tool: McpToolInfo,
	getRuntime: () => McpServerRuntime | undefined,
): RegisteredMcpTool {
	const name = mcpToolName(serverName, tool.name);
	pi.registerTool({
		name,
		label: `${serverName}/${tool.name}`,
		description: `[MCP ${serverName}] ${tool.description}`,
		parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema as TSchema),
		async execute(_toolCallId, params, signal, onUpdate) {
			const runtime = getRuntime();
			const currentTool = runtime?.tools.find((item) => item.name === tool.name);
			if (!runtime || !runtime.connection || !currentTool) {
				throw new Error(`MCP server "${serverName}" tool "${tool.name}" is not connected`);
			}
			const result = await runtime.connection.callTool(tool.name, params as Record<string, unknown>, signal, (message) => {
				onUpdate?.({ content: [{ type: "text", text: message }], details: { server: serverName, tool: tool.name } });
			});
			if (result.isError) {
				const text = result.content
					.filter((item): item is { type: "text"; text: string } => item.type === "text")
					.map((item) => item.text)
					.join("\n");
				throw new Error(text || `MCP tool ${serverName}/${tool.name} returned an error`);
			}
			return {
				content: toPiContent(result),
				details: { server: serverName, tool: tool.name, structuredContent: result.structuredContent },
			};
		},
	});
	return { tool, name };
}

export default function mcpExtension(pi: ExtensionAPI): void {
	let state: McpPersistedState = { version: 1, enabledServers: [], enabledTools: {} };
	let runtimes = new Map<string, McpServerRuntime>();
	let registered = new Map<string, RegisteredMcpTool>();
	const pendingConnections = new Map<string, PendingConnection>();
	let configGeneration = 0;
	let configErrors: string[] = [];
	let shuttingDown = false;
	let currentCwd = process.cwd();

	const applyActiveTools = (): void => {
		const mcpNames = new Set(registered.keys());
		const active = pi.getActiveTools().filter((name) => !mcpNames.has(name));
		const activeMcpNames = new Set(selectedToolNames(runtimes.values(), state));
		pi.setActiveTools([...active, ...activeMcpNames]);
	};

	const loadConfig = (cwd: string, projectTrusted: boolean): void => {
		configGeneration++;
		for (const pending of pendingConnections.values()) pending.controller.abort();
		void Promise.all([...runtimes.values()].map((runtime) => disconnect(runtime)));
		currentCwd = cwd;
		const global = loadGlobalMcpConfig(getAgentDir());
		const project = projectTrusted ? loadProjectMcpConfig(cwd) : undefined;
		const configs = { ...global.config.mcpServers, ...(project?.config.mcpServers ?? {}) };
		runtimes = new Map(Object.entries(configs).map(([name, config]) => [name, {
			name,
			config,
			tools: [],
		}]));
		state.enabledServers = state.enabledServers.filter((name) => runtimes.has(name));
		state.enabledTools = Object.fromEntries(Object.entries(state.enabledTools).filter(([name]) => runtimes.has(name)));
		const errors = [global.error, project?.error].filter((error): error is string => Boolean(error));
		configErrors = errors;
	};

	const disconnect = async (runtime: McpServerRuntime): Promise<void> => {
		const pending = pendingConnections.get(runtime.name);
		if (pending?.runtime === runtime) pending.controller.abort();
		if (!runtime.connection) return;
		await closeWithTimeout(runtime.connection);
		runtime.connection = undefined;
	};

	const ensureConnected = async (runtime: McpServerRuntime, allowDisabled = false): Promise<boolean> => {
		if (runtime.connection) return true;
		const generation = configGeneration;
		const pending = pendingConnections.get(runtime.name);
		if (pending) {
			if (pending.runtime === runtime && pending.generation === generation) return pending.promise;
			pending.controller.abort();
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15_000);
		let pendingRecord: PendingConnection;
		const promise = (async (): Promise<boolean> => {
			try {
				runtime.error = undefined;
				const connection = await connectMcpServer(runtime.config, currentCwd, controller.signal);
				const current = runtimes.get(runtime.name);
				if (
					shuttingDown ||
					controller.signal.aborted ||
					generation !== configGeneration ||
					current !== runtime ||
					(!allowDisabled && !state.enabledServers.includes(runtime.name))
				) {
					await closeWithTimeout(connection);
					return false;
				}
				runtime.connection = connection;
				runtime.tools = connection.tools;
				for (const tool of runtime.tools) {
					const name = mcpToolName(runtime.name, tool.name);
					registered.set(name, registerMcpTool(pi, runtime.name, tool, () => runtimes.get(runtime.name)));
				}
				applyActiveTools();
				return true;
			} catch (error) {
				if (runtimes.get(runtime.name) === runtime && !controller.signal.aborted) {
					runtime.error = `Connection failed: ${errorText(error)}`;
				}
				return false;
			} finally {
				clearTimeout(timeout);
				if (pendingConnections.get(runtime.name) === pendingRecord) pendingConnections.delete(runtime.name);
			}
		})();
		pendingRecord = { promise, controller, runtime, generation };
		pendingConnections.set(runtime.name, pendingRecord);
		return promise;
	};

	pi.registerCommand("mcp", {
		description: "Enable MCP servers and tools",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/mcp requires an interactive UI", "error");
				return;
			}
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/mcp requires TUI mode", "error");
				return;
			}
			if (runtimes.size === 0) {
				ctx.ui.notify(
					configErrors.length > 0
						? configErrors.join("\n")
						: `No MCP servers configured.\n${mcpConfigDescription(ctx.cwd)}`,
					configErrors.length > 0 ? "error" : "info",
				);
				return;
			}
			const serverName = await selectMcpServer(ctx, [...runtimes.values()], new Set(state.enabledServers));
			if (!serverName) return;
			const runtime = runtimes.get(serverName);
			if (!runtime) return;
			if (!(await ensureConnected(runtime, true))) {
				ctx.ui.notify(runtime.error ?? `Unable to connect to ${runtime.name}`, "error");
				return;
			}
			const selectedTools = getSelectedTools(runtime, state);
			await configureMcpServer(
				ctx,
				runtime,
				state.enabledServers.includes(serverName),
				selectedTools,
				async (enabled) => {
					if (enabled) {
						if (!(await ensureConnected(runtime, true))) return false;
						setServerEnabled(state, serverName, true);
					} else {
						setServerEnabled(state, serverName, false);
						await disconnect(runtime);
					}
					persistMcpState(pi, state);
					applyActiveTools();
					return true;
				},
				(toolName, enabled) => {
					setToolEnabled(state, serverName, toolName, enabled, runtime.tools);
					persistMcpState(pi, state);
					applyActiveTools();
				},
			);
			if (!state.enabledServers.includes(serverName)) await disconnect(runtime);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		shuttingDown = false;
		state = restoreMcpState(ctx);
		loadConfig(ctx.cwd, ctx.isProjectTrusted());
		applyActiveTools();
		for (const name of state.enabledServers) {
			const runtime = runtimes.get(name);
			if (runtime) {
				void ensureConnected(runtime).then((connected) => {
					if (!connected) {
						setServerEnabled(state, name, false);
						applyActiveTools();
					}
				});
			}
		}
	});

	pi.on("session_tree", async (_event, ctx) => {
		state = restoreMcpState(ctx);
		for (const runtime of runtimes.values()) {
			if (state.enabledServers.includes(runtime.name)) await ensureConnected(runtime);
			else await disconnect(runtime);
		}
		applyActiveTools();
	});

	pi.on("session_shutdown", async () => {
		shuttingDown = true;
		for (const pending of pendingConnections.values()) pending.controller.abort();
		await waitForPromises([...pendingConnections.values()].map((pending) => pending.promise), 2_000);
		await Promise.all([...runtimes.values()].map((runtime) => disconnect(runtime)));
		runtimes.clear();
		registered.clear();
	});
}

import { createHash } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { McpConnection, McpToolInfo } from "./client.ts";
import type { McpServerConfig } from "./config.ts";

export const MCP_STATE_ENTRY = "picraft-mcp-state";

export interface McpPersistedState {
	version: 1;
	enabledServers: string[];
	enabledTools: Record<string, string[]>;
}

export interface McpServerRuntime {
	name: string;
	config: McpServerConfig;
	connection?: McpConnection;
	tools: McpToolInfo[];
	error?: string;
}

export function emptyMcpState(): McpPersistedState {
	return { version: 1, enabledServers: [], enabledTools: {} };
}

export function restoreMcpState(ctx: ExtensionContext): McpPersistedState {
	let latest: McpPersistedState | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== MCP_STATE_ENTRY) continue;
		const data = entry.data as Partial<McpPersistedState> | undefined;
		if (
			!data ||
			data.version !== 1 ||
			!Array.isArray(data.enabledServers) ||
			typeof data.enabledTools !== "object" ||
			data.enabledTools === null ||
			Array.isArray(data.enabledTools)
		) continue;
		latest = {
			version: 1,
			enabledServers: data.enabledServers.filter((name): name is string => typeof name === "string"),
			enabledTools: Object.fromEntries(
			Object.entries(data.enabledTools as Record<string, unknown>).map(([server, tools]) => [
				server,
				Array.isArray(tools) ? tools.filter((tool): tool is string => typeof tool === "string") : [],
			]),
			),
		};
	}
	return latest ?? emptyMcpState();
}

export function persistMcpState(pi: { appendEntry<T>(customType: string, data?: T): void }, state: McpPersistedState): void {
	pi.appendEntry(MCP_STATE_ENTRY, {
		version: 1,
		enabledServers: [...state.enabledServers].sort(),
		enabledTools: Object.fromEntries(
			Object.entries(state.enabledTools)
				.map(([server, tools]) => [server, [...tools].sort()])
				.sort(([left], [right]) => left.localeCompare(right)),
		),
	});
}

export function selectedToolNames(runtimes: Iterable<McpServerRuntime>, state: McpPersistedState): string[] {
	const names: string[] = [];
	for (const runtime of runtimes) {
		if (!state.enabledServers.includes(runtime.name)) continue;
		const selected = state.enabledTools[runtime.name];
		for (const tool of runtime.tools) {
			if (!selected || selected.includes(tool.name)) names.push(mcpToolName(runtime.name, tool.name));
		}
	}
	return names;
}

export function mcpToolName(serverName: string, toolName: string): string {
	const hash = createHash("sha1").update(`${serverName}\0${toolName}`).digest("hex").slice(0, 8);
	return `mcp_${normalizeName(serverName).slice(0, 16)}_${normalizeName(toolName).slice(0, 28)}_${hash}`;
}

export function normalizeName(value: string): string {
	const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
	return normalized || "server";
}

export function getSelectedTools(runtime: McpServerRuntime, state: McpPersistedState): Set<string> {
	const configured = state.enabledTools[runtime.name];
	return new Set(configured ?? runtime.tools.map((tool) => tool.name));
}

export function setServerEnabled(state: McpPersistedState, name: string, enabled: boolean): void {
	const servers = new Set(state.enabledServers);
	if (enabled) servers.add(name);
	else servers.delete(name);
	state.enabledServers = [...servers];
}

export function setToolEnabled(state: McpPersistedState, server: string, tool: string, enabled: boolean, allTools: readonly McpToolInfo[]): void {
	const selected = new Set(state.enabledTools[server] ?? allTools.map((item) => item.name));
	if (enabled) selected.add(tool);
	else selected.delete(tool);
	state.enabledTools[server] = [...selected];
}

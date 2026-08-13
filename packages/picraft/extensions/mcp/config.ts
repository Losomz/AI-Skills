import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface StdioServerConfig {
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
}

export interface HttpServerConfig {
	url: string;
	headers?: Record<string, string>;
}

export type McpServerConfig = (StdioServerConfig | HttpServerConfig) & {
	description?: string;
};

export interface McpConfig {
	mcpServers: Record<string, McpServerConfig>;
}

export interface LoadedMcpConfig {
	path: string;
	config: McpConfig;
	error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeServer(value: unknown, name: string): McpServerConfig {
	if (!isRecord(value)) throw new Error(`MCP server "${name}" must be an object`);
	const description = typeof value.description === "string" ? value.description.trim() : undefined;
	if (typeof value.command === "string" && value.command.trim()) {
		const args = value.args === undefined
			? undefined
			: Array.isArray(value.args) && value.args.every((item) => typeof item === "string")
				? value.args
				: (() => { throw new Error(`MCP server "${name}" args must be an array of strings`); })();
		const env = decodeStringMap(value.env, `MCP server "${name}" env`);
		const cwd = typeof value.cwd === "string" && value.cwd.trim() ? value.cwd.trim() : undefined;
		return { command: value.command.trim(), ...(args ? { args } : {}), ...(env ? { env } : {}), ...(cwd ? { cwd } : {}), ...(description ? { description } : {}) };
	}
	if (typeof value.url === "string" && value.url.trim()) {
		const headers = decodeStringMap(value.headers, `MCP server "${name}" headers`);
		return { url: value.url.trim(), ...(headers ? { headers } : {}), ...(description ? { description } : {}) };
	}
	throw new Error(`MCP server "${name}" requires command or url`);
}

function decodeStringMap(value: unknown, label: string): Record<string, string> | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value) || Object.entries(value).some(([key, item]) => !key.trim() || typeof item !== "string")) {
		throw new Error(`${label} must be an object of strings`);
	}
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item as string]));
}

export function decodeMcpConfig(value: unknown): McpConfig {
	if (!isRecord(value)) throw new Error("MCP configuration root must be an object");
	if (!isRecord(value.mcpServers)) throw new Error("MCP configuration requires mcpServers");
	const mcpServers: Record<string, McpServerConfig> = {};
	for (const [name, server] of Object.entries(value.mcpServers)) {
		if (!name.trim()) throw new Error("MCP server name must not be empty");
		mcpServers[name] = decodeServer(server, name);
	}
	return { mcpServers };
}

export function getGlobalMcpConfigPath(agentDir = getAgentDir()): string {
	return join(agentDir, "mcp.json");
}

export function getProjectMcpConfigPath(cwd: string): string {
	return join(cwd, ".mcp.json");
}

export function loadMcpConfig(configPath: string): LoadedMcpConfig {
	try {
		if (!existsSync(configPath)) return { path: configPath, config: { mcpServers: {} } };
		return { path: configPath, config: decodeMcpConfig(JSON.parse(readFileSync(configPath, "utf8"))) };
	} catch (error) {
		return { path: configPath, config: { mcpServers: {} }, error: `${configPath}: ${error instanceof Error ? error.message : String(error)}` };
	}
}

export function loadGlobalMcpConfig(agentDir = getAgentDir()): LoadedMcpConfig {
	return loadMcpConfig(getGlobalMcpConfigPath(agentDir));
}

export function loadProjectMcpConfig(cwd: string): LoadedMcpConfig {
	return loadMcpConfig(getProjectMcpConfigPath(cwd));
}

export function mcpConfigDescription(cwd: string): string {
	return `Global: ${getGlobalMcpConfigPath()}\nProject: ${getProjectMcpConfigPath(cwd)}`;
}

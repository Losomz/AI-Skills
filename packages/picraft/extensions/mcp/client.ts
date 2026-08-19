import { resolve } from "node:path";
import type { McpServerConfig } from "./config.ts";

export interface McpToolInfo {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export interface McpTextContent {
	type: "text";
	text: string;
}

export interface McpImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

export interface McpCallResult {
	content: Array<McpTextContent | McpImageContent>;
	isError: boolean;
	structuredContent?: Record<string, unknown>;
}

export interface McpConnection {
	readonly tools: McpToolInfo[];
	callTool(
		name: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
		onProgress?: (message: string) => void,
	): Promise<McpCallResult>;
	close(): Promise<void>;
}

function asObject(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

function asToolInfo(value: unknown): McpToolInfo | undefined {
	const tool = asObject(value);
	if (typeof tool.name !== "string" || !tool.name.trim()) return undefined;
	const schema = asObject(tool.inputSchema);
	return {
		name: tool.name,
		description: typeof tool.description === "string" && tool.description.trim()
			? tool.description
			: `Call the ${tool.name} MCP tool`,
		inputSchema: schema.type === "object" ? schema : { type: "object", properties: {} },
	};
}

function expandEnvironment(value: string): string {
	return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
		const resolved = process.env[name];
		if (resolved === undefined) throw new Error(`MCP environment variable "${name}" is not set`);
		return resolved;
	});
}

function inheritedEnvironment(base: Record<string, string>, overrides: Record<string, string> | undefined): Record<string, string> {
	const merged = { ...base, ...overrides };
	return Object.fromEntries(Object.entries(merged).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function contentFromResult(result: any): Array<McpTextContent | McpImageContent> {
	const content: Array<McpTextContent | McpImageContent> = [];
	for (const item of Array.isArray(result?.content) ? result.content : []) {
		if (item?.type === "text" && typeof item.text === "string") {
			content.push({ type: "text", text: item.text });
		} else if (item?.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string") {
			content.push({ type: "image", data: item.data, mimeType: item.mimeType });
		} else if (item?.type === "resource" && item.resource?.text !== undefined) {
			content.push({ type: "text", text: String(item.resource.text) });
		} else if (item?.type === "resource" && item.resource?.blob !== undefined) {
			content.push({ type: "text", text: `[MCP resource ${String(item.resource.uri ?? "")}] ${String(item.resource.blob)}` });
		} else if (item?.type === "audio") {
			content.push({ type: "text", text: `[MCP audio ${String(item.mimeType ?? "audio")}]` });
		} else if (item?.type === "resource_link") {
			content.push({ type: "text", text: `[MCP resource] ${String(item.name ?? item.uri ?? "")}` });
		}
	}
	if (result?.structuredContent !== undefined) {
		content.push({ type: "text", text: `[Structured content]\n${JSON.stringify(result.structuredContent, null, 2)}` });
	}
	if (content.length === 0) content.push({ type: "text", text: "MCP server returned no content." });
	return content;
}

async function listTools(client: any, signal?: AbortSignal): Promise<McpToolInfo[]> {
	const tools: McpToolInfo[] = [];
	let cursor: string | undefined;
	do {
		const result = await client.listTools(
			cursor ? { cursor } : undefined,
			{ signal, timeout: 15_000, maxTotalTimeout: 15_000 },
		);
		for (const item of result.tools) {
			const tool = asToolInfo(item);
			if (tool) tools.push(tool);
		}
		cursor = result.nextCursor;
	} while (cursor);
	return tools;
}

function closeClientWithTimeout(client: { close(): Promise<void> }, timeoutMs = 2_000): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, timeoutMs);
		void client.close().catch(() => undefined).finally(() => {
			clearTimeout(timer);
			resolve();
		});
	});
}

export async function connectMcpServer(config: McpServerConfig, cwd: string, signal?: AbortSignal): Promise<McpConnection> {
	const sdk = await import("@modelcontextprotocol/sdk/client/index.js");
	const stdio = await import("@modelcontextprotocol/sdk/client/stdio.js");
	const http = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
	const expanded = "command" in config
		? {
			...config,
			command: expandEnvironment(config.command),
			args: config.args?.map(expandEnvironment),
			cwd: config.cwd ? resolve(cwd, expandEnvironment(config.cwd)) : cwd,
			env: config.env
				? Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, expandEnvironment(value)]))
				: undefined,
		}
		: {
			...config,
			url: expandEnvironment(config.url),
			headers: config.headers
				? Object.fromEntries(Object.entries(config.headers).map(([key, value]) => [key, expandEnvironment(value)]))
				: undefined,
		};
	const client = new sdk.Client({ name: "picraft-mcp", version: "0.1.8" });
	const defaultEnvironment = typeof (stdio as { getDefaultEnvironment?: () => Record<string, string> }).getDefaultEnvironment === "function"
		? (stdio as { getDefaultEnvironment: () => Record<string, string> }).getDefaultEnvironment()
		: {};
	const transport = "command" in expanded
		? new stdio.StdioClientTransport({
				command: expanded.command,
				args: expanded.args,
				cwd: expanded.cwd,
				env: inheritedEnvironment(defaultEnvironment, expanded.env),
				stderr: "ignore",
			})
		: new http.StreamableHTTPClientTransport(new URL(expanded.url), {
			requestInit: expanded.headers ? { headers: expanded.headers } : undefined,
			});
	try {
		await client.connect(transport, { signal, timeout: 15_000, maxTotalTimeout: 15_000 });
		const tools = await listTools(client, signal);
		return {
			tools,
			async callTool(name, args, signal, onProgress) {
				const result = await client.callTool({ name, arguments: args }, undefined, {
					signal,
					onprogress: (progress: any) => {
						if (onProgress) onProgress(progress.message ?? `Progress: ${progress.progress ?? ""}${progress.total ? `/${progress.total}` : ""}`);
					},
				});
				return {
					content: contentFromResult(result),
					isError: result.isError === true,
					structuredContent: result.structuredContent,
				};
			},
			close: () => client.close(),
		};
	} catch (error) {
		await closeClientWithTimeout(client);
		throw error;
	}
}

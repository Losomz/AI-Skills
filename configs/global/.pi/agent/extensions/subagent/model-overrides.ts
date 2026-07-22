import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentConfig } from "./agents.js";

export const SUBAGENT_MODEL_CONFIG_VERSION = 1;
export const SUBAGENT_MODEL_CONFIG_FILE = "subagent-models.json";
const CONFIG_LOCK_TIMEOUT_MS = 2_000;
const CONFIG_LOCK_STALE_MS = 30_000;
const CONFIG_LOCK_RETRY_MS = 25;

export interface ModelReference {
	provider: string;
	id: string;
}

export interface SubagentModelConfig {
	version: typeof SUBAGENT_MODEL_CONFIG_VERSION;
	overrides: Record<string, ModelReference>;
}

export interface ModelConfigLoadResult {
	path: string;
	config: SubagentModelConfig;
	error?: string;
}

export type AgentModelSource = "override" | "profile" | "pi-default";

export interface EffectiveAgentConfig extends AgentConfig {
	modelSource: AgentModelSource;
	profileModel?: string;
	modelOverride?: ModelReference;
}

function emptyConfig(): SubagentModelConfig {
	return { version: SUBAGENT_MODEL_CONFIG_VERSION, overrides: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeModelReference(value: unknown, key: string): ModelReference {
	if (!isRecord(value)) throw new Error(`Override "${key}" must be an object`);
	if (typeof value.provider !== "string" || !value.provider.trim()) {
		throw new Error(`Override "${key}" has an invalid provider`);
	}
	if (typeof value.id !== "string" || !value.id.trim()) {
		throw new Error(`Override "${key}" has an invalid model id`);
	}
	return { provider: value.provider.trim(), id: value.id.trim() };
}

export function decodeSubagentModelConfig(value: unknown): SubagentModelConfig {
	if (!isRecord(value)) throw new Error("Configuration root must be an object");
	if (value.version !== SUBAGENT_MODEL_CONFIG_VERSION) {
		throw new Error(`Unsupported configuration version: ${String(value.version)}`);
	}
	if (!isRecord(value.overrides)) throw new Error("Configuration overrides must be an object");

	const overrides: Record<string, ModelReference> = {};
	for (const [rawKey, rawValue] of Object.entries(value.overrides)) {
		const key = rawKey.trim().toLowerCase();
		if (!key) throw new Error("Override key must not be empty");
		overrides[key] = decodeModelReference(rawValue, rawKey);
	}
	return { version: SUBAGENT_MODEL_CONFIG_VERSION, overrides };
}

export function getSubagentModelConfigPath(agentDir: string): string {
	return path.join(agentDir, SUBAGENT_MODEL_CONFIG_FILE);
}

export function loadSubagentModelConfig(configPath: string): ModelConfigLoadResult {
	let content: string;
	try {
		content = fs.readFileSync(configPath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { path: configPath, config: emptyConfig() };
		}
		return {
			path: configPath,
			config: emptyConfig(),
			error: `Unable to read ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	try {
		return { path: configPath, config: decodeSubagentModelConfig(JSON.parse(content)) };
	} catch (error) {
		return {
			path: configPath,
			config: emptyConfig(),
			error: `Invalid subagent model configuration at ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export function getAgentModelKey(agent: Pick<AgentConfig, "source" | "name">): string {
	return `${agent.source}:${agent.name.trim().toLowerCase()}`;
}

export function formatModelReference(model: ModelReference): string {
	return `${model.provider}/${model.id}`;
}

export function parseCanonicalModelReference(value: string): ModelReference | undefined {
	const trimmed = value.trim();
	const slash = trimmed.indexOf("/");
	if (slash <= 0 || slash === trimmed.length - 1) return undefined;
	const provider = trimmed.slice(0, slash).trim();
	const id = trimmed.slice(slash + 1).trim();
	return provider && id ? { provider, id } : undefined;
}

export function resolveAgentModel(
	agent: AgentConfig,
	config: SubagentModelConfig,
): EffectiveAgentConfig {
	const modelOverride = config.overrides[getAgentModelKey(agent)];
	if (modelOverride) {
		return {
			...agent,
			model: formatModelReference(modelOverride),
			modelSource: "override",
			profileModel: agent.model,
			modelOverride: { ...modelOverride },
		};
	}
	return {
		...agent,
		modelSource: agent.model ? "profile" : "pi-default",
		profileModel: agent.model,
	};
}

export function resolveAgentModels(
	agents: readonly AgentConfig[],
	config: SubagentModelConfig,
): EffectiveAgentConfig[] {
	return agents.map((agent) => resolveAgentModel(agent, config));
}

export function isEffectiveAgentConfig(agent: AgentConfig): agent is EffectiveAgentConfig {
	return "modelSource" in agent;
}

async function writeConfigAtomic(configPath: string, config: SubagentModelConfig): Promise<void> {
	await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
	const tempPath = path.join(
		path.dirname(configPath),
		`.${path.basename(configPath)}.${process.pid}.${Date.now().toString(36)}.tmp`,
	);
	try {
		await fs.promises.writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		await fs.promises.rename(tempPath, configPath);
	} finally {
		try {
			await fs.promises.rm(tempPath, { force: true });
		} catch {
			// Best-effort cleanup after a failed atomic replace.
		}
	}
}

const mutationQueues = new Map<string, Promise<unknown>>();

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireConfigLock(configPath: string): Promise<() => Promise<void>> {
	const lockPath = `${configPath}.lock`;
	await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
	const startedAt = Date.now();
	while (true) {
		try {
			const handle = await fs.promises.open(lockPath, "wx", 0o600);
			try {
				await handle.writeFile(`${process.pid} ${Date.now()}\n`, "utf8");
			} catch (error) {
				await handle.close();
				await fs.promises.rm(lockPath, { force: true });
				throw error;
			}
			return async () => {
				await handle.close();
				await fs.promises.rm(lockPath, { force: true });
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			try {
				const stat = await fs.promises.stat(lockPath);
				if (Date.now() - stat.mtimeMs > CONFIG_LOCK_STALE_MS) {
					await fs.promises.rm(lockPath, { force: true });
					continue;
				}
			} catch (statError) {
				if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue;
				throw statError;
			}
			if (Date.now() - startedAt >= CONFIG_LOCK_TIMEOUT_MS) {
				throw new Error(`Timed out waiting for subagent model configuration lock: ${lockPath}`);
			}
			await delay(CONFIG_LOCK_RETRY_MS);
		}
	}
}

async function withConfigMutation<T>(configPath: string, mutate: () => Promise<T>): Promise<T> {
	const previous = mutationQueues.get(configPath) ?? Promise.resolve();
	const operation = previous.catch(() => undefined).then(async () => {
		const release = await acquireConfigLock(configPath);
		try {
			return await mutate();
		} finally {
			await release();
		}
	});
	mutationQueues.set(configPath, operation);
	try {
		return await operation;
	} finally {
		if (mutationQueues.get(configPath) === operation) mutationQueues.delete(configPath);
	}
}

export async function setAgentModelOverride(
	agent: AgentConfig,
	model: ModelReference | undefined,
	configPath: string,
): Promise<SubagentModelConfig> {
	return withConfigMutation(configPath, async () => {
		const loaded = loadSubagentModelConfig(configPath);
		if (loaded.error) throw new Error(loaded.error);

		const key = getAgentModelKey(agent);
		const overrides = { ...loaded.config.overrides };
		if (model) overrides[key] = decodeModelReference(model, key);
		else delete overrides[key];

		const config: SubagentModelConfig = {
			version: SUBAGENT_MODEL_CONFIG_VERSION,
			overrides,
		};
		await writeConfigAtomic(configPath, config);
		return config;
	});
}

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { normalizeAdditionalPlanTools } from "./utils.ts";

export const PICRAFT_CONFIG_FILE = "picraft.json";

export interface PlanToolConfiguration {
	tools: string[];
	diagnostics: string[];
}

interface LoadPlanToolConfigurationOptions {
	cwd: string;
	projectTrusted: boolean;
	agentDir?: string;
	configDirName?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodePlanTools(value: unknown): string[] {
	if (!isRecord(value)) throw new Error("Configuration root must be an object");
	if (value.plan === undefined) return [];
	if (!isRecord(value.plan)) throw new Error("Configuration plan must be an object");
	if (value.plan.tools === undefined) return [];
	if (!Array.isArray(value.plan.tools) || value.plan.tools.some((name) => typeof name !== "string")) {
		throw new Error("Configuration plan.tools must be an array of strings");
	}
	return normalizeAdditionalPlanTools(value.plan.tools);
}

function loadPlanTools(configPath: string): { tools: string[]; diagnostic?: string } {
	let content: string;
	try {
		content = fs.readFileSync(configPath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { tools: [] };
		return { tools: [], diagnostic: `Unable to read Plan configuration at ${configPath}: ${error instanceof Error ? error.message : String(error)}` };
	}

	try {
		return { tools: decodePlanTools(JSON.parse(content)) };
	} catch (error) {
		return { tools: [], diagnostic: `Invalid Plan configuration at ${configPath}: ${error instanceof Error ? error.message : String(error)}` };
	}
}

export function loadPlanToolConfiguration(options: LoadPlanToolConfigurationOptions): PlanToolConfiguration {
	const globalPath = path.join(options.agentDir ?? getAgentDir(), PICRAFT_CONFIG_FILE);
	const configDirName = options.configDirName ?? CONFIG_DIR_NAME;
	const paths = [globalPath];
	if (options.projectTrusted) paths.push(path.join(options.cwd, configDirName, PICRAFT_CONFIG_FILE));

	const tools: string[] = [];
	const diagnostics: string[] = [];
	for (const configPath of paths) {
		const loaded = loadPlanTools(configPath);
		tools.push(...loaded.tools);
		if (loaded.diagnostic) diagnostics.push(loaded.diagnostic);
	}
	return { tools: Array.from(new Set(tools)), diagnostics };
}

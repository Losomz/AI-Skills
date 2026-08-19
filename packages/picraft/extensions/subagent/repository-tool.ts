import type { ExtensionAPI, ExecResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isScoutRepositoryCapabilityEnabled } from "./agent-runner.ts";
import {
	ensureScoutRepository,
	SCOUT_REPOSITORY_DEFAULT_TIMEOUT_MS,
	type ScoutGitExecOptions,
	type ScoutGitExecResult,
	type ScoutRepositoryResult,
} from "./repository-cache.ts";

export const SCOUT_REPOSITORY_TOOL_NAME = "scout_repository";
export { isScoutRepositoryCapabilityEnabled };

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 10 * 60_000;

export interface ScoutRepositoryToolResult {
	path: string | null;
	status: ScoutRepositoryResult["status"];
	head: string | null;
	branch: string | null;
	error?: string;
}

function normalizeTimeout(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return SCOUT_REPOSITORY_DEFAULT_TIMEOUT_MS;
	return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(value)));
}

function compactResult(result: ScoutRepositoryResult): ScoutRepositoryToolResult {
	return {
		path: result.path ?? null,
		status: result.status,
		head: result.head ?? null,
		branch: result.branch ?? null,
		...(result.error ? { error: result.error } : {}),
	};
}

function makeGitExecutor(pi: ExtensionAPI): (
	command: string,
	args: string[],
	options?: ScoutGitExecOptions,
) => Promise<ScoutGitExecResult> {
	return async (command, args, options) => {
		const result: ExecResult = await pi.exec(command, args, {
			cwd: options?.cwd,
			signal: options?.signal,
			timeout: options?.timeout,
		});
		return result;
	};
}

const ScoutRepositoryParameters = Type.Object(
	{
		url: Type.String({
			minLength: 1,
			maxLength: 4096,
			description: "Explicit HTTPS, HTTP, SSH, Git, or git@host:path repository URL",
		}),
		branch: Type.Optional(
			Type.String({ minLength: 1, maxLength: 255, description: "Branch to cache; omitted follows the remote default branch" }),
		),
		refresh: Type.Optional(
			Type.Boolean({ description: "Refresh an existing checkout from origin. Defaults to true; false permits offline reuse." }),
		),
		timeoutMs: Type.Optional(
			Type.Integer({
				minimum: MIN_TIMEOUT_MS,
				maximum: MAX_TIMEOUT_MS,
				description: "Overall clone or refresh timeout in milliseconds",
			}),
		),
	},
	{ additionalProperties: false },
);

export function registerScoutRepositoryTool(pi: ExtensionAPI): boolean {
	if (!isScoutRepositoryCapabilityEnabled()) return false;

	pi.registerTool({
		name: SCOUT_REPOSITORY_TOOL_NAME,
		label: "Scout Repository",
		description:
			"Clone, reuse, or refresh an external Git repository in PiCraft's managed Scout cache without writing to the current workspace.",
		promptSnippet: "Use the managed Scout repository cache for external Git source",
		promptGuidelines: [
			"Use scout_repository for every external repository checkout; do not run git clone or git fetch directly.",
			"Pass an explicit repository URL, provide a branch only when it is known, and set refresh to false only for intentional offline reuse.",
			"Treat a scout_repository stale result as unrefreshed external source and disclose that limitation in the research result.",
		],
		parameters: ScoutRepositoryParameters,
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, onUpdate) {
			onUpdate?.({ content: [{ type: "text" as const, text: "Preparing managed repository checkout..." }] });
			const result = await ensureScoutRepository({
				url: params.url,
				branch: params.branch,
				refresh: params.refresh ?? true,
				exec: makeGitExecutor(pi),
				signal,
				timeoutMs: normalizeTimeout(params.timeoutMs),
			});
			const compact = compactResult(result);
			if (compact.status === "failed" || compact.status === "cancelled") {
				throw new Error(compact.error ?? `Scout repository operation ${compact.status}`);
			}
			return {
				content: [{ type: "text" as const, text: JSON.stringify(compact) }],
				details: compact,
			};
		},
	});
	return true;
}

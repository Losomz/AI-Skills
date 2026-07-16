/**
 * Git Extension
 *
 * Provides a layered /git command for git operations.
 * Operations are auto-discovered from the operations/ directory.
 * To add a new operation, create a file in operations/ that exports
 * { value, label, description, handle(pi, ctx, args?), getCompletions?(prefix) }.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerCommitResultRenderer } from "./commit-renderer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const opsDir = path.join(__dirname, "operations");

interface GitOperation {
	value: string;
	label: string;
	order?: number;
	description: string;
	handle: (pi: ExtensionAPI, ctx: ExtensionContext, args?: unknown) => Promise<void>;
	getCompletions?: (prefix: string) => Awaited<ReturnType<NonNullable<NonNullable<Parameters<ExtensionAPI["registerCommand"]>[1]["getArgumentCompletions"]>>>>;
}

// Auto-discover all operation modules from operations/ directory
const operations: GitOperation[] = [];
for (const file of fs.readdirSync(opsDir).filter((f) => f.endsWith(".js") || f.endsWith(".ts"))) {
	const mod = await import(path.join(opsDir, file));
	if (mod.default?.value && mod.default?.handle) {
		operations.push(mod.default);
	}
}
operations.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

function formatOperationOption(op: GitOperation): string {
	return `${op.value} — ${op.description}`;
}

function parseOperationChoice(choice: string): string {
	const op = operations.find((item) => choice === item.value || choice === formatOperationOption(item));
	return op?.value ?? choice;
}

export default function (pi: ExtensionAPI) {
	registerCommitResultRenderer(pi);

	pi.registerCommand("git", {
		description: "Git operations",
		getArgumentCompletions: (prefix: string) => {
			const parts = prefix.trim().split(/\s+/).filter(Boolean);
			const normalizedPrefix = prefix.trim().toLowerCase();

			// Route to operation-specific completions
			if (parts.length > 1) {
				const op = operations.find((o) => o.value === parts[0].toLowerCase());
				if (op?.getCompletions) return op.getCompletions(prefix);
			}

			// Default: list all operations
			const items = operations.map((op) => ({
				value: op.value,
				label: op.label,
				description: op.description,
			}));
			const filtered = items.filter((item) => item.value.startsWith(normalizedPrefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			let operationName = (parts[0] ?? "").toLowerCase();

			if (!operationName) {
				const choice = await ctx.ui.select(
					"Git operation",
					operations.map((item) => formatOperationOption(item)),
				);
				if (!choice) {
					ctx.ui.notify("Git operation cancelled", "info");
					return;
				}
				operationName = parseOperationChoice(choice);
			}

			const op = operations.find((o) => o.value === operationName);
			if (!op) {
				ctx.ui.notify(`Unknown git operation: ${operationName}. Available: ${operations.map((o) => o.value).join(", ")}`, "error");
				return;
			}

			// For commit: parse agent and extra instructions from args
			if (op.value === "commit") {
				const rest = parts.slice(1);
				let agent: string | undefined;
				let extraParts: string[] = [];

				// Lazy import discoverAgents only when needed
				const { discoverAgents } = await import("../subagent/agents.js");
				const availableAgents = discoverAgents(process.cwd(), "project").agents.map((a) => a.name);

				if (rest[0] === "--agent" || rest[0] === "-a") {
					rest.shift();
					agent = rest.shift();
					extraParts = rest;
				} else if (rest[0] && availableAgents.some((item) => item.toLowerCase() === rest[0].toLowerCase())) {
					agent = rest.shift();
					extraParts = rest;
				} else {
					extraParts = rest;
				}

				await op.handle(pi, ctx, { agent, extraInstructions: extraParts.join(" ") });
				return;
			}

			await op.handle(pi, ctx);
		},
	});
}

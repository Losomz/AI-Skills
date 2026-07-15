/**
 * Git Extension (Project-local)
 *
 * Provides a layered /git command with operations in the desired order:
 *   1. commit  — 在独立 Pi 子进程中完成提交（不自动推送）
 *   2. pull    — 拉取远端变更并处理未提交改动
 *   3. branch  — 切换或创建分支
 *
 * Operations are loaded from the operations/ directory in a fixed order.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const opsDir = path.join(__dirname, "operations");

// Load all operations from the directory, then sort by `order` field
interface GitOperation {
	value: string;
	order?: number;
	label: string;
	description: string;
	handle: (pi: ExtensionAPI, ctx: ExtensionContext, args?: unknown) => Promise<void>;
	getCompletions?: (
		prefix: string,
	) => Awaited<
		ReturnType<
			NonNullable<NonNullable<Parameters<ExtensionAPI["registerCommand"]>[1]["getArgumentCompletions"]>>
		>
	>;
}

const operations: GitOperation[] = [];
for (const file of fs.readdirSync(opsDir).filter((f) => f.endsWith(".ts") || f.endsWith(".js"))) {
	const mod = await import(path.join(opsDir, file));
	if (mod.default?.value && mod.default?.handle) {
		operations.push(mod.default);
	}
}
operations.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

function formatOperationOption(op: GitOperation): string {
	return `${op.value} — ${op.description}`;
}

function parseOperationChoice(choice: string): string {
	const op = operations.find((item) => choice === item.value || choice === formatOperationOption(item));
	return op?.value ?? choice;
}

export default function (pi: ExtensionAPI) {
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

			// Default: list all operations in fixed order
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
				ctx.ui.notify(
					`Unknown git operation: ${operationName}. Available: ${operations.map((o) => o.value).join(", ")}`,
					"error",
				);
				return;
			}

			// For commit: parse agent and extra instructions from args
			if (op.value === "commit") {
				const rest = parts.slice(1);
				let agent: string | undefined;
				let extraParts: string[] = [];

				const { discoverAgents } = await import("../subagent/agents.js");
				const availableAgents = discoverAgents(ctx.cwd, "project").agents.map((item) => item.name);

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

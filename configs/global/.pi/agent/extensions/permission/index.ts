import { execFileSync } from "node:child_process";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { canonicalize, collectPermissionRequest, SessionGrants } from "./core.ts";
import { PermissionPromptQueue } from "./queue.ts";
import { requestPermissionDecision } from "./ui.ts";

const grantsBySession = new Map<string, SessionGrants>();
const permissionPromptQueue = new PermissionPromptQueue();

export default function permissionExtension(pi: ExtensionAPI): void {
	pi.on("tool_call", async (event, ctx) => {
		const request = collectPermissionRequest(
			{ toolName: event.toolName, input: event.input as Record<string, unknown> },
			ctx.cwd,
			projectRoots(ctx.cwd),
			subagentName(),
		);
		if (!request) return undefined;

		const grants = sessionGrants(ctx);
		const { decision } = await permissionPromptQueue.enqueue({
			request,
			grants,
			isAborted: () => ctx.signal?.aborted ?? false,
			hasUI: ctx.hasUI,
			decide: (restrictedRequest) => requestPermissionDecision(ctx, restrictedRequest),
		});

		if (!decision || decision.kind === "once" || decision.kind === "always") return undefined;
		return {
			block: true,
			reason: decision.feedback
				? `Permission rejected by the user. User feedback: ${decision.feedback}`
				: ctx.hasUI
					? "Permission rejected by the user."
					: "Permission denied because no interactive UI is available.",
		};
	});

	pi.registerCommand("permissions", {
		description: "Manage session permission grants",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;

			const grants = sessionGrants(ctx);
			const rules = grants.list();
			const choices = [
				...rules.map(formatRule),
				...(rules.length > 0 ? ["Clear all session grants"] : []),
				"Cancel",
			];
			const selected = await ctx.ui.select("Session permission grants", choices);
			if (!selected || selected === "Cancel") return;
			if (selected === "Clear all session grants") {
				grants.clear();
				return;
			}

			const rule = rules.find((item) => formatRule(item) === selected);
			if (rule) grants.remove(rule.permission, rule.alwaysPattern);
		},
	});

	pi.on("session_shutdown", () => {
		grantsBySession.clear();
	});
}

function sessionGrants(ctx: ExtensionContext): SessionGrants {
	const id = ctx.sessionManager.getSessionId() || "no-session";
	let grants = grantsBySession.get(id);
	if (!grants) {
		grants = new SessionGrants();
		grantsBySession.set(id, grants);
	}
	return grants;
}

function projectRoots(cwd: string): string[] {
	const roots = [canonicalize(cwd)];
	try {
		const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (gitRoot) roots.push(canonicalize(gitRoot));
	} catch {
		// A non-Git project uses only its launch directory as the boundary.
	}
	return [...new Set(roots)];
}

function subagentName(): string | undefined {
	if (!process.env.PI_IS_SUBAGENT?.trim()) return undefined;
	return process.env.PI_SUBAGENT_NAME?.trim() || "Subagent";
}

function formatRule(rule: { permission: string; alwaysPattern: string }): string {
	return `${rule.permission}: ${rule.alwaysPattern}`;
}

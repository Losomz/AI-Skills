import { type ExtensionAPI, getAgentDir, getPackageDir } from "@earendil-works/pi-coding-agent";

import {
	claimPermissionExtensionRegistration,
	currentSessionId,
	getPermissionRuntime,
	isSubagentProcess,
	parentSessionId,
	permissionRequestId,
	releasePermissionExtensionRegistration,
} from "./authority.ts";
import { collectPermissionRequest, requirementAccess, type PermissionRequest } from "./core.ts";
import {
	loadParentGrantView,
	permissionForwardingRoot,
	PermissionForwardingServer,
	PermissionSnapshotStore,
	requestParentPermission,
} from "./forwarding.ts";
import { buildPermissionPathPolicy, extractSubmittedTempFiles } from "./policy.ts";
import { getOutstandingRequirements, type PermissionPromptDecision } from "./presentation.ts";
import { requestPermissionDecision } from "./ui.ts";

export default function permissionExtension(pi: ExtensionAPI): void {
	if (!claimPermissionExtensionRegistration()) return;
	const authority = getPermissionRuntime().authority;
	const forwardingRoot = permissionForwardingRoot(getAgentDir());
	const forwardingServer = new PermissionForwardingServer(
		forwardingRoot,
		(sessionId) => authority.refreshSnapshot(sessionId),
	);
	const childProcess = isSubagentProcess();

	if (!childProcess) authority.configureSnapshotStore(new PermissionSnapshotStore(forwardingRoot));

	pi.on("session_start", (_event, ctx) => {
		if (childProcess) return;
		const sessionId = currentSessionId(ctx);
		authority.activateSession(sessionId);
		forwardingServer.start(sessionId, async (forwarded) => {
			const result = await authority.authorize({
				sessionId,
				requestId: `forwarded:${forwarded.id}`,
				request: forwarded.request,
				isAborted: () => ctx.signal?.aborted ?? false,
				hasUI: ctx.hasUI,
				decide: (request) => requestPermissionDecision(ctx, request),
			});
			return result.decision ?? { kind: "once" };
		});
	});

	pi.on("tool_call", async (event, ctx) => {
		const localSessionId = currentSessionId(ctx);
		const agentName = subagentName();
		const toolCall = { toolName: event.toolName, input: event.input as Record<string, unknown> };
		const localPolicy = buildPermissionPathPolicy(ctx.cwd, {
			agentDir: getAgentDir(),
			packageDir: getPackageDir(),
			sessionTrustedFiles: authority.trustedFiles(localSessionId),
		});
		const request = collectPermissionRequest(toolCall, ctx.cwd, localPolicy, agentName);
		if (!request) return undefined;

		let decision: PermissionPromptDecision | undefined;
		if (childProcess) {
			const parentId = parentSessionId();
			const firstView = parentId ? loadParentGrantView(forwardingRoot, parentId) : undefined;
			const isCovered = (view: NonNullable<typeof firstView>): boolean => {
				const inheritedRequest = collectPermissionRequest(
					toolCall,
					ctx.cwd,
					{
						...localPolicy,
						trustedReadFiles: [
							...(localPolicy.trustedReadFiles ?? []),
							...view.trustedReadFiles,
						],
					},
					agentName,
				);
				return !inheritedRequest || getOutstandingRequirements(inheritedRequest, view.grants).length === 0;
			};
			if (firstView && isCovered(firstView)) {
				const confirmedView = parentId ? loadParentGrantView(forwardingRoot, parentId) : undefined;
				if (confirmedView?.revision === firstView.revision && isCovered(confirmedView)) return undefined;
			}
			decision = parentId
				? await requestParentPermission({
					forwardingRoot,
					parentSessionId: parentId,
					requesterSessionId: localSessionId,
					requesterAgentName: agentName,
					request,
					isAborted: () => ctx.signal?.aborted ?? false,
				})
				: { kind: "reject" };
		} else {
			const result = await authority.authorize({
				sessionId: localSessionId,
				requestId: permissionRequestId(event.toolCallId),
				request,
				isAborted: () => ctx.signal?.aborted ?? false,
				hasUI: ctx.hasUI,
				decide: (restrictedRequest) => requestPermissionDecision(ctx, restrictedRequest),
			});
			decision = result.decision;
		}

		if (!decision || decision.kind === "once" || decision.kind === "always") return undefined;
		return permissionRejection(decision, childProcess, ctx.hasUI);
	});

	pi.on("tool_result", (event, ctx) => {
		const details = event.details as { fullOutputPath?: unknown } | undefined;
		if (event.toolName === "bash" && typeof details?.fullOutputPath === "string") {
			authority.registerTrustedFile(currentSessionId(ctx), details.fullOutputPath);
		}
	});

	pi.on("input", (event, ctx) => {
		registerSubmittedFiles(authority, currentSessionId(ctx), event.text);
		return { action: "continue" };
	});

	pi.on("before_agent_start", (event, ctx) => {
		registerSubmittedFiles(authority, currentSessionId(ctx), event.prompt);
	});

	pi.registerCommand("permissions", {
		description: "Manage session permission grants",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI || childProcess) return;
			const grants = authority.grantsFor(currentSessionId(ctx));
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
			if (rule) grants.remove(rule.permission, rule.alwaysPattern, requirementAccess(rule));
		},
	});

	pi.on("session_shutdown", (_event, ctx) => {
		forwardingServer.stop();
		authority.clearSession(currentSessionId(ctx));
		releasePermissionExtensionRegistration();
	});
}

function permissionRejection(
	decision: Extract<PermissionPromptDecision, { kind: "reject" }>,
	childProcess: boolean,
	hasUI: boolean,
): { block: true; reason: string } {
	if (decision.feedback) {
		return { block: true, reason: `Permission rejected by the user. User feedback: ${decision.feedback}` };
	}
	if (childProcess) {
		return { block: true, reason: "Permission denied by the parent conversation or permission forwarding is unavailable." };
	}
	return {
		block: true,
		reason: hasUI
			? "Permission rejected by the user."
			: "Permission denied because no interactive UI is available.",
	};
}

function registerSubmittedFiles(
	authority: ReturnType<typeof getPermissionRuntime>["authority"],
	sessionId: string,
	text: string,
): void {
	for (const filePath of extractSubmittedTempFiles(text)) authority.registerTrustedFile(sessionId, filePath);
}

function subagentName(): string | undefined {
	if (!isSubagentProcess()) return undefined;
	return process.env.PI_SUBAGENT_NAME?.trim() || "Subagent";
}

function formatRule(rule: PermissionRequest["requirements"][number]): string {
	return `${rule.permission}:${requirementAccess(rule)}: ${rule.alwaysPattern}`;
}

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
	canonicalize,
	normalizePathForPolicy,
	SessionGrants,
	type PermissionRequest,
} from "./core.ts";
import { PermissionSnapshotStore } from "./forwarding.ts";
import { PermissionPromptQueue, type PermissionPromptResult } from "./queue.ts";
import type { PermissionPromptDecision } from "./presentation.ts";

export interface PermissionAuthorizationOptions {
	sessionId: string;
	requestId: string;
	request: PermissionRequest;
	isAborted: () => boolean;
	hasUI: boolean;
	decide: (request: PermissionRequest) => Promise<PermissionPromptDecision>;
}

export class PermissionAuthority {
	private readonly grantsBySession = new Map<string, SessionGrants>();
	private readonly trustedFilesBySession = new Map<string, Set<string>>();
	private readonly revisionsBySession = new Map<string, number>();
	private readonly queue = new PermissionPromptQueue();
	private snapshotStore: PermissionSnapshotStore | undefined;

	configureSnapshotStore(store: PermissionSnapshotStore): void {
		this.snapshotStore = store;
		for (const sessionId of this.grantsBySession.keys()) this.publishSnapshot(sessionId);
	}

	activateSession(sessionId: string): void {
		this.grantsFor(sessionId);
		this.publishSnapshot(sessionId);
	}

	refreshSnapshot(sessionId: string): void {
		if (this.grantsBySession.has(sessionId)) this.publishSnapshot(sessionId);
	}

	authorize(options: PermissionAuthorizationOptions): Promise<PermissionPromptResult> {
		const grants = this.grantsFor(options.sessionId);
		const request = this.removeTrustedFileRequirements(options.sessionId, options.request);
		return this.queue.enqueue({
			sessionId: options.sessionId,
			requestId: JSON.stringify([options.sessionId, options.requestId]),
			request,
			grants,
			isAborted: options.isAborted,
			hasUI: options.hasUI,
			decide: options.decide,
		});
	}

	grantsFor(sessionId: string): SessionGrants {
		let grants = this.grantsBySession.get(sessionId);
		if (!grants) {
			grants = new SessionGrants(() => this.publishSnapshot(sessionId));
			this.grantsBySession.set(sessionId, grants);
		}
		return grants;
	}

	registerTrustedFile(sessionId: string, filePath: string): void {
		let files = this.trustedFilesBySession.get(sessionId);
		if (!files) {
			files = new Set<string>();
			this.trustedFilesBySession.set(sessionId, files);
		}
		const sizeBefore = files.size;
		files.add(policyPath(filePath));
		if (files.size !== sizeBefore) this.publishSnapshot(sessionId);
	}

	trustedFiles(sessionId: string): string[] {
		return Array.from(this.trustedFilesBySession.get(sessionId) ?? []);
	}

	clearSession(sessionId: string): void {
		this.queue.cancelSession(sessionId);
		this.grantsBySession.delete(sessionId);
		this.trustedFilesBySession.delete(sessionId);
		this.revisionsBySession.delete(sessionId);
		this.snapshotStore?.remove(sessionId);
	}

	clearAll(): void {
		const sessionIds = new Set([
			...this.grantsBySession.keys(),
			...this.trustedFilesBySession.keys(),
		]);
		for (const sessionId of sessionIds) this.clearSession(sessionId);
	}

	pendingCount(): number {
		return this.queue.pendingCount();
	}

	private publishSnapshot(sessionId: string): void {
		if (!this.snapshotStore) return;
		const revision = (this.revisionsBySession.get(sessionId) ?? 0) + 1;
		const published = this.snapshotStore.publish(
			sessionId,
			revision,
			this.grantsBySession.get(sessionId)?.list() ?? [],
			this.trustedFiles(sessionId),
		);
		if (published) this.revisionsBySession.set(sessionId, revision);
	}

	private removeTrustedFileRequirements(sessionId: string, request: PermissionRequest): PermissionRequest {
		if (!isReadTool(request.toolName)) return request;
		const files = this.trustedFilesBySession.get(sessionId);
		if (!files?.size) return request;
		const requirements = request.requirements.filter(
			(requirement) =>
				requirement.permission !== "external_directory" ||
				!files.has(policyPath(requirement.pattern)),
		);
		return requirements.length === request.requirements.length ? request : { ...request, requirements };
	}
}

export interface PermissionRuntimeState {
	authority: PermissionAuthority;
	extensionRegistered: boolean;
}

const RUNTIME_KEY = Symbol.for("@losomz/picraft/permission-runtime/v2");
const runtimeHost = globalThis as unknown as { [key: symbol]: PermissionRuntimeState | undefined };

export function getPermissionRuntime(): PermissionRuntimeState {
	let state = runtimeHost[RUNTIME_KEY];
	if (!state) {
		state = { authority: new PermissionAuthority(), extensionRegistered: false };
		runtimeHost[RUNTIME_KEY] = state;
	}
	return state;
}

export function claimPermissionExtensionRegistration(): boolean {
	const runtime = getPermissionRuntime();
	if (runtime.extensionRegistered) return false;
	runtime.extensionRegistered = true;
	return true;
}

export function releasePermissionExtensionRegistration(): void {
	getPermissionRuntime().extensionRegistered = false;
}

export function currentSessionId(ctx: ExtensionContext): string {
	return ctx.sessionManager.getSessionId() || "no-session";
}

export function parentSessionId(): string | undefined {
	const value = process.env.PI_SUBAGENT_PARENT_SESSION?.trim();
	return value || undefined;
}

export function isSubagentProcess(): boolean {
	return Boolean(process.env.PI_IS_SUBAGENT?.trim());
}

export function permissionRequestId(toolCallId: string): string {
	return toolCallId;
}

function policyPath(filePath: string): string {
	return comparable(normalizePathForPolicy(canonicalize(filePath)));
}

function comparable(filePath: string): string {
	return process.platform === "win32" ? filePath.toLowerCase() : filePath;
}

function isReadTool(toolName: string): boolean {
	return toolName === "read" || toolName === "grep" || toolName === "find" || toolName === "ls";
}

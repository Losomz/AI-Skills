import type { PermissionRequest, PermissionRequirement, SessionGrants } from "./core.ts";
import {
	getOutstandingRequirements,
	type PermissionPromptDecision,
} from "./presentation.ts";

export interface PermissionPromptResult {
	decision: PermissionPromptDecision | undefined;
	outstanding: PermissionRequirement[];
}

export interface PermissionPromptOptions {
	requestId?: string;
	sessionId?: string;
	request: PermissionRequest;
	grants: SessionGrants;
	isAborted: () => boolean;
	hasUI: boolean;
	decide: (request: PermissionRequest) => Promise<PermissionPromptDecision>;
}

interface PendingEntry {
	id: string;
	options: PermissionPromptOptions;
	promise: Promise<PermissionPromptResult>;
	resolve: (result: PermissionPromptResult) => void;
	reject: (error: unknown) => void;
	cancelled: boolean;
}

export class PermissionPromptQueue {
	private readonly pending = new Map<string, PendingEntry>();
	private readonly order: string[] = [];
	private draining = false;
	private sequence = 0;

	enqueue(options: PermissionPromptOptions): Promise<PermissionPromptResult> {
		const id = options.requestId?.trim() || `permission-${++this.sequence}`;
		const existing = this.pending.get(id);
		if (existing) return existing.promise;

		let resolve!: (result: PermissionPromptResult) => void;
		let reject!: (error: unknown) => void;
		const promise = new Promise<PermissionPromptResult>((resolvePromise, rejectPromise) => {
			resolve = resolvePromise;
			reject = rejectPromise;
		});
		this.pending.set(id, { id, options, promise, resolve, reject, cancelled: false });
		this.order.push(id);
		void this.drain();
		return promise;
	}

	pendingCount(): number {
		return this.pending.size;
	}

	cancelSession(sessionId: string): void {
		for (const entry of this.pending.values()) {
			if (entry.options.sessionId !== sessionId) continue;
			entry.cancelled = true;
			this.settle(entry, {
				decision: { kind: "reject" },
				outstanding: getOutstandingRequirements(entry.options.request, entry.options.grants),
			});
		}
	}

	private async drain(): Promise<void> {
		if (this.draining) return;
		this.draining = true;
		try {
			while (this.order.length > 0) {
				const id = this.order.shift()!;
				const entry = this.pending.get(id);
				if (!entry) continue;
				try {
					const outstanding = getOutstandingRequirements(entry.options.request, entry.options.grants);
					if (outstanding.length === 0) {
						this.settle(entry, { decision: undefined, outstanding });
						continue;
					}
					if (entry.options.isAborted() || !entry.options.hasUI) {
						this.settle(entry, { decision: { kind: "reject" }, outstanding });
						continue;
					}

					const grantRevision = entry.options.grants.currentRevision();
					const decision = await entry.options.decide({ ...entry.options.request, requirements: outstanding });
					if (entry.cancelled || this.pending.get(entry.id) !== entry) continue;
					if (entry.options.grants.currentRevision() !== grantRevision) {
						const currentOutstanding = getOutstandingRequirements(entry.options.request, entry.options.grants);
						this.settle(entry, currentOutstanding.length === 0
							? { decision: undefined, outstanding: currentOutstanding }
							: { decision: { kind: "reject" }, outstanding: currentOutstanding });
						continue;
					}

					if (decision.kind === "always") {
						entry.options.grants.add(outstanding);
					}
					this.settle(entry, { decision, outstanding });
					if (decision.kind === "always") this.releaseCovered(entry.options.grants);
				} catch (error) {
					this.fail(entry, error);
				}
			}
		} finally {
			this.draining = false;
			if (this.order.some((id) => this.pending.has(id))) void this.drain();
		}
	}

	private releaseCovered(grants: SessionGrants): void {
		for (const entry of this.pending.values()) {
			if (entry.options.grants !== grants) continue;
			const outstanding = getOutstandingRequirements(entry.options.request, grants);
			if (outstanding.length === 0) this.settle(entry, { decision: undefined, outstanding });
		}
	}

	private settle(entry: PendingEntry, result: PermissionPromptResult): void {
		if (!this.pending.delete(entry.id)) return;
		entry.resolve(result);
	}

	private fail(entry: PendingEntry, error: unknown): void {
		if (!this.pending.delete(entry.id)) return;
		entry.reject(error);
	}
}

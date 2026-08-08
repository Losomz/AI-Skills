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
	request: PermissionRequest;
	grants: SessionGrants;
	isAborted: () => boolean;
	hasUI: boolean;
	decide: (request: PermissionRequest) => Promise<PermissionPromptDecision>;
}

export class PermissionPromptQueue {
	private tail: Promise<void> = Promise.resolve();

	enqueue(options: PermissionPromptOptions): Promise<PermissionPromptResult> {
		const previous = this.tail;
		let release!: () => void;
		this.tail = new Promise<void>((resolve) => {
			release = resolve;
		});

		return previous.then(async () => {
			try {
				const outstanding = getOutstandingRequirements(options.request, options.grants);
				if (outstanding.length === 0) return { decision: undefined, outstanding };
				if (options.isAborted() || !options.hasUI) return { decision: { kind: "reject" }, outstanding };

				const decision = await options.decide({ ...options.request, requirements: outstanding });
				if (decision.kind === "always") options.grants.add(outstanding);
				return { decision, outstanding };
			} finally {
				release();
			}
		});
	}
}

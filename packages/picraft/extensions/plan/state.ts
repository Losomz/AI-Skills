/** Plan state persisted in Pi sessions plus the small amount of runtime-only state. */

export const PLAN_STATE_TYPE = "plan-state";
export const LEGACY_PLAN_STATE_TYPE = "plan-mode";

export type PlanMode = "plan" | "execute";
export type ModeOrigin = "manual" | "execute" | "startup" | "hydrate";

export interface InactiveNotice {
	kind: "inactive";
	revision: number;
}

export interface PersistedPlanStateV2 {
	enabled: boolean;
	revision: number;
	toolsBeforePlan?: string[];
	notice?: InactiveNotice;
}

export interface PendingModeChange {
	target: PlanMode;
	origin: Exclude<ModeOrigin, "hydrate">;
}

export interface RunControl {
	kind: "active" | "inactive";
	revision: number;
}

export interface RuntimePlanState {
	mode: PlanMode;
	revision: number;
	toolsBeforePlan?: string[];
	notice?: InactiveNotice;
	pending?: PendingModeChange;
	runMode?: PlanMode;
	runControl?: RunControl;
}

export interface SessionEntryLike {
	type?: unknown;
	customType?: unknown;
	data?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTools(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return Array.from(
		new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)),
	);
}

/** Accept v2 entries and the legacy `{ enabled }` shape; reject malformed explicit revisions. */
export function decodePlanState(value: unknown): PersistedPlanStateV2 | undefined {
	if (!isRecord(value) || typeof value.enabled !== "boolean") return undefined;

	const hasRevision = Object.prototype.hasOwnProperty.call(value, "revision");
	if (hasRevision && (typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 0)) {
		return undefined;
	}

	const revision = hasRevision ? (value.revision as number) : 0;
	const result: PersistedPlanStateV2 = { enabled: value.enabled, revision };
	const tools = normalizeTools(value.toolsBeforePlan);
	if (tools !== undefined) result.toolsBeforePlan = tools;

	if (!result.enabled && hasRevision && isRecord(value.notice) && value.notice.kind === "inactive") {
		const noticeRevision = value.notice.revision;
		if (typeof noticeRevision === "number" && Number.isSafeInteger(noticeRevision) && noticeRevision === revision) {
			result.notice = { kind: "inactive", revision };
		}
	}
	return result;
}

/** Entries must already be the current branch returned by `getBranch()`. */
export function findLatestPlanState(entries: readonly SessionEntryLike[]): PersistedPlanStateV2 | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.type !== "custom" || (entry.customType !== PLAN_STATE_TYPE && entry.customType !== LEGACY_PLAN_STATE_TYPE)) continue;
		const decoded = decodePlanState(entry.data);
		if (decoded) return decoded;
	}
	return undefined;
}

export function toPersistedState(state: RuntimePlanState): PersistedPlanStateV2 {
	const persisted: PersistedPlanStateV2 = {
		enabled: state.mode === "plan",
		revision: state.revision,
	};
	if (state.toolsBeforePlan !== undefined) persisted.toolsBeforePlan = [...state.toolsBeforePlan];
	if (state.notice) persisted.notice = { ...state.notice };
	return persisted;
}

export function modeFromState(state: PersistedPlanStateV2 | undefined): PlanMode {
	return state?.enabled ? "plan" : "execute";
}

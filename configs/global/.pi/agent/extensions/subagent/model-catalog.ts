import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { ModelReference } from "./model-overrides.ts";
import { formatModelReference } from "./model-overrides.ts";
import { AGENT_THINKING_LEVELS, type AgentThinkingLevel } from "./thinking.ts";

export type ModelAvailability = "available" | "runtime-only" | "known-unavailable" | "unknown";
export type ThinkingLevelCompatibility = "supported" | "unsupported" | "unknown";

const DEFAULT_THINKING_LEVELS: AgentThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

export interface ModelCatalogItem extends ModelReference {
	canonical: string;
	name: string;
	model: Model<Api>;
	authSource?: string;
}

export interface ModelCatalogSnapshot {
	items: ModelCatalogItem[];
	error?: string;
	refreshed: boolean;
}

function normalizedModelKey(model: ModelReference): string {
	return formatModelReference(model).toLowerCase();
}

export function modelReferencesEqual(left: ModelReference, right: ModelReference): boolean {
	return normalizedModelKey(left) === normalizedModelKey(right);
}

export function getSupportedAgentThinkingLevels(model?: Model<Api>): AgentThinkingLevel[] {
	if (!model) return [...DEFAULT_THINKING_LEVELS];
	if (!model.reasoning) return ["off"];
	return AGENT_THINKING_LEVELS.filter((level) => {
		const mapped = model.thinkingLevelMap?.[level];
		if (mapped === null) return false;
		if (level === "xhigh" || level === "max") return mapped !== undefined;
		return true;
	});
}

export function getThinkingLevelCompatibility(
	registry: Pick<ModelRegistry, "getAll">,
	reference: ModelReference,
	thinkingLevel: AgentThinkingLevel,
): ThinkingLevelCompatibility {
	const key = normalizedModelKey(reference);
	const model = registry.getAll().find((candidate) => normalizedModelKey(candidate) === key);
	if (!model) return "unknown";
	return getSupportedAgentThinkingLevels(model).includes(thinkingLevel) ? "supported" : "unsupported";
}

export function createModelCatalogItems(
	models: readonly Model<Api>[],
	registry: Pick<ModelRegistry, "getProviderAuthStatus">,
): ModelCatalogItem[] {
	const seen = new Set<string>();
	const items: ModelCatalogItem[] = [];
	for (const model of models) {
		const reference = { provider: model.provider, id: model.id };
		const key = normalizedModelKey(reference);
		if (seen.has(key)) continue;
		seen.add(key);
		items.push({
			...reference,
			canonical: formatModelReference(reference),
			name: model.name || model.id,
			model,
			authSource: registry.getProviderAuthStatus(model.provider).source,
		});
	}
	return items.sort((left, right) => {
		const providerOrder = left.provider.localeCompare(right.provider);
		return providerOrder !== 0 ? providerOrder : left.id.localeCompare(right.id);
	});
}

/** Models selectable for a subprocess; parent-only runtime credentials cannot be inherited safely. */
export function getAvailableModelCatalog(registry: ModelRegistry): ModelCatalogItem[] {
	return createModelCatalogItems(registry.getAvailable(), registry).filter((item) => item.authSource !== "runtime");
}

export function findAvailableModel(
	registry: ModelRegistry,
	reference: ModelReference,
): ModelCatalogItem | undefined {
	const key = normalizedModelKey(reference);
	return getAvailableModelCatalog(registry).find((item) => normalizedModelKey(item) === key);
}

export function getModelAvailability(registry: ModelRegistry, reference: ModelReference): ModelAvailability {
	const key = normalizedModelKey(reference);
	const available = registry.getAvailable().find((model) => normalizedModelKey(model) === key);
	if (available) {
		return registry.getProviderAuthStatus(available.provider).source === "runtime" ? "runtime-only" : "available";
	}
	if (registry.getAll().some((model) => normalizedModelKey(model) === key)) return "known-unavailable";
	return "unknown";
}

/** Coalesces user-triggered refreshes and never discards Pi's last available snapshot on failure. */
export class ModelCatalogService {
	private refreshInFlight?: Promise<ModelCatalogSnapshot>;

	getSnapshot(registry: ModelRegistry): ModelCatalogSnapshot {
		return {
			items: getAvailableModelCatalog(registry),
			error: registry.getError(),
			refreshed: false,
		};
	}

	refresh(registry: ModelRegistry): Promise<ModelCatalogSnapshot> {
		if (this.refreshInFlight) return this.refreshInFlight;

		const refresh = (async (): Promise<ModelCatalogSnapshot> => {
			let refreshError: string | undefined;
			try {
				await registry.refresh();
			} catch (error) {
				refreshError = error instanceof Error ? error.message : String(error);
			}
			return {
				items: getAvailableModelCatalog(registry),
				error: refreshError ?? registry.getError(),
				refreshed: true,
			};
		})();

		let tracked: Promise<ModelCatalogSnapshot>;
		tracked = refresh.finally(() => {
			if (this.refreshInFlight === tracked) this.refreshInFlight = undefined;
		});
		this.refreshInFlight = tracked;
		return tracked;
	}
}

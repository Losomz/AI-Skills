import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createModelCatalogItems,
	findAvailableModel,
	getModelAvailability,
	ModelCatalogService,
	modelReferencesEqual,
} from "../model-catalog.ts";

function model(provider: string, id: string, name = id): any {
	return {
		provider,
		id,
		name,
		api: "openai-responses",
		baseUrl: "https://example.invalid",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	};
}

function fakeRegistry(options: {
	available?: any[];
	all?: any[];
	refresh?: () => Promise<void>;
	error?: string;
} = {}): any {
	return {
		getAvailable: () => options.available ?? [],
		getAll: () => options.all ?? options.available ?? [],
		getProviderAuthStatus: (provider: string) => ({ configured: true, source: provider === "runtime" ? "runtime" : "stored" }),
		getError: () => options.error,
		refresh: options.refresh ?? (async () => {}),
	};
}

test("catalog normalizes, de-duplicates, sorts, and records auth source", () => {
	const registry = fakeRegistry();
	const items = createModelCatalogItems(
		[
			model("z-provider", "b"),
			model("a-provider", "z", "Friendly"),
			model("a-provider", "z", "Duplicate"),
			model("runtime", "a"),
		],
		registry,
	);
	assert.deepEqual(items.map((item) => item.canonical), ["a-provider/z", "runtime/a", "z-provider/b"]);
	assert.equal(items[0].name, "Friendly");
	assert.equal(items[1].authSource, "runtime");
});

test("model availability and exact canonical lookup do not use fuzzy matching", () => {
	const available = model("provider", "vendor/model:exacto");
	const unavailable = model("provider", "disabled");
	const runtimeOnly = model("runtime", "parent-only");
	const registry = fakeRegistry({ available: [available, runtimeOnly], all: [available, unavailable, runtimeOnly] });

	assert.equal(getModelAvailability(registry, { provider: "PROVIDER", id: "vendor/model:exacto" }), "available");
	assert.equal(getModelAvailability(registry, { provider: "runtime", id: "parent-only" }), "runtime-only");
	assert.equal(getModelAvailability(registry, { provider: "provider", id: "disabled" }), "known-unavailable");
	assert.equal(getModelAvailability(registry, { provider: "provider", id: "missing" }), "unknown");
	assert.equal(findAvailableModel(registry, { provider: "provider", id: "vendor/model:exacto" })?.model, available);
	assert.equal(findAvailableModel(registry, { provider: "runtime", id: "parent-only" }), undefined);
	assert.equal(findAvailableModel(registry, { provider: "provider", id: "vendor" }), undefined);
	assert.equal(modelReferencesEqual({ provider: "P", id: "M" }, { provider: "p", id: "m" }), true);
});

test("catalog refresh is single-flight and publishes the refreshed snapshot", async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const options: { available: any[]; refresh: () => Promise<void> } = {
		available: [model("provider", "old")],
		refresh: async () => {
			await gate;
			options.available = [model("provider", "new")];
		},
	};
	const registry = fakeRegistry(options);
	const service = new ModelCatalogService();
	const first = service.refresh(registry);
	const second = service.refresh(registry);
	assert.equal(first, second);
	release();
	const snapshot = await first;
	assert.equal(snapshot.refreshed, true);
	assert.deepEqual(snapshot.items.map((item) => item.canonical), ["provider/new"]);
});

test("refresh failures preserve the last available snapshot and return a diagnostic", async () => {
	const registry = fakeRegistry({
		available: [model("provider", "cached")],
		refresh: async () => {
			throw new Error("network failed");
		},
	});
	const snapshot = await new ModelCatalogService().refresh(registry);
	assert.deepEqual(snapshot.items.map((item) => item.canonical), ["provider/cached"]);
	assert.equal(snapshot.error, "network failed");
});

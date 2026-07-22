import { getAgentDir, type ExtensionAPI, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	fuzzyFilter,
	type Focusable,
	Input,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import { type AgentConfig, discoverAgents, findAgentByName } from "./agents.js";
import {
	findAvailableModel,
	getModelAvailability,
	ModelCatalogService,
	type ModelCatalogItem,
	type ModelCatalogSnapshot,
} from "./model-catalog.js";
import {
	formatModelReference,
	getSubagentModelConfigPath,
	loadSubagentModelConfig,
	parseCanonicalModelReference,
	resolveAgentModel,
	setAgentModelOverride,
	type EffectiveAgentConfig,
	type ModelReference,
} from "./model-overrides.js";

const RESET_CHOICE_KEY = "__profile_default__";
const MAX_VISIBLE_MODELS = 10;

export type ModelPickerResult =
	| { kind: "reset" }
	| { kind: "model"; model: ModelCatalogItem };

type PickerChoice =
	| { key: typeof RESET_CHOICE_KEY; kind: "reset" }
	| { key: string; kind: "model"; model: ModelCatalogItem };

type PickerTheme = ExtensionContext["ui"]["theme"];

function modelSearchText(model: ModelCatalogItem): string {
	return `${model.provider} ${model.id} ${model.canonical} ${model.name}`;
}

function normalizeSingleLine(value: string): string {
	return value.replace(/[\r\n]+/g, " ").trim();
}

export class SubagentModelPickerComponent implements Component, Focusable {
	private readonly searchInput = new Input();
	private readonly currentCanonical?: string;
	private readonly profileModel?: string;
	private readonly hasOverride: boolean;
	private readonly keybindings: KeybindingsManager;
	private readonly theme: PickerTheme;
	private readonly onDone: (result: ModelPickerResult | undefined) => void;
	private models: ModelCatalogItem[] = [];
	private choices: PickerChoice[] = [];
	private selectedIndex = 0;
	private status = "Refreshing available models…";
	private disposed = false;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	constructor(options: {
		agent: EffectiveAgentConfig;
		models: ModelCatalogItem[];
		theme: PickerTheme;
		keybindings: KeybindingsManager;
		onDone: (result: ModelPickerResult | undefined) => void;
	}) {
		this.currentCanonical = options.agent.model;
		this.profileModel = options.agent.profileModel;
		this.hasOverride = options.agent.modelSource === "override";
		this.theme = options.theme;
		this.keybindings = options.keybindings;
		this.onDone = options.onDone;
		this.models = this.sortModels(options.models);
		this.rebuildChoices(true);
	}

	private sortModels(models: ModelCatalogItem[]): ModelCatalogItem[] {
		const current = this.currentCanonical?.toLowerCase();
		return [...models].sort((left, right) => {
			const leftCurrent = left.canonical.toLowerCase() === current;
			const rightCurrent = right.canonical.toLowerCase() === current;
			if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
			const providerOrder = left.provider.localeCompare(right.provider);
			return providerOrder !== 0 ? providerOrder : left.id.localeCompare(right.id);
		});
	}

	private getSelectedChoice(): PickerChoice | undefined {
		return this.choices[this.selectedIndex];
	}

	private rebuildChoices(selectCurrent = false): void {
		const previousKey = this.getSelectedChoice()?.key;
		const query = this.searchInput.getValue().trim();
		const filteredModels = query ? fuzzyFilter(this.models, query, modelSearchText) : this.models;
		const resetMatches = !query || ["default", "profile", "reset", "默认", "恢复"].some((term) => term.includes(query.toLowerCase()));
		this.choices = [
			...(resetMatches ? ([{ key: RESET_CHOICE_KEY, kind: "reset" }] as PickerChoice[]) : []),
			...filteredModels.map((model): PickerChoice => ({ key: model.canonical.toLowerCase(), kind: "model", model })),
		];

		let selected = previousKey ? this.choices.findIndex((choice) => choice.key === previousKey) : -1;
		if (selected < 0 && selectCurrent && !this.hasOverride) {
			selected = this.choices.findIndex((choice) => choice.key === RESET_CHOICE_KEY);
		}
		if (selected < 0 && selectCurrent && this.currentCanonical) {
			selected = this.choices.findIndex((choice) => choice.key === this.currentCanonical?.toLowerCase());
		}
		this.selectedIndex = selected >= 0 ? selected : 0;
	}

	setCatalog(snapshot: ModelCatalogSnapshot): void {
		if (this.disposed) return;
		this.models = this.sortModels(snapshot.items);
		this.status = snapshot.error
			? `Refresh warning: ${normalizeSingleLine(snapshot.error)}`
			: "Model catalog refresh completed; cached entries may be retained.";
		this.rebuildChoices(true);
	}

	isDisposed(): boolean {
		return this.disposed;
	}

	dispose(): void {
		this.disposed = true;
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.onDone(undefined);
			return;
		}
		if (this.keybindings.matches(data, "tui.select.up")) {
			if (this.choices.length > 0) {
				this.selectedIndex = this.selectedIndex === 0 ? this.choices.length - 1 : this.selectedIndex - 1;
			}
			return;
		}
		if (this.keybindings.matches(data, "tui.select.down")) {
			if (this.choices.length > 0) {
				this.selectedIndex = this.selectedIndex === this.choices.length - 1 ? 0 : this.selectedIndex + 1;
			}
			return;
		}
		if (this.keybindings.matches(data, "tui.select.confirm")) {
			const selected = this.getSelectedChoice();
			if (selected?.kind === "reset") this.onDone({ kind: "reset" });
			else if (selected?.kind === "model") this.onDone({ kind: "model", model: selected.model });
			return;
		}

		this.searchInput.handleInput(data);
		this.rebuildChoices();
	}

	invalidate(): void {
		this.searchInput.invalidate();
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		const lineWidth = width;
		const fit = (text: string) => truncateToWidth(text, lineWidth, "");
		const lines: string[] = [];
		const border = this.theme.fg("borderAccent", "─".repeat(Math.max(1, lineWidth)));
		lines.push(border);
		lines.push(fit(this.theme.fg("accent", this.theme.bold("Select Subagent Model"))));
		lines.push(
			fit(
				this.theme.fg("muted", "Current: ") +
					this.theme.fg("text", this.currentCanonical ?? "Pi default") +
					(this.profileModel ? this.theme.fg("dim", `  profile:${this.profileModel}`) : ""),
			),
		);
		lines.push("");
		lines.push(fit(this.theme.fg("muted", "Search by provider, model id, or name:")));
		for (const inputLine of this.searchInput.render(Math.max(1, lineWidth - 2))) {
			lines.push(fit(`  ${inputLine}`));
		}
		lines.push("");

		if (this.choices.length === 0) {
			lines.push(fit(this.theme.fg("warning", "  No matching available models")));
		} else {
			const start = Math.max(
				0,
				Math.min(
					this.selectedIndex - Math.floor(MAX_VISIBLE_MODELS / 2),
					this.choices.length - MAX_VISIBLE_MODELS,
				),
			);
			const end = Math.min(start + MAX_VISIBLE_MODELS, this.choices.length);
			for (let index = start; index < end; index++) {
				const choice = this.choices[index];
				const selected = index === this.selectedIndex;
				const prefix = selected ? "→ " : "  ";
				let text: string;
				if (choice.kind === "reset") {
					text = `${prefix}Restore profile default (${this.profileModel ?? "Pi default"})`;
				} else {
					const active = choice.model.canonical.toLowerCase() === this.currentCanonical?.toLowerCase();
					text = `${prefix}${choice.model.id} [${choice.model.provider}]${active ? " ✓" : ""}`;
				}
				lines.push(fit(selected ? this.theme.fg("accent", text) : text));
			}
			if (start > 0 || end < this.choices.length) {
				lines.push(fit(this.theme.fg("dim", `  (${this.selectedIndex + 1}/${this.choices.length})`)));
			}

			const selected = this.getSelectedChoice();
			if (selected?.kind === "model") {
				lines.push("");
				lines.push(fit(this.theme.fg("muted", `  ${selected.model.name}`)));
			}
		}

		lines.push("");
		lines.push(fit(this.theme.fg(this.status.startsWith("Refresh warning") ? "warning" : "dim", this.status)));
		lines.push(fit(this.theme.fg("dim", "↑↓ navigate • enter select • esc cancel • type to search")));
		lines.push(border);
		return lines;
	}
}

function report(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) ctx.ui.notify(message, type);
	else process.stderr.write(`${message}\n`);
}

function formatEffectiveModel(agent: EffectiveAgentConfig): string {
	const suffix = agent.modelSource === "override" ? " (override)" : agent.modelSource === "profile" ? " (profile)" : "";
	return `${agent.model ?? "Pi default"}${suffix}`;
}

async function selectAgent(ctx: ExtensionContext, agents: EffectiveAgentConfig[]): Promise<EffectiveAgentConfig | undefined> {
	if (!ctx.hasUI) return undefined;
	const labels = new Map<string, EffectiveAgentConfig>();
	for (const agent of agents) {
		labels.set(`${agent.name} — ${formatEffectiveModel(agent)}`, agent);
	}
	const selected = await ctx.ui.select("Select subagent", [...labels.keys()]);
	return selected ? labels.get(selected) : undefined;
}

async function selectModel(
	ctx: ExtensionContext,
	catalog: ModelCatalogService,
	agent: EffectiveAgentConfig,
	onCatalog: (items: ModelCatalogItem[]) => void,
): Promise<ModelPickerResult | undefined> {
	if (ctx.mode === "tui") {
		const initial = catalog.getSnapshot(ctx.modelRegistry);
		onCatalog(initial.items);
		return ctx.ui.custom<ModelPickerResult | undefined>((tui, theme, keybindings, done) => {
			const picker = new SubagentModelPickerComponent({
				agent,
				models: initial.items,
				theme,
				keybindings,
				onDone: done,
			});
			void catalog.refresh(ctx.modelRegistry).then((snapshot) => {
				onCatalog(snapshot.items);
				if (picker.isDisposed()) return;
				picker.setCatalog(snapshot);
				tui.requestRender();
			});
			return picker;
		});
	}

	if (ctx.mode === "rpc") {
		const snapshot = await catalog.refresh(ctx.modelRegistry);
		onCatalog(snapshot.items);
		if (snapshot.error) report(ctx, `Model refresh warning: ${normalizeSingleLine(snapshot.error)}`, "warning");
		const options = new Map<string, ModelPickerResult>();
		const current = agent.modelSource === "override"
			? snapshot.items.find((model) => model.canonical.toLowerCase() === agent.model?.toLowerCase())
			: undefined;
		if (current) options.set(`${current.canonical} — ${current.name} (current)`, { kind: "model", model: current });
		options.set(`Restore profile default (${agent.profileModel ?? "Pi default"})`, { kind: "reset" });
		for (const model of snapshot.items) {
			if (model === current) continue;
			options.set(`${model.canonical} — ${model.name}`, { kind: "model", model });
		}
		const selected = await ctx.ui.select(`Select model for ${agent.name}`, [...options.keys()]);
		return selected ? options.get(selected) : undefined;
	}

	return undefined;
}

export interface ParsedSubagentModelArgs {
	agentName?: string;
	model?: string;
}

export function parseSubagentModelArgs(args: string): ParsedSubagentModelArgs | undefined {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return {};
	if (tokens.length > 2) return undefined;
	return { agentName: tokens[0], model: tokens[1] };
}

export interface SubagentModelPickerOptions {
	configPath?: string;
	discoverAgents?: (cwd: string) => AgentConfig[];
}

export function registerSubagentModelPicker(pi: ExtensionAPI, options: SubagentModelPickerOptions = {}): void {
	const catalog = new ModelCatalogService();
	const configPath = options.configPath ?? getSubagentModelConfigPath(getAgentDir());
	const getAgents = options.discoverAgents ?? ((cwd: string) => discoverAgents(cwd, "project").agents);
	let completionModels: ModelCatalogItem[] = [];

	const handle = async (rawArgs: string, ctx: ExtensionContext): Promise<void> => {
		if (!ctx.isIdle()) {
			report(ctx, "Subagent model configuration is available after the current agent run settles.", "warning");
			return;
		}

		const parsed = parseSubagentModelArgs(rawArgs);
		if (!parsed) {
			report(ctx, "Usage: /subagent-model [Agent] [provider/model|reset]", "error");
			return;
		}

		const loaded = loadSubagentModelConfig(configPath);
		if (loaded.error) {
			report(ctx, loaded.error, "error");
			return;
		}
		const baseAgents = getAgents(ctx.cwd);
		const effectiveAgents = baseAgents.map((agent) => resolveAgentModel(agent, loaded.config));
		const agent = parsed.agentName
			? (findAgentByName(effectiveAgents, parsed.agentName) as EffectiveAgentConfig | undefined)
			: await selectAgent(ctx, effectiveAgents);

		if (!agent) {
			if (parsed.agentName) {
				report(ctx, `Unknown subagent "${parsed.agentName}". Available: ${baseAgents.map((item) => item.name).join(", ") || "none"}.`, "error");
			} else if (!ctx.hasUI) {
				report(ctx, "An agent name is required outside TUI/RPC mode.", "error");
			}
			return;
		}

		let choice: ModelPickerResult | undefined;
		if (parsed.model) {
			if (["reset", "default", "profile"].includes(parsed.model.toLowerCase())) {
				choice = { kind: "reset" };
			} else {
				const reference = parseCanonicalModelReference(parsed.model);
				if (!reference) {
					report(ctx, `Invalid model reference "${parsed.model}". Use provider/model.`, "error");
					return;
				}
				const snapshot = await catalog.refresh(ctx.modelRegistry);
				completionModels = snapshot.items;
				const model = findAvailableModel(ctx.modelRegistry, reference);
				if (!model) {
					const status = getModelAvailability(ctx.modelRegistry, reference);
					report(ctx, `Model ${formatModelReference(reference)} is ${status.replace("-", " ")} and cannot be selected.`, "error");
					return;
				}
				choice = { kind: "model", model };
			}
		} else {
			if (!ctx.hasUI) {
				report(ctx, "A model reference or reset is required outside TUI/RPC mode.", "error");
				return;
			}
			choice = await selectModel(ctx, catalog, agent, (items) => {
				completionModels = items;
			});
		}

		if (!choice) return;
		try {
			if (choice.kind === "reset") {
				await setAgentModelOverride(agent, undefined, configPath);
				report(ctx, `${agent.name} restored to ${agent.profileModel ?? "the child Pi default"}.`, "info");
				return;
			}
			const reference: ModelReference = { provider: choice.model.provider, id: choice.model.id };
			await setAgentModelOverride(agent, reference, configPath);
			report(ctx, `${agent.name} will use ${choice.model.canonical} for future runs.`, "info");
		} catch (error) {
			report(ctx, error instanceof Error ? error.message : String(error), "error");
		}
	};

	pi.registerCommand("subagent-model", {
		description: "Select the model used by a subagent",
		getArgumentCompletions: (prefix) => {
			const leadingWhitespace = /^\s/.test(prefix);
			const trimmed = prefix.trimStart();
			const separator = trimmed.indexOf(" ");
			if (separator < 0 && !leadingWhitespace) {
				const agents = getAgents(process.cwd());
				const normalized = trimmed.toLowerCase();
				const items = agents
					.filter((agent) => agent.name.toLowerCase().startsWith(normalized))
					.map((agent) => ({ value: agent.name, label: agent.name, description: agent.description }));
				return items.length > 0 ? items : null;
			}
			const agentName = separator >= 0 ? trimmed.slice(0, separator).trim() : "";
			const modelPrefix = separator >= 0 ? trimmed.slice(separator + 1).trim().toLowerCase() : "";
			const values = ["reset", ...completionModels.map((model) => model.canonical)];
			const items = values
				.filter((value) => value.toLowerCase().startsWith(modelPrefix))
				.map((value) => ({ value: `${agentName} ${value}`.trim(), label: value }));
			return items.length > 0 ? items : null;
		},
		handler: handle,
	});

	pi.registerShortcut("alt+m", {
		description: "Select the model used by a subagent",
		handler: async (ctx) => handle("", ctx),
	});

	pi.on("session_start", (_event, ctx) => {
		// Keep child/headless startup network-free; the picker refreshes on demand.
		completionModels = catalog.getSnapshot(ctx.modelRegistry).items;
	});
}

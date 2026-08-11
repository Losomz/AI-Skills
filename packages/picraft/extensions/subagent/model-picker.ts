import {
	DynamicBorder,
	getAgentDir,
	getSelectListTheme,
	getSettingsListTheme,
	keyText,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Container,
	fuzzyFilter,
	type Focusable,
	Input,
	type SelectItem,
	SelectList,
	type SettingItem,
	SettingsList,
	Spacer,
	Text,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { type AgentConfig, discoverAgents } from "./agents.js";
import {
	getSupportedAgentThinkingLevels,
	ModelCatalogService,
	modelReferencesEqual,
	type ModelCatalogItem,
	type ModelCatalogSnapshot,
} from "./model-catalog.js";
import {
	formatModelReference,
	getAgentModelKey,
	getSubagentModelConfigPath,
	loadSubagentModelConfig,
	modelReferenceFrom,
	parseCanonicalModelReference,
	resolveAgentModel,
	setAgentModelOverrides,
	type AgentModelOverrideUpdate,
	type ModelReference,
	type SubagentModelConfig,
} from "./model-overrides.js";
import type { AgentThinkingLevel } from "./thinking.js";

const DEFAULT_CHOICE_KEY = "__default__";
const MAX_VISIBLE_MODELS = 10;

type PickerTheme = ExtensionContext["ui"]["theme"];

type ModelPickerResult =
	| { kind: "default" }
	| { kind: "model"; model: ModelCatalogItem };

type PickerChoice =
	| { key: typeof DEFAULT_CHOICE_KEY; kind: "default" }
	| { key: string; kind: "model"; model: ModelCatalogItem };

type ThinkingPickerResult =
	| { kind: "default" }
	| { kind: "level"; level: AgentThinkingLevel };

const THINKING_DESCRIPTIONS: Record<AgentThinkingLevel, string> = {
	off: "Disable reasoning",
	minimal: "Very brief reasoning",
	low: "Light reasoning",
	medium: "Moderate reasoning",
	high: "Deep reasoning",
	xhigh: "Extended reasoning",
	max: "Maximum reasoning supported by the model",
};

function modelSearchText(model: ModelCatalogItem): string {
	return `${model.provider} ${model.id} ${model.canonical} ${model.name}`;
}

function normalizeSingleLine(value: string): string {
	return value.replace(/[\r\n]+/g, " ").trim();
}

function optionalReferencesEqual(left: ModelReference | undefined, right: ModelReference | undefined): boolean {
	if (!left || !right) return left === right;
	return modelReferencesEqual(left, right);
}

function cloneReference(model: ModelReference | undefined): ModelReference | undefined {
	return model ? { ...model } : undefined;
}

function defaultModelDescription(agent: AgentConfig, mainModel: ModelReference | undefined): string {
	if (agent.model) return `profile: ${agent.model}`;
	if (mainModel) return `main Agent: ${formatModelReference(mainModel)}`;
	return "child Pi default";
}

function defaultModelValue(agent: AgentConfig, mainModel: ModelReference | undefined): string | undefined {
	return agent.model ?? (mainModel ? formatModelReference(mainModel) : undefined);
}

function defaultThinkingDescription(agent: AgentConfig): string {
	return agent.thinkingLevel ? `profile: ${agent.thinkingLevel}` : "child Pi default";
}

function effectiveModelReference(
	agent: AgentConfig,
	configuredModel: ModelReference | undefined,
	mainModel: ModelReference | undefined,
): ModelReference | undefined {
	if (configuredModel) return configuredModel;
	if (agent.model) return parseCanonicalModelReference(agent.model);
	return cloneReference(mainModel);
}

function findCatalogItem(
	models: readonly ModelCatalogItem[],
	agent: AgentConfig,
	configuredModel: ModelReference | undefined,
	mainModel: ModelReference | undefined,
): ModelCatalogItem | undefined {
	const reference = effectiveModelReference(agent, configuredModel, mainModel);
	return reference ? models.find((item) => modelReferencesEqual(item, reference)) : undefined;
}

function thinkingLabel(level: AgentThinkingLevel): string {
	return level === "xhigh" ? "XHigh" : `${level[0].toUpperCase()}${level.slice(1)}`;
}

function keyName(keybinding: Parameters<typeof keyText>[0], fallback: string): string {
	return keyText(keybinding) || fallback;
}

function hintPart(theme: PickerTheme, keys: string, description: string): string {
	return theme.fg("dim", keys) + theme.fg("muted", ` ${description}`);
}

class SubagentModelPickerComponent implements Component, Focusable {
	private readonly searchInput = new Input();
	private readonly currentCanonical?: string;
	private readonly defaultDescription: string;
	private readonly hasOverride: boolean;
	private readonly keybindings: KeybindingsManager;
	private readonly theme: PickerTheme;
	private readonly agentName: string;
	private readonly onDone: (result: ModelPickerResult | undefined) => void;
	private models: ModelCatalogItem[] = [];
	private choices: PickerChoice[] = [];
	private selectedIndex = 0;
	private status = "Refreshing available models…";
	private statusIsWarning = false;
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
		agent: AgentConfig;
		configuredModel?: ModelReference;
		mainModel?: ModelReference;
		models: ModelCatalogItem[];
		catalogError?: string;
		refreshed: boolean;
		theme: PickerTheme;
		keybindings: KeybindingsManager;
		onDone: (result: ModelPickerResult | undefined) => void;
	}) {
		this.agentName = options.agent.name;
		this.currentCanonical = options.configuredModel
			? formatModelReference(options.configuredModel)
			: defaultModelValue(options.agent, options.mainModel);
		this.defaultDescription = defaultModelDescription(options.agent, options.mainModel);
		this.hasOverride = Boolean(options.configuredModel);
		this.theme = options.theme;
		this.keybindings = options.keybindings;
		this.onDone = options.onDone;
		this.models = this.sortModels(options.models);
		this.updateStatus(options.models.length, options.catalogError, options.refreshed);
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

	private updateStatus(modelCount: number, error: string | undefined, refreshed: boolean): void {
		this.statusIsWarning = Boolean(error);
		this.status = error
			? `Refresh warning: ${normalizeSingleLine(error)}`
			: refreshed
				? `${modelCount} available models`
				: "Refreshing available models…";
	}

	private getSelectedChoice(): PickerChoice | undefined {
		return this.choices[this.selectedIndex];
	}

	private rebuildChoices(selectCurrent = false): void {
		const previousKey = this.getSelectedChoice()?.key;
		const query = this.searchInput.getValue().trim();
		const filteredModels = query ? fuzzyFilter(this.models, query, modelSearchText) : this.models;
		const normalizedQuery = query.toLowerCase();
		const defaultMatches = !query || ["default", "main", "profile", "默认", "恢复"].some((term) => term.includes(normalizedQuery));
		this.choices = [
			...(defaultMatches ? ([{ key: DEFAULT_CHOICE_KEY, kind: "default" }] as PickerChoice[]) : []),
			...filteredModels.map((model): PickerChoice => ({ key: model.canonical.toLowerCase(), kind: "model", model })),
		];

		let selected = previousKey ? this.choices.findIndex((choice) => choice.key === previousKey) : -1;
		if (selected < 0 && selectCurrent && !this.hasOverride) {
			selected = this.choices.findIndex((choice) => choice.key === DEFAULT_CHOICE_KEY);
		}
		if (selected < 0 && selectCurrent && this.currentCanonical) {
			selected = this.choices.findIndex((choice) => choice.key === this.currentCanonical?.toLowerCase());
		}
		this.selectedIndex = selected >= 0 ? selected : 0;
	}

	setCatalog(snapshot: ModelCatalogSnapshot): void {
		if (this.disposed) return;
		this.models = this.sortModels(snapshot.items);
		this.updateStatus(snapshot.items.length, snapshot.error, snapshot.refreshed);
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
			if (selected?.kind === "default") this.onDone({ kind: "default" });
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
		const fit = (text: string) => truncateToWidth(text, width, "");
		const lines: string[] = [];
		lines.push(fit(this.theme.fg("accent", this.theme.bold(`Model · ${this.agentName}`))));
		lines.push(
			fit(
				this.theme.fg("muted", "Current: ") +
					this.theme.fg("text", this.currentCanonical ?? "child Pi default") +
					(this.hasOverride ? this.theme.fg("warning", "  configured") : this.theme.fg("dim", "  default")),
			),
		);
		lines.push(fit(this.theme.fg("muted", `Default: ${this.defaultDescription}`)));
		lines.push("");
		lines.push(fit(this.theme.fg("muted", "Search by provider, model id, or name:")));
		for (const inputLine of this.searchInput.render(Math.max(1, width - 2))) {
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
				if (choice.kind === "default") {
					text = `${prefix}Default (${this.defaultDescription})${this.hasOverride ? "" : " ✓"}`;
				} else {
					const active = this.hasOverride && choice.model.canonical.toLowerCase() === this.currentCanonical?.toLowerCase();
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
		lines.push(fit(this.theme.fg(this.statusIsWarning ? "warning" : "dim", this.status)));
		const navigation = `${keyName("tui.select.up", "up")}/${keyName("tui.select.down", "down")}`;
		const footer = [
			hintPart(this.theme, navigation, "navigate"),
			hintPart(this.theme, keyName("tui.select.confirm", "enter"), "select"),
			hintPart(this.theme, keyName("tui.select.cancel", "esc"), "back"),
			this.theme.fg("muted", "type to search"),
		].join(this.theme.fg("dim", " · "));
		lines.push(...wrapTextWithAnsi(footer, width));
		return lines;
	}
}

class SubagentThinkingPickerComponent extends Container {
	private selectList!: SelectList;
	private readonly agent: AgentConfig;
	private readonly configuredLevel?: AgentThinkingLevel;
	private readonly theme: PickerTheme;
	private readonly onDone: (result: ThinkingPickerResult | undefined) => void;

	constructor(options: {
		agent: AgentConfig;
		configuredLevel?: AgentThinkingLevel;
		availableLevels: AgentThinkingLevel[];
		theme: PickerTheme;
		onDone: (result: ThinkingPickerResult | undefined) => void;
	}) {
		super();
		this.agent = options.agent;
		this.configuredLevel = options.configuredLevel;
		this.theme = options.theme;
		this.onDone = options.onDone;
		this.rebuild(options.availableLevels);
	}

	private rebuild(availableLevels: AgentThinkingLevel[]): void {
		const selectedValue = this.selectList?.getSelectedItem()?.value
			?? this.configuredLevel
			?? DEFAULT_CHOICE_KEY;
		const items: SelectItem[] = [
			{
				value: DEFAULT_CHOICE_KEY,
				label: "Default",
				description: `Use ${defaultThinkingDescription(this.agent)}`,
			},
			...availableLevels.map((level) => ({
				value: level,
				label: thinkingLabel(level),
				description: THINKING_DESCRIPTIONS[level],
			})),
		];
		this.clear();
		this.addChild(new DynamicBorder((text: string) => this.theme.fg("accent", text)));
		this.addChild(new Spacer(1));
		this.addChild(new Text(this.theme.fg("accent", this.theme.bold(`Thinking · ${this.agent.name}`)), 0, 0));
		this.addChild(new Text(this.theme.fg("muted", `Default: ${defaultThinkingDescription(this.agent)}`), 0, 0));
		this.addChild(new Spacer(1));
		this.selectList = new SelectList(items, Math.min(items.length, 9), getSelectListTheme());
		const selectedIndex = items.findIndex((item) => item.value === selectedValue);
		this.selectList.setSelectedIndex(selectedIndex >= 0 ? selectedIndex : 0);
		this.selectList.onSelect = (item) => {
			if (item.value === DEFAULT_CHOICE_KEY) this.onDone({ kind: "default" });
			else this.onDone({ kind: "level", level: item.value as AgentThinkingLevel });
		};
		this.selectList.onCancel = () => this.onDone(undefined);
		this.addChild(this.selectList);
		this.addChild(new Spacer(1));
		const footer = [
			hintPart(this.theme, keyName("tui.select.confirm", "enter"), "select"),
			hintPart(this.theme, keyName("tui.select.cancel", "esc"), "back"),
		].join(this.theme.fg("dim", " · "));
		this.addChild(new Text(footer, 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder((text: string) => this.theme.fg("accent", text)));
	}

	setAvailableLevels(availableLevels: AgentThinkingLevel[]): void {
		this.rebuild(availableLevels);
	}

	handleInput(data: string): void {
		this.selectList.handleInput(data);
	}
}

class SubagentAgentSettingsComponent extends Container {
	private readonly settingsList: SettingsList;

	constructor(options: {
		agent: AgentConfig;
		modelValue: string;
		thinkingValue: string;
		theme: PickerTheme;
		createModelPicker: (done: (selectedValue?: string) => void) => Component;
		createThinkingPicker: (done: (selectedValue?: string) => void) => Component;
		getThinkingValue: () => string;
		onClose: () => void;
	}) {
		super();
		const items: SettingItem[] = [
			{
				id: "model",
				label: "Model",
				description: "Model used by this subagent",
				currentValue: options.modelValue,
				submenu: (_currentValue, done) => options.createModelPicker((selectedValue) => {
					this.settingsList.updateValue("thinking", options.getThinkingValue());
					done(selectedValue);
				}),
			},
			{
				id: "thinking",
				label: "Thinking",
				description: "Default uses the agent profile or child Pi configuration",
				currentValue: options.thinkingValue,
				submenu: (_currentValue, done) => options.createThinkingPicker(done),
			},
		];
		this.settingsList = new SettingsList(
			items,
			items.length,
			getSettingsListTheme(),
			() => undefined,
			options.onClose,
		);
		this.addChild(new DynamicBorder((text: string) => options.theme.fg("accent", text)));
		this.addChild(new Spacer(1));
		this.addChild(new Text(options.theme.fg("accent", options.theme.bold(`Agent · ${options.agent.name}`)), 0, 0));
		this.addChild(new Text(options.theme.fg("muted", options.agent.description), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(this.settingsList);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder((text: string) => options.theme.fg("accent", text)));
	}

	handleInput(data: string): void {
		this.settingsList.handleInput(data);
	}
}

function report(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) ctx.ui.notify(message, type);
	else process.stderr.write(`${message}\n`);
}

class SubagentConfigurationPanel implements Component, Focusable {
	private readonly container = new Container();
	private readonly titleText: Text;
	private readonly defaultText: Text;
	private readonly catalogText: Text;
	private readonly footerText: Text;
	private readonly settingsList: SettingsList;
	private readonly agents: AgentConfig[];
	private readonly mainModel?: ModelReference;
	private readonly theme: PickerTheme;
	private readonly keybindings: KeybindingsManager;
	private readonly requestRender: () => void;
	private readonly onPersist: (updates: AgentModelOverrideUpdate[]) => Promise<SubagentModelConfig>;
	private readonly onClose: () => void;
	private readonly persisted = new Map<string, ModelReference | undefined>();
	private readonly staged = new Map<string, ModelReference | undefined>();
	private readonly persistedThinking = new Map<string, AgentThinkingLevel | undefined>();
	private readonly stagedThinking = new Map<string, AgentThinkingLevel | undefined>();
	private models: ModelCatalogItem[];
	private activePicker?: SubagentModelPickerComponent;
	private activeThinkingPicker?: SubagentThinkingPickerComponent;
	private activeThinkingAgent?: AgentConfig;
	private catalogError?: string;
	private catalogRefreshed: boolean;
	private saving = false;
	private saveStatus?: { type: "info" | "success" | "error"; message: string };
	private disposed = false;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		if (this.activePicker) this.activePicker.focused = value;
	}

	constructor(options: {
		agents: AgentConfig[];
		config: SubagentModelConfig;
		mainModel?: ModelReference;
		catalog: ModelCatalogSnapshot;
		theme: PickerTheme;
		keybindings: KeybindingsManager;
		requestRender: () => void;
		onPersist: (updates: AgentModelOverrideUpdate[]) => Promise<SubagentModelConfig>;
		onClose: () => void;
	}) {
		this.agents = options.agents;
		this.mainModel = cloneReference(options.mainModel);
		this.models = options.catalog.items;
		this.catalogError = options.catalog.error;
		this.catalogRefreshed = options.catalog.refreshed;
		this.theme = options.theme;
		this.keybindings = options.keybindings;
		this.requestRender = options.requestRender;
		this.onPersist = options.onPersist;
		this.onClose = options.onClose;

		for (const agent of this.agents) {
			const key = getAgentModelKey(agent);
			const override = options.config.overrides[key];
			const configured = cloneReference(override?.model);
			this.persisted.set(key, configured);
			this.staged.set(key, cloneReference(configured));
			this.persistedThinking.set(key, override?.thinkingLevel);
			this.stagedThinking.set(key, override?.thinkingLevel);
		}

		const items: SettingItem[] = this.agents.map((agent) => ({
			id: getAgentModelKey(agent),
			label: agent.name,
			description: agent.description,
			currentValue: this.formatAgentValue(agent),
			submenu: (_currentValue, done) => this.createAgentSettings(agent, done),
		}));

		this.titleText = new Text("", 0, 0);
		this.defaultText = new Text("", 0, 0);
		this.catalogText = new Text("", 0, 0);
		this.footerText = new Text("", 0, 0);
		this.settingsList = new SettingsList(
			items,
			Math.min(Math.max(items.length, 1), 10),
			getSettingsListTheme(),
			() => undefined,
			() => {
				if (this.saving) {
					this.saveStatus = { type: "info", message: "Wait for the current save to finish" };
					this.updateFooter();
					this.requestRender();
					return;
				}
				this.dispose();
				this.onClose();
			},
		);

		this.container.addChild(new DynamicBorder((text: string) => this.theme.fg("accent", text)));
		this.container.addChild(new Spacer(1));
		this.container.addChild(this.titleText);
		this.container.addChild(this.defaultText);
		this.container.addChild(this.catalogText);
		this.container.addChild(new Spacer(1));
		this.container.addChild(this.settingsList);
		this.container.addChild(new Spacer(1));
		this.container.addChild(this.footerText);
		this.container.addChild(new Spacer(1));
		this.container.addChild(new DynamicBorder((text: string) => this.theme.fg("accent", text)));
		this.updateStaticText();
		this.updateFooter();
	}

	private createAgentSettings(agent: AgentConfig, done: (selectedValue?: string) => void): Component {
		return new SubagentAgentSettingsComponent({
			agent,
			modelValue: this.formatModelValue(agent),
			thinkingValue: this.formatThinkingValue(agent),
			theme: this.theme,
			createModelPicker: (pickerDone) => this.createModelPicker(agent, pickerDone),
			createThinkingPicker: (pickerDone) => this.createThinkingPicker(agent, pickerDone),
			getThinkingValue: () => this.formatThinkingValue(agent),
			onClose: () => done(this.formatAgentValue(agent)),
		});
	}

	private createModelPicker(agent: AgentConfig, done: (selectedValue?: string) => void): Component {
		const key = getAgentModelKey(agent);
		const picker = new SubagentModelPickerComponent({
			agent,
			configuredModel: this.staged.get(key),
			mainModel: this.mainModel,
			models: this.models,
			catalogError: this.catalogError,
			refreshed: this.catalogRefreshed,
			theme: this.theme,
			keybindings: this.keybindings,
			onDone: (result) => {
				this.activePicker = undefined;
				if (!result) {
					done();
					this.requestRender();
					return;
				}
				const model = result.kind === "model"
					? { provider: result.model.provider, id: result.model.id }
					: undefined;
				this.stageModel(agent, model);
				done(this.formatModelValue(agent));
				this.requestRender();
			},
		});
		picker.focused = this._focused;
		this.activePicker = picker;
		return picker;
	}

	private createThinkingPicker(agent: AgentConfig, done: (selectedValue?: string) => void): Component {
		const key = getAgentModelKey(agent);
		const picker = new SubagentThinkingPickerComponent({
			agent,
			configuredLevel: this.stagedThinking.get(key),
			availableLevels: this.getSupportedThinkingLevels(agent),
			theme: this.theme,
			onDone: (result) => {
				this.activeThinkingPicker = undefined;
				this.activeThinkingAgent = undefined;
				if (!result) {
					done();
					this.requestRender();
					return;
				}
				this.stageThinking(agent, result.kind === "level" ? result.level : undefined);
				done(this.formatThinkingValue(agent));
				this.requestRender();
			},
		});
		this.activeThinkingPicker = picker;
		this.activeThinkingAgent = agent;
		return picker;
	}

	private formatModelValue(agent: AgentConfig): string {
		const configured = this.staged.get(getAgentModelKey(agent));
		return configured
			? formatModelReference(configured)
			: `Default · ${defaultModelDescription(agent, this.mainModel)}`;
	}

	private formatThinkingValue(agent: AgentConfig): string {
		const configured = this.stagedThinking.get(getAgentModelKey(agent));
		return configured ? thinkingLabel(configured) : `Default · ${defaultThinkingDescription(agent)}`;
	}

	private formatAgentValue(agent: AgentConfig): string {
		return `${this.formatModelValue(agent)} · thinking: ${this.formatThinkingValue(agent)}`;
	}

	private getSupportedThinkingLevels(agent: AgentConfig): AgentThinkingLevel[] {
		const key = getAgentModelKey(agent);
		const item = findCatalogItem(this.models, agent, this.staged.get(key), this.mainModel);
		return getSupportedAgentThinkingLevels(item?.model);
	}

	private stageModel(agent: AgentConfig, model: ModelReference | undefined): void {
		const key = getAgentModelKey(agent);
		this.staged.set(key, cloneReference(model));
		const configuredThinking = this.stagedThinking.get(key);
		if (configuredThinking && !this.getSupportedThinkingLevels(agent).includes(configuredThinking)) {
			this.stagedThinking.set(key, undefined);
			this.saveStatus = { type: "info", message: `${agent.name} thinking reset to Default for the selected model` };
		} else {
			this.saveStatus = undefined;
		}
		this.updateFooter();
	}

	private stageThinking(agent: AgentConfig, thinkingLevel: AgentThinkingLevel | undefined): void {
		this.stagedThinking.set(getAgentModelKey(agent), thinkingLevel);
		this.saveStatus = undefined;
		this.updateFooter();
	}

	private isDirty(): boolean {
		return this.agents.some((agent) => {
			const key = getAgentModelKey(agent);
			return !optionalReferencesEqual(this.persisted.get(key), this.staged.get(key))
				|| this.persistedThinking.get(key) !== this.stagedThinking.get(key);
		});
	}

	private changedUpdates(): AgentModelOverrideUpdate[] {
		const updates: AgentModelOverrideUpdate[] = [];
		for (const agent of this.agents) {
			const key = getAgentModelKey(agent);
			const persistedModel = this.persisted.get(key);
			const stagedModel = this.staged.get(key);
			const persistedThinking = this.persistedThinking.get(key);
			const stagedThinking = this.stagedThinking.get(key);
			if (!optionalReferencesEqual(persistedModel, stagedModel) || persistedThinking !== stagedThinking) {
				updates.push({
					agent,
					model: cloneReference(stagedModel),
					thinkingLevel: stagedThinking,
				});
			}
		}
		return updates;
	}

	private async save(): Promise<void> {
		if (this.saving || this.disposed) return;
		const updates = this.changedUpdates();
		if (updates.length === 0) {
			this.saveStatus = { type: "info", message: "No changes to save" };
			this.updateFooter();
			this.requestRender();
			return;
		}

		this.saving = true;
		this.saveStatus = { type: "info", message: "saving…" };
		this.updateFooter();
		this.requestRender();
		try {
			const saved = await this.onPersist(updates);
			for (const agent of this.agents) {
				const key = getAgentModelKey(agent);
				this.persisted.set(key, cloneReference(saved.overrides[key]?.model));
				this.persistedThinking.set(key, saved.overrides[key]?.thinkingLevel);
			}
			this.saveStatus = { type: "success", message: "saved" };
		} catch (error) {
			this.saveStatus = {
				type: "error",
				message: error instanceof Error ? error.message : String(error),
			};
		} finally {
			this.saving = false;
			if (!this.disposed) {
				this.updateFooter();
				this.requestRender();
			}
		}
	}

	private updateStaticText(): void {
		this.titleText.setText(this.theme.fg("accent", this.theme.bold("Subagent Configuration")));
		this.defaultText.setText(
			this.theme.fg(
				"muted",
				[
					`Model Default uses ${this.mainModel ? `the main Agent model (${formatModelReference(this.mainModel)})` : "the child Pi default model"}.`,
					"Thinking Default uses the agent profile or child Pi configuration; Off explicitly disables reasoning.",
				].join("\n"),
			),
		);
		this.catalogText.setText(
			this.catalogError
				? this.theme.fg("warning", `Model refresh warning: ${normalizeSingleLine(this.catalogError)}`)
				: this.theme.fg(
						"dim",
						this.catalogRefreshed ? `${this.models.length} available models` : "Refreshing available models…",
					),
		);
	}

	private updateFooter(): void {
		const navigation = `${keyName("tui.select.up", "up")}/${keyName("tui.select.down", "down")}`;
		const base = [
			hintPart(this.theme, navigation, "navigate"),
			hintPart(this.theme, `${keyName("tui.select.confirm", "enter")}/space`, "configure"),
			hintPart(this.theme, keyName("app.models.save", "ctrl+s"), "save"),
			hintPart(this.theme, keyName("tui.select.cancel", "esc"), "close"),
		].join(this.theme.fg("dim", " · "));

		let status = "";
		if (this.saveStatus) {
			const color = this.saveStatus.type === "error"
				? "error"
				: this.saveStatus.type === "success"
					? "success"
					: "muted";
			status = this.theme.fg(color, ` · ${this.saveStatus.message}`);
		}
		if (this.isDirty() && !this.saving) {
			status += this.theme.fg("warning", " · (unsaved)");
		}
		this.footerText.setText(base + status);
	}

	setCatalog(snapshot: ModelCatalogSnapshot): void {
		if (this.disposed) return;
		this.models = snapshot.items;
		this.catalogError = snapshot.error;
		this.catalogRefreshed = snapshot.refreshed;
		this.activePicker?.setCatalog(snapshot);
		if (this.activeThinkingPicker && this.activeThinkingAgent) {
			this.activeThinkingPicker.setAvailableLevels(this.getSupportedThinkingLevels(this.activeThinkingAgent));
		}
		this.updateStaticText();
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "app.models.save")) {
			void this.save();
			return;
		}
		this.settingsList.handleInput(data);
		this.requestRender();
	}

	render(width: number): string[] {
		return this.container.render(width);
	}

	invalidate(): void {
		this.container.invalidate();
		this.updateStaticText();
		this.updateFooter();
	}

	isDisposed(): boolean {
		return this.disposed;
	}

	dispose(): void {
		this.disposed = true;
		this.activePicker?.dispose();
	}
}

async function configureRpc(
	ctx: ExtensionContext,
	catalog: ModelCatalogService,
	agents: AgentConfig[],
	config: SubagentModelConfig,
	mainModel: ModelReference | undefined,
	configPath: string,
): Promise<void> {
	const labels = new Map<string, AgentConfig>();
	for (const agent of agents) {
		const effective = resolveAgentModel(agent, config, mainModel);
		const thinking = effective.thinkingLevel ? thinkingLabel(effective.thinkingLevel) : "Default";
		labels.set(
			`${agent.name} — ${effective.model ?? "child Pi default"} · thinking: ${thinking}`,
			agent,
		);
	}
	const selectedAgentLabel = await ctx.ui.select("Configure subagent", [...labels.keys()]);
	const agent = selectedAgentLabel ? labels.get(selectedAgentLabel) : undefined;
	if (!agent) return;

	const snapshot = await catalog.refresh(ctx.modelRegistry);
	if (snapshot.error) report(ctx, `Model refresh warning: ${normalizeSingleLine(snapshot.error)}`, "warning");
	const modelChoices = new Map<string, ModelPickerResult>();
	modelChoices.set(`Default — ${defaultModelDescription(agent, mainModel)}`, { kind: "default" });
	for (const item of snapshot.items) {
		modelChoices.set(`${item.canonical} — ${item.name}`, { kind: "model", model: item });
	}
	const selectedModelLabel = await ctx.ui.select(`Model for ${agent.name}`, [...modelChoices.keys()]);
	const modelChoice = selectedModelLabel ? modelChoices.get(selectedModelLabel) : undefined;
	if (!modelChoice) return;
	const model = modelChoice.kind === "model"
		? { provider: modelChoice.model.provider, id: modelChoice.model.id }
		: undefined;
	const selectedCatalogItem = modelChoice.kind === "model"
		? modelChoice.model
		: findCatalogItem(snapshot.items, agent, undefined, mainModel);

	const thinkingChoices = new Map<string, ThinkingPickerResult>();
	thinkingChoices.set(`Default — ${defaultThinkingDescription(agent)}`, { kind: "default" });
	for (const level of getSupportedAgentThinkingLevels(selectedCatalogItem?.model)) {
		thinkingChoices.set(`${thinkingLabel(level)} — ${THINKING_DESCRIPTIONS[level]}`, { kind: "level", level });
	}
	const selectedThinkingLabel = await ctx.ui.select(`Thinking for ${agent.name}`, [...thinkingChoices.keys()]);
	const thinkingChoice = selectedThinkingLabel ? thinkingChoices.get(selectedThinkingLabel) : undefined;
	if (!thinkingChoice) return;
	const thinkingLevel = thinkingChoice.kind === "level" ? thinkingChoice.level : undefined;

	const confirmation = await ctx.ui.select("Save subagent configuration?", ["Save", "Cancel"]);
	if (confirmation !== "Save") return;
	await setAgentModelOverrides([{ agent, model, thinkingLevel }], configPath);
	const modelSummary = model ? formatModelReference(model) : `Default (${defaultModelDescription(agent, mainModel)})`;
	const thinkingSummary = thinkingLevel ? thinkingLabel(thinkingLevel) : `Default (${defaultThinkingDescription(agent)})`;
	report(ctx, `${agent.name} saved with model ${modelSummary} and thinking ${thinkingSummary}.`, "info");
}

export interface SubagentConfigurationOptions {
	configPath?: string;
	discoverAgents?: (cwd: string) => AgentConfig[];
}

export function registerSubagentConfiguration(pi: ExtensionAPI, options: SubagentConfigurationOptions = {}): void {
	const catalog = new ModelCatalogService();
	const configPath = options.configPath ?? getSubagentModelConfigPath(getAgentDir());
	const getAgents = options.discoverAgents ?? ((cwd: string) => discoverAgents(cwd, "project").agents);

	const handle = async (rawArgs: string, ctx: ExtensionContext): Promise<void> => {
		if (!ctx.isIdle()) {
			report(ctx, "Subagent configuration is available after the current agent run settles.", "warning");
			return;
		}
		if (rawArgs.trim()) {
			report(ctx, "Usage: /subagent", "error");
			return;
		}

		const loaded = loadSubagentModelConfig(configPath);
		if (loaded.error) {
			report(ctx, loaded.error, "error");
			return;
		}
		const agents = getAgents(ctx.cwd);
		if (agents.length === 0) {
			report(ctx, "No bundled subagents are available.", "warning");
			return;
		}
		const mainModel = modelReferenceFrom(ctx.model);

		if (ctx.mode === "tui") {
			const initial = catalog.getSnapshot(ctx.modelRegistry);
			await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
				const panel = new SubagentConfigurationPanel({
					agents,
					config: loaded.config,
					mainModel,
					catalog: initial,
					theme,
					keybindings,
					requestRender: () => tui.requestRender(),
					onPersist: (updates) => setAgentModelOverrides(updates, configPath),
					onClose: () => done(undefined),
				});
				void catalog.refresh(ctx.modelRegistry).then(
					(snapshot) => {
						if (panel.isDisposed()) return;
						panel.setCatalog(snapshot);
						tui.requestRender();
					},
					(error) => {
						if (panel.isDisposed()) return;
						panel.setCatalog({
							items: initial.items,
							error: error instanceof Error ? error.message : String(error),
							refreshed: true,
						});
						tui.requestRender();
					},
				);
				return panel;
			});
			return;
		}

		if (ctx.mode === "rpc") {
			try {
				await configureRpc(ctx, catalog, agents, loaded.config, mainModel, configPath);
			} catch (error) {
				report(ctx, error instanceof Error ? error.message : String(error), "error");
			}
			return;
		}

		report(ctx, "/subagent configuration requires TUI or RPC mode.", "error");
	};

	pi.registerCommand("subagent", {
		description: "Configure subagent models and thinking",
		handler: handle,
	});

	pi.registerShortcut("alt+m", {
		description: "Configure subagent models and thinking",
		handler: async (ctx) => handle("", ctx),
	});
}

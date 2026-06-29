import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

interface InitTemplate {
	name: string;
	filePath: string;
	content: string;
}

const DEFAULT_CHOICE = "default";
const NO_FOCUS = "No additional user focus or constraints were provided.";

function getExtensionDir(): string {
	return path.dirname(fileURLToPath(import.meta.url));
}

function readMarkdown(filePath: string): string | undefined {
	try {
		const content = fs.readFileSync(filePath, "utf-8").trim();
		return content || undefined;
	} catch {
		return undefined;
	}
}

function loadBasePrompt(): string | undefined {
	return readMarkdown(path.join(getExtensionDir(), "base.md"));
}

function loadTemplates(): InitTemplate[] {
	const templatesDir = path.join(getExtensionDir(), "templates");
	if (!fs.existsSync(templatesDir)) return [];

	const entries = fs
		.readdirSync(templatesDir, { withFileTypes: true })
		.filter((entry) => entry.isFile() || entry.isSymbolicLink())
		.filter((entry) => entry.name.toLowerCase().endsWith(".md"))
		.sort((a, b) => a.name.localeCompare(b.name));

	const templates: InitTemplate[] = [];
	for (const entry of entries) {
		const filePath = path.join(templatesDir, entry.name);
		const content = readMarkdown(filePath);
		if (!content) continue;
		templates.push({ name: path.basename(entry.name, ".md"), filePath, content });
	}
	return templates;
}

function normalizeTemplateName(name: string): string {
	return name.trim().toLowerCase().replace(/\.md$/, "");
}

function findTemplate(templates: InitTemplate[], name: string): InitTemplate | undefined {
	const normalized = normalizeTemplateName(name);
	return templates.find((template) => normalizeTemplateName(template.name) === normalized);
}

function parseArgs(args: string, templates: InitTemplate[]): { selectedTemplate?: InitTemplate | null; focusSeed: string } {
	const trimmed = args.trim();
	if (!trimmed) return { focusSeed: "" };

	const parts = trimmed.split(/\s+/);
	const first = parts[0] ?? "";
	if (normalizeTemplateName(first) === "default") {
		return { selectedTemplate: null, focusSeed: parts.slice(1).join(" ") };
	}

	const template = findTemplate(templates, first);
	if (template) {
		return { selectedTemplate: template, focusSeed: parts.slice(1).join(" ") };
	}

	return { focusSeed: trimmed };
}

async function selectTemplate(ctx: ExtensionCommandContext, templates: InitTemplate[]): Promise<InitTemplate | null | undefined> {
	if (!ctx.hasUI || templates.length === 0) return null;

	const choice = await ctx.ui.select("Optional init template", [DEFAULT_CHOICE, ...templates.map((template) => template.name)]);
	if (!choice) return undefined;
	if (choice === DEFAULT_CHOICE) return null;
	return findTemplate(templates, choice) ?? null;
}

async function collectFocus(ctx: ExtensionCommandContext, focusSeed: string): Promise<string | undefined> {
	if (!ctx.hasUI) return focusSeed.trim() || NO_FOCUS;

	const result = await ctx.ui.editor("Init focus / constraints (optional)", focusSeed);
	if (result === undefined) return undefined;
	return result.trim() || NO_FOCUS;
}

function renderOptionalTemplate(template: InitTemplate | null): string {
	if (!template) {
		return "No optional initialization template was selected. The base initialization instructions are still included.";
	}

	return [`## Template: ${template.name}.md`, `Source: ${template.filePath}`, "", template.content].join("\n");
}

function buildHiddenPrompt(basePrompt: string, template: InitTemplate | null, focus: string, ctx: ExtensionCommandContext): string {
	return `Create or update AGENTS.md for this repository.

Current repository path:
${ctx.cwd}

User-provided focus or constraints:
${focus}

${basePrompt}

# Optional initialization template

${renderOptionalTemplate(template)}
`;
}

function buildVisiblePrompt(template: InitTemplate | null, focus: string): string {
	const templateName = template?.name ?? DEFAULT_CHOICE;
	return `Create or update AGENTS.md for this repository.

Init template: ${templateName}
Focus: ${focus}

Detailed initialization instructions were injected as hidden context.`;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("init", {
		description: "Create or update AGENTS.md using base instructions plus an optional template",
		getArgumentCompletions: (prefix: string) => {
			const templates = loadTemplates();
			const normalizedPrefix = normalizeTemplateName(prefix);
			const items = [
				{ value: "default", label: DEFAULT_CHOICE, description: "Do not add an optional template; init/base.md is always included" },
				...templates.map((template) => ({
					value: template.name,
					label: template.name,
					description: `Add ${path.basename(template.filePath)}; init/base.md is always included`,
				})),
			];
			const filtered = items.filter((item) => normalizeTemplateName(item.value).startsWith(normalizedPrefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const basePrompt = loadBasePrompt();
			if (!basePrompt) {
				ctx.ui.notify("Init base prompt not found: init/base.md", "error");
				return;
			}

			const templates = loadTemplates();
			const parsed = parseArgs(args, templates);
			const selectedTemplate = parsed.selectedTemplate === undefined ? await selectTemplate(ctx, templates) : parsed.selectedTemplate;
			if (selectedTemplate === undefined) {
				ctx.ui.notify("Init cancelled", "info");
				return;
			}

			const focus = await collectFocus(ctx, parsed.focusSeed);
			if (focus === undefined) {
				ctx.ui.notify("Init cancelled", "info");
				return;
			}

			const hiddenPrompt = buildHiddenPrompt(basePrompt, selectedTemplate, focus, ctx);
			pi.sendMessage({
				customType: "init",
				content: hiddenPrompt,
				display: false,
				details: { template: selectedTemplate?.name ?? "default", cwd: ctx.cwd },
			});
			pi.sendUserMessage(buildVisiblePrompt(selectedTemplate, focus));
		},
	});
}

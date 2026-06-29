import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

interface InitTemplate {
	name: string;
	filePath: string;
	content: string;
}

function getExtensionDir(): string {
	return path.dirname(fileURLToPath(import.meta.url));
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
		try {
			const content = fs.readFileSync(filePath, "utf-8").trim();
			if (!content) continue;
			templates.push({ name: entry.name, filePath, content });
		} catch {
			continue;
		}
	}
	return templates;
}

function renderTemplates(templates: InitTemplate[]): string {
	if (templates.length === 0) {
		return "No initialization templates were found. Use the base OpenCode-style initialization rules only.";
	}

	return templates
		.map((template) => [`## Template: ${template.name}`, `Source: ${template.filePath}`, "", template.content].join("\n"))
		.join("\n\n---\n\n");
}

function buildInitPrompt(args: string, ctx: ExtensionCommandContext, templates: InitTemplate[]): string {
	const focus = args.trim() || "No additional user focus or constraints were provided.";
	const templateText = renderTemplates(templates);

	return `Create or update AGENTS.md for this repository.

Current repository path:
${ctx.cwd}

User-provided focus or constraints:
${focus}

# Goal

Create a compact, coherent, high-signal AGENTS.md that helps future coding agents work correctly in this repository. Every line should answer: "Would an agent likely miss this without help?" If not, leave it out.

This initialization is based on OpenCode-style repository initialization, with one additional capability: initialization templates. The templates below are source material and checklists only. They may have been extracted from other projects after removing project-specific details.

# Critical Template Rules

- Do not paste template text directly into AGENTS.md.
- First extract reusable guidance and categories from the templates.
- Then inspect this repository and verify which template ideas actually apply.
- Rewrite relevant, verified information into a clean project-specific AGENTS.md.
- Remove project names, commands, paths, architecture names, and conventions from templates unless you verify them in this repository.
- If a template idea is not relevant or cannot be verified, omit it.
- Organize the final AGENTS.md by topic, not by template file.

# How to investigate

Read the highest-value sources first:

- README*, root manifests, workspace config, lockfiles
- build, test, lint, formatter, typecheck, and codegen config
- CI workflows and pre-commit / task runner config
- existing instruction files: AGENTS.md, CLAUDE.md, .cursor/rules/, .cursorrules, .github/copilot-instructions.md
- repo-local Pi/OpenCode/Codex configuration where present

If architecture is still unclear after reading config and docs, inspect a small number of representative code files to find real entrypoints, package boundaries, and execution flow. Prefer files that explain how the system is wired together over random leaf files.

Prefer executable sources of truth over prose. If docs conflict with config or scripts, trust the executable source and only keep what you can verify.

# What to extract

Look for high-signal, repository-specific facts:

- exact developer commands, especially non-obvious ones
- how to run one test, one package, or a focused verification step
- required command order when it matters, such as lint -> typecheck -> test
- monorepo or multi-package boundaries, ownership of major directories, and real app/library entrypoints
- generated code, migrations, assets, codegen, build artifacts, env loading, dev servers, infra or deploy quirks
- repo-specific style or workflow conventions that differ from defaults
- testing quirks: fixtures, integration prerequisites, snapshots, required services, flaky or expensive suites
- important constraints from existing instruction files worth preserving

# Final AGENTS.md shape

Use short sections and bullets. Start with top-priority project rules if there are any. Then use only sections that are relevant, for example:

- Project Structure
- Commands
- Testing
- Type Checking / Linting
- Generated Code / Assets / Migrations
- Style Guide
- Workflow / Git / PR
- Architecture Notes
- Agent Notes

Do not force every section. If the repo is simple, keep AGENTS.md simple. If the repo is large, summarize only structural facts that change how an agent should work.

# Writing rules

Include only high-signal, repo-specific guidance such as:

- exact commands and shortcuts the agent would otherwise guess wrong
- architecture notes that are not obvious from filenames
- conventions that differ from language or framework defaults
- setup requirements, environment quirks, and operational gotchas
- references to existing instruction sources that matter

Exclude:

- generic software advice
- long tutorials or exhaustive file trees
- obvious language conventions
- speculative claims or anything you could not verify
- content better stored in another file referenced by project config
- raw template text that has not been reorganized and verified

If AGENTS.md already exists, improve it in place rather than rewriting blindly. Preserve verified useful guidance, delete fluff or stale claims, and reconcile it with the current codebase.

# Questions

Only ask the user questions if the repo cannot answer something important. Ask at most one short batch of questions. Do not ask about anything the repo already makes clear.

# Initialization templates

${templateText}
`;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("init", {
		description: "Create or update AGENTS.md using initialization templates",
		handler: async (args, ctx) => {
			const templates = loadTemplates();
			const prompt = buildInitPrompt(args, ctx, templates);
			if (ctx.hasUI) {
				ctx.ui.notify(`Initializing AGENTS.md with ${templates.length} template${templates.length === 1 ? "" : "s"}.`, "info");
			}
			pi.sendUserMessage(prompt);
		},
	});
}

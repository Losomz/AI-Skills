# Base AGENTS.md Initialization Instructions

## Goal

Create a compact, coherent, high-signal `AGENTS.md` that helps future coding agents work correctly in this repository. Every line should answer: "Would an agent likely miss this without help?" If not, leave it out.

Initialization templates, when provided, are source material and checklists only. They may have been extracted from other projects after removing project-specific details.

## Critical Template Rules

- Do not paste template text directly into `AGENTS.md`.
- First extract reusable guidance and categories from the selected template, if any.
- Then inspect this repository and verify which template ideas actually apply.
- Rewrite relevant, verified information into a clean project-specific `AGENTS.md`.
- Remove project names, commands, paths, architecture names, and conventions from templates unless verified in this repository.
- If a template idea is not relevant or cannot be verified, omit it.
- Organize the final `AGENTS.md` by topic, not by template file.

## How to Investigate

Read the highest-value sources first:

- `README*`, root manifests, workspace config, lockfiles
- build, test, lint, formatter, typecheck, and codegen config
- CI workflows and pre-commit / task runner config
- existing instruction files: `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`, `.cursorrules`, `.github/copilot-instructions.md`
- repo-local Pi/OpenCode/Codex configuration where present

If architecture is still unclear after reading config and docs, inspect a small number of representative code files to find real entrypoints, package boundaries, and execution flow. Prefer files that explain how the system is wired together over random leaf files.

Prefer executable sources of truth over prose. If docs conflict with config or scripts, trust the executable source and only keep what can be verified.

## What to Extract

Look for high-signal, repository-specific facts:

- exact developer commands, especially non-obvious ones
- how to run one test, one package, or a focused verification step
- required command order when it matters, such as lint -> typecheck -> test
- monorepo or multi-package boundaries, ownership of major directories, and real app/library entrypoints
- generated code, migrations, assets, codegen, build artifacts, env loading, dev servers, infra or deploy quirks
- repo-specific style or workflow conventions that differ from defaults
- testing quirks: fixtures, integration prerequisites, snapshots, required services, flaky or expensive suites
- important constraints from existing instruction files worth preserving

## Final `AGENTS.md` Shape

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

Do not force every section. If the repo is simple, keep `AGENTS.md` simple. If the repo is large, summarize only structural facts that change how an agent should work.

## Writing Rules

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
- speculative claims or anything that could not be verified
- content better stored in another file referenced by project config
- raw template text that has not been reorganized and verified

If `AGENTS.md` already exists, improve it in place rather than rewriting blindly. Preserve verified useful guidance, delete fluff or stale claims, and reconcile it with the current codebase.

## Questions

Only ask the user questions if the repo cannot answer something important. Ask at most one short batch of questions. Do not ask about anything the repo already makes clear.

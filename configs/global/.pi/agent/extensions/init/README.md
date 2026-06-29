# Init Extension

This extension provides a `/init` command that creates or updates the current repository's `AGENTS.md` using an OpenCode-style initialization prompt plus local initialization templates.

## Layout

```text
init/
  index.ts
  README.md
  templates/
    base.md
```

Add new reusable initialization templates to `templates/*.md`. The command reads all first-level Markdown files in `templates/`, sorts them by filename, and injects them into the initialization prompt.

## What `/init` Does

`/init [focus or constraints]` asks the agent to:

1. Read the templates as source material and checklists.
2. Inspect the target repository's README, manifests, lockfiles, CI, scripts, config, and existing instruction files.
3. Verify which template ideas apply to the target repository.
4. Reorganize the verified findings into a coherent, project-specific `AGENTS.md`.
5. Improve an existing `AGENTS.md` in place when one already exists.

Templates are not final output. They must not be pasted directly into `AGENTS.md`.

## Template Authoring Rules

When extracting reusable material from an existing project's `AGENTS.md`, remove project-specific facts and keep reusable high-signal checks.

Remove or generalize:

- project, package, service, product, branch, or team names
- exact paths unless they are generic categories such as `src/`, `tests/`, or `docs/`
- exact commands unless they are stable for the whole project family
- architecture component names that only exist in the source project
- company/team workflow rules that are not generally applicable
- stale notes, one-off incidents, and local machine setup

Keep:

- what an agent should check
- why the check matters
- what section the finding belongs in
- what must be verified in the target repo before writing it
- examples of high-signal wording, only if they are clearly generic

## Recommended Template Shape

```md
# Template Name

## Purpose

What this template helps capture.

## Extract When Present

- High-signal facts to look for.
- Commands or constraints to verify.
- Gotchas that commonly matter for this project type.

## Do Not Copy Directly

- Project-specific examples or placeholders to remove.
- Facts that must be verified before inclusion.

## Target AGENTS.md Sections

- Commands
- Testing
- Style Guide
- Generated Code / Assets / Migrations
```

The shape is recommended, not mandatory. Keep templates easy to scan and easy to merge with other templates.

## Final `AGENTS.md` Standard

The generated `AGENTS.md` should be:

- compact and organized
- specific to the target repository
- based on verified repo facts, not guesses
- structured by topic, not by template file
- free of raw template text and source-project leftovers
- focused on information a future agent is likely to miss without help

Good final sections include only those relevant to the target repo:

- top-priority project rules
- Project Structure
- Commands
- Testing
- Type Checking / Linting
- Generated Code / Assets / Migrations
- Style Guide
- Workflow / Git / PR
- Architecture Notes
- Agent Notes

If the repository is simple, the final file should stay simple. If the repository is large, summarize only the structural facts and constraints that change how an agent should work.

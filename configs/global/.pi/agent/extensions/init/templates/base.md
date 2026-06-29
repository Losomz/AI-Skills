# Base AGENTS.md Initialization Template

## Purpose

Use this template as a checklist for creating or updating a repository-level `AGENTS.md`. Do not copy it directly. Convert only verified, repository-specific findings into the final file.

## Extract When Present

### Project Rules

- Non-obvious rules that should appear before any section.
- Files or directories agents must not edit directly.
- Default branches, required working directories, or project-specific command order.
- Existing instruction files that must be preserved or reconciled.

### Project Structure

- Real source, test, config, docs, assets, generated, migration, or infra locations.
- Monorepo package boundaries and which package owns which runtime behavior.
- Application/library entrypoints that are not obvious from filenames.
- Places where agents should look first for common changes.

### Commands

- Setup, build, dev server, lint, format, typecheck, test, codegen, migration, and release commands.
- Commands that must run from a specific directory.
- How to run a single package, single test file, single test case, or focused verification.
- CI commands that differ from local defaults.

### Testing

- Test frameworks and where tests live.
- Unit vs integration vs e2e boundaries.
- Required fixtures, services, credentials, ports, emulators, snapshots, or generated assets.
- Slow, flaky, expensive, or unsafe suites and when to avoid them.
- Naming patterns for tests only when the repo enforces them.

### Generated Code, Assets, and Migrations

- Generated directories that should not be manually edited.
- Commands that regenerate SDKs, schemas, API clients, assets, snapshots, or migrations.
- Required order after changing public APIs, schemas, assets, or database definitions.
- Any checked-in generated output that must be committed with source changes.

### Style Guide

- Repo-specific style that differs from language/framework defaults.
- Import, module, naming, formatting, error-handling, logging, async, typing, or architecture conventions.
- Patterns to prefer or avoid, with short examples only when they prevent likely mistakes.
- Lint/formatter rules should be summarized from config, not guessed.

### Workflow / Git / PR

- Branch naming, commit message, PR title, changelog, release, or review conventions.
- Required verification before finishing work.
- Whether generated files, snapshots, lockfiles, docs, or migrations must accompany changes.

### Agent Notes

- How agents should work in this repo when the workflow is non-obvious.
- Which existing instruction files or directories contain specialized guidance.
- Safety constraints around large refactors, destructive commands, external services, or secrets.
- When to use read-only exploration before editing.

## Do Not Copy Directly

- Project names, package names, branch names, commands, paths, ports, services, and architecture terms from the source template unless verified in the target repository.
- Generic advice such as "write clean code", "add tests", or "follow best practices".
- Long file trees, tutorials, onboarding prose, or obvious language conventions.
- Speculation, guesses, or stale rules contradicted by current config.

## Target AGENTS.md Style

- Compact, organized, and project-specific.
- Prefer short sections and bullets.
- Put the most important constraints near the top.
- Use exact commands in code spans.
- Mention working directory requirements for commands.
- Keep only facts that help a future agent avoid mistakes or ramp up faster.

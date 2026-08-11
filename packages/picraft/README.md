# PiCraft

An opinionated workflow suite for the [Pi coding agent](https://github.com/earendil-works/pi).

## Install

```bash
pi install npm:@losomz/picraft
```

Restart Pi after installation, or run `/reload` in an existing Pi session.

## Included Workflows

- Plan: a persistent planning mode with guarded write tools and explicit execution handoff.
- Questionnaire: structured intent clarification with single-choice, multiple-choice, and free-form answers in the Pi TUI.
- Permission: project-boundary and sensitive-file approval with parent/child session authorization sharing.
- Subagent: bundled General, Explore, and Scout agents with per-agent model and thinking configuration.
- Git: commit, pull, and branch workflows under `/git`.
- Init: repository-aware `AGENTS.md` initialization with reusable project templates.
- Blog: file-based product, technical, release, and work log workflows.

PiCraft requires Pi 0.80.4 or newer.

## Update

```bash
pi update npm:@losomz/picraft
```

Pinned installs such as `npm:@losomz/picraft@0.1.3` do not update automatically. Install a newer explicit version to move a pinned package.

## Uninstall

```bash
pi remove npm:@losomz/picraft
```

## Try From Source

From an AgentFramework checkout:

```bash
pi --no-extensions --no-skills --no-prompt-templates --no-themes -e ./packages/picraft
```

Do not enable npm, Git, project-local, or manually copied versions of the same PiCraft extensions at the same time. Duplicate sources register the same tools, commands, shortcuts, and event handlers.

## Security

Pi extensions execute with the current user's system access. Review the source before installation. PiCraft Permission is a tool-call approval layer, not an operating-system sandbox; headless approval failures default to rejection.

Credentials, model configuration, sessions, logs, and other machine-local Pi state are not distributed by this package.

Source and issue tracking: [Losomz/AgentFramework](https://github.com/Losomz/AgentFramework)

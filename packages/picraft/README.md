# PiCraft

An opinionated workflow suite for the [Pi coding agent](https://github.com/earendil-works/pi).

The published npm package is `pi-craft`.

## Install

```bash
pi install npm:pi-craft
```

If Pi still lists the historical `npm:@losomz/picraft` identity, remove it before installing `npm:pi-craft`; Pi treats the two npm names as different packages.

Restart Pi after installation, or run `/reload` in an existing Pi session.

## Included Workflows

- Plan: a persistent planning mode with guarded write tools and explicit execution handoff.
- Questionnaire: structured intent clarification with single-choice, multiple-choice, and free-form answers in the Pi TUI.
- Permission: project-boundary and sensitive-file approval with parent/child session authorization sharing.
- MCP: lightweight stdio and Streamable HTTP server/tool controls through the Pi TUI.
- Subagent: bundled General, Explore, and Scout agents with per-agent model and thinking configuration. Scout uses a controlled Git tool and deterministic checkouts under `~/.cache/picraft/scout/repos`.
- Git: commit, pull, and branch workflows under `/git`.
- Init: repository-aware `AGENTS.md` initialization with reusable project templates.
- Blog: file-based product, technical, release, and work log workflows.

PiCraft requires Pi 0.80.4 or newer.

## MCP

Add compatible `mcpServers` configuration to `~/.pi/agent/mcp.json` or a trusted project's `.mcp.json`, then use `/mcp` to enable servers and individual tools. Servers are disabled by default and connect only when selected.

```json
{
  "mcpServers": {
    "local": {
      "command": "npx",
      "args": ["-y", "@example/mcp-server"],
      "env": { "TOKEN": "${MCP_TOKEN}" }
    },
    "remote": {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${MCP_TOKEN}" }
    }
  }
}
```

## Update

```bash
pi update npm:pi-craft
```

Pinned installs such as `npm:pi-craft@0.1.8` do not update automatically. Install a newer explicit version to move a pinned package.

## Uninstall

```bash
pi remove npm:pi-craft
```

## Try From Source

From an AgentFramework checkout:

```bash
pi --no-extensions --no-skills --no-prompt-templates --no-themes -e ./packages/picraft
```

Do not enable npm, Git, project-local, or manually copied versions of the same PiCraft extensions at the same time. Duplicate sources register the same tools, commands, shortcuts, and event handlers.

## Security

Pi extensions execute with the current user's system access. Review the source before installation. PiCraft Permission is a tool-call approval layer, not an operating-system sandbox; headless approval failures default to rejection. For external reads, an always grant uses a detected project, package, or engine manifest root so files in the same dependency tree do not prompt individually; external write grants remain limited to the direct parent directory. Existing regular files dragged or pasted into the Pi TUI receive exact, session-scoped read approval, including sensitive files the user explicitly supplies; parent directories, sibling files, and write operations remain restricted. PiCraft's exact Scout cache root is trusted for ordinary reads by all agents, while sensitive-file checks and write approval remain active. Only the bundled Scout receives the managed repository tool.

Credentials, model configuration, sessions, logs, and other machine-local Pi state are not distributed by this package.

Source and issue tracking: [Losomz/AgentFramework](https://github.com/Losomz/AgentFramework)

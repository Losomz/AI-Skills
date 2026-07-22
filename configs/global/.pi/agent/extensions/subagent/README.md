# Subagent Extension

Lightweight bundled subagents for Pi.

## Shortcuts

Use `#AgentName` in the editor to quickly delegate to bundled agents:

```text
#Explore 查找同步逻辑
#Explore 查问题 > #General 根据上一步结果修复
#Explore 查本地逻辑 | #Scout 查上游实现
```

- `#AgentName` is a shortcut delegation request to the main agent, not a raw direct dispatch. The main agent first summarizes relevant conversation context and, when necessary, inspects the repository for key facts before building a self-contained subagent task.
- The selected agents, execution mode, task count, and order remain fixed. The main agent enriches the task context but does not replace the requested route or perform the delegated work itself.
- `>` runs agents sequentially with `{previous}` passed to the next step.
- `|` runs agents in parallel.
- Agent names are matched case-insensitively and completed dynamically from the extension's same-directory `agents/*.md`.

The extension also keeps the `subagent` tool available for model-driven delegation. At startup and before each agent turn, it injects a concise inventory of available subagents into Pi so the model can proactively choose the right subagent.

```json
{
  "agent": "Explore",
  "task": "Find code related to resource loading",
  "agentScope": "project",
  "confirmProjectAgents": false
}
```

Discover available agents without running a task:

```json
{
  "list": true,
  "agentScope": "project"
}
```

## Model Selection

Use `/subagent-model` or `Alt+M` to change the model used by a bundled subagent:

```text
/subagent-model
/subagent-model Explore
/subagent-model Explore aimaster/gpt-5.6-luna
/subagent-model Explore reset
```

With no model argument, TUI mode opens a searchable selector. RPC mode falls back to standard extension `select` requests. Models come from Pi's `ModelRegistry`; only models with non-runtime authentication are selectable. Parent-only credentials such as a one-off `--api-key` are excluded because they are not inherited by the child process. Dynamically registered providers must also be loaded by the child Pi startup environment.

Selections are stored locally in:

```text
~/.pi/agent/subagent-models.json
```

```json
{
  "version": 1,
  "overrides": {
    "project:explore": { "provider": "aimaster", "id": "gpt-5.6-luna" }
  }
}
```

The file contains only provider/model identifiers, never credentials. It is runtime user state and should not be copied from this repository over an existing local file. Model precedence is:

```text
local subagent-models.json override
> agent Markdown frontmatter.model
> child Pi default model
```

`reset` removes the local override and restores the profile default. Changes apply to future runs only; already running subagents keep their startup snapshot. The same resolved `General` profile is used by `/git commit`.

The picker currently manages the bundled extension-local agents used by the default `project` scope. Overrides store only `provider/id`; they do not configure thinking level. A `:thinking` suffix in the Markdown profile applies again after `reset`, while an active override uses the child Pi default thinking setting. If the override file is malformed, normal delegation falls back to profile models and reports a warning, while the picker refuses to overwrite the damaged file until it is repaired or removed.

The model implementation is split by responsibility:

```text
model-catalog.ts    # Pi ModelRegistry adapter and refresh coalescing
model-overrides.ts  # versioned local config, locking, atomic writes, profile resolution
model-picker.ts     # command, shortcut, searchable TUI, and RPC fallback
agent-runner.ts     # isolated child process only
```

## Bundled Agents

Bundled agents live in:

```text
<subagent extension directory>/agents/*.md
```

For the global template in this repository, that becomes `~/.pi/agent/extensions/subagent/agents/*.md` after sync. The code discovers this directory relative to `index.ts`; it does not hardcode the repository `configs/...` path and does not use `~/.pi/agent/agents/` for bundled subagents.

To add a new agent, add another markdown file with frontmatter:

```markdown
---
name: MyAgent
description: What this agent is for
tools: read, grep, find, ls
# Optional. If omitted, the current Pi default model is used.
# model: provider/model
---

System prompt for the agent.
```

If `model` is omitted, the subagent uses the current Pi default model.

## Default Agents

### General

模式：subagent

A general-purpose agent for complex questions and multi-step tasks. It has full tool access and may modify files when needed. Use it for implementation, debugging, or larger delegated work units.

### Explore

模式：subagent

A fast read-only codebase exploration agent. It cannot modify files. Use it to find files by pattern, search code, inspect relevant sections, or answer questions about the repository.

### Scout

模式：subagent

A read-only external research agent for dependencies, upstream source code, and external documentation. It may clone external repositories into a managed cache, but must not modify the current workspace.

Recommended cache location:

```text
~/.cache/agentframework/subagents/
```

## Running Widget

While subagents are running, the extension shows a widget above the editor with:

- agent name
- pid
- elapsed time
- model if configured
- task preview

Example:

```text
Subagents running (1):
  ⏳ Explore pid=1234 8s — 查找资源加载相关代码
```

## Shared Process Runner

`agent-runner.ts` exports `runAgentProcess({ profile, task, cwd, signal, onUpdate })`. It applies the resolved profile's model, tools, and system prompt to an ephemeral Pi process using `--mode json -p --no-session`, then returns normalized lifecycle and output data. Model discovery and override persistence stay outside the runner so sibling extensions can reuse the same immutable resolved profile.

The runner has no Pi extension, session, or UI dependency. The `subagent` tool and sibling extensions such as Git provide their own discovery, presentation, and result handling.

## Worktree Isolation

Current version does **not** use Git worktree isolation.

`General` runs directly in the current workspace and can modify files. Be careful when running multiple writable General agents in parallel, because they can edit overlapping files.

`Explore` and `Scout` are read-only by prompt and tool policy.

## Safety Notes

- Extension-local agents are prompts bundled with this trusted config package.
- `#AgentName` shortcuts run bundled extension-local agents with `confirmProjectAgents: false`.
- The raw `subagent` tool still accepts `agentScope` for advanced use, but the default bundled agents are discovered from this extension's own `agents/` directory.

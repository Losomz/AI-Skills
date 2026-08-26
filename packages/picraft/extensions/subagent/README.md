# Subagent Extension

Lightweight bundled subagents for Pi.

## Shortcuts

Use `#AgentName` in the editor to quickly delegate to bundled agents:

```text
#Explore 查找同步逻辑
#Explore 查问题 > #General 根据上一步结果修复
#Explore 查本地逻辑 | #Scout 查上游实现
```

- `#AgentName` is a shortcut delegation request to the main agent, not a raw direct dispatch. The main agent first summarizes relevant conversation context and, when necessary, inspects the repository for key facts before building a bounded, self-contained subagent task with explicit scope, expected output, and a stop condition.
- The selected agents, execution mode, task count, and order remain fixed. The main agent enriches the task context but does not replace the requested route or perform the delegated work itself.
- `>` runs agents sequentially with `{previous}` passed to the next step.
- `|` runs agents in parallel.
- Agent names are matched case-insensitively and completed dynamically from the extension's same-directory `agents/*.md`.

The extension also keeps the `subagent` tool available for model-driven delegation and injects a concise, current inventory of available subagents before each agent turn. Use subagents for high-value work where specialization, isolated context, or genuine parallelism materially helps. The main agent delegates the smallest sufficient scope, and every spawned subagent receives a shared boundary contract that tells it to stop once the requested output has enough supporting evidence instead of expanding the investigation for completeness.

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

## Subagent Configuration

Use `/subagent` or `Alt+M` to open the bundled subagent configuration panel. The slash command and the model-facing `subagent` tool use separate Pi namespaces and can share the same name.

The TUI follows Pi's settings/model-configuration interaction:

1. Select an agent and press Enter or Space to open its Model and Thinking settings.
2. Model opens the searchable reusable-model catalog; Thinking opens a capability-aware level list.
3. Each selection returns to the agent settings and only stages the change.
4. Press `Ctrl+S` to save all staged changes. The panel stays open after saving.
5. Escape returns one level or closes the main panel; unsaved changes are discarded.

All levels show keybinding-aware operation hints in the footer, together with `(unsaved)`, `saving…`, `saved`, or an error message when applicable. RPC mode uses standard extension `select` requests for agent, model, and thinking followed by an explicit Save/Cancel step.

Models come from Pi's `ModelRegistry`; only models with non-runtime authentication are selectable. Parent-only credentials such as a one-off `--api-key` are excluded because they are not inherited by the child process. Dynamically registered providers must also be loaded by the child Pi startup environment.

Selections are stored locally in:

```text
~/.pi/agent/subagent-models.json
```

```json
{
  "version": 2,
  "overrides": {
    "project:explore": {
      "model": { "provider": "aimaster", "id": "gpt-5.6-luna" },
      "thinkingLevel": "off"
    },
    "project:general": {
      "thinkingLevel": "medium"
    }
  }
}
```

The file contains only provider/model identifiers and thinking levels, never credentials. It is runtime user state and should not be copied from this repository over an existing local file. Version 1 model-only files are migrated in memory and written as version 2 on the next save. Model precedence is:

```text
local subagent-models.json override
> agent Markdown frontmatter.model
> current main Agent model
> child Pi default model (only when the main Agent has no model)
```

Choosing Model `Default` removes only the local model override. The bundled agents do not pin a profile model, so their model default follows the main Agent model at the time a run starts. Switching the main Agent model affects future default subagent runs, while explicitly configured subagents remain pinned. Already running subagents keep their startup snapshot.

Thinking precedence is:

```text
local subagent-models.json thinking override
> agent Markdown frontmatter thinking-level
> child Pi model/project/global default
```

Thinking `Default` removes the local thinking override. It falls back to agent frontmatter when present; otherwise the child process receives no `--thinking` argument and uses its own default. `Off` is distinct: it stores `"off"` and passes `--thinking off`. Concrete levels are filtered using the selected model's capabilities; changing to a model that cannot use a staged level resets that staged level to Default. A stale or manually edited incompatible level is rejected before launch instead of being silently clamped. These per-agent settings apply only to Subagent runs; `/git commit` starts its own dedicated Pi process.

The panel currently manages the bundled extension-local agents used by the default `project` scope. If the override file is malformed, normal delegation falls back to profile, main Agent, or child Pi defaults and reports a warning, while the panel refuses to overwrite the damaged file until it is repaired or removed.

The model implementation is split by responsibility:

```text
model-catalog.ts    # Pi ModelRegistry adapter and refresh coalescing
model-overrides.ts  # versioned local config, migration, locking, atomic writes, effective profile resolution
model-picker.ts     # /subagent agent/model/thinking settings and RPC fallback
thinking.ts         # supported persisted thinking values and parser
agent-runner.ts     # Subagent profile adapter over the package-neutral shared runner and trusted-child capabilities
repository-cache.ts # validated URL/branch checkout cache, mutation queue, lock, clone, fetch, and stale reuse
repository-tool.ts  # trusted Scout-only scout_repository tool registration and compact results
../shared/scout-cache-paths.ts # cache-root, URL identity, branch, and deterministic path helpers
```

## Bundled Agents

Bundled agents live in:

```text
<subagent extension directory>/agents/*.md
```

The npm source lives at `packages/picraft/extensions/subagent/agents/*.md`; a manual global mapping would place it at `~/.pi/agent/extensions/subagent/agents/*.md`. The code discovers this directory relative to `index.ts` and does not use `~/.pi/agent/agents/` for bundled subagents.

To add a new agent, add another markdown file with frontmatter:

```markdown
---
name: MyAgent
description: What this agent is for
tools: read, grep, find, ls
# Optional. If omitted, the current main Agent model is used.
# model: provider/model
# Optional. Local /subagent settings can override it.
# thinking-level: medium
---

System prompt for the agent.
```

If `model` is omitted and no local override is saved, the subagent uses the current main Agent model captured when the run starts. The canonical thinking frontmatter field is `thinking-level`; `thinkingLevel` and `thinking` are accepted for compatibility.

## Default Agents

### General

模式：subagent

A general-purpose agent for complex questions and multi-step tasks. It has full tool access and may modify files when needed. Use it for implementation, debugging, or larger delegated work units.

### Explore

模式：subagent

A fast read-only codebase exploration agent. It cannot modify files. Use it to find files by pattern, search code, inspect relevant sections, or answer questions about the repository.

### Scout

模式：subagent

A read-only external research agent for dependencies, upstream source code, and external documentation. It must use the trusted `scout_repository` tool for external Git checkouts and must not modify the current workspace. The tool may create or refresh validated branch-specific repositories in PiCraft's managed cache.

The repository tool is exposed only inside a child launched from the exact bundled Scout profile. A user-defined agent with the same name does not receive the capability.

Managed cache root:

```text
~/.cache/picraft/scout/
```

The cache contains `repos/` for managed checkouts and a reserved `artifacts/` directory. Repository paths are deterministic by lowercased host and case-safe encoded repository path segments; an explicitly requested branch adds an encoded `@branch` suffix, while the remote-default checkout uses the unsuffixed repository path. Accepted inputs are explicit HTTPS, HTTP, SSH, Git, and `git@host:path` URLs without credentials, query strings, fragments, or traversal. Existing checkouts refresh by default; callers may intentionally disable refresh for offline reuse. Fetch failures preserve a revalidated checkout and report it as stale.

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

## Process Runner

`agent-runner.ts` exports the Subagent-facing `runAgentProcess({ profile, task, cwd, signal, onUpdate })` adapter. It maps a resolved profile into the package-neutral `../shared/pi-process-runner.ts`, which starts an ephemeral Pi process using `--mode json -p --no-session` and returns normalized lifecycle and output data. When neither local configuration nor profile frontmatter resolves a level, `--thinking` is omitted; Off and concrete levels pass it explicitly.

The shared runner has no Pi extension, session, UI, agent-discovery, or model-override dependency. Subagent owns profile discovery and configuration; Git constructs its own dedicated process configuration without importing Subagent internals.

## Worktree Isolation

Current version does **not** use Git worktree isolation.

`General` runs directly in the current workspace and can modify files. Be careful when running multiple writable General agents in parallel, because they can edit overlapping files.

`Explore` and `Scout` are read-only by prompt and tool policy.

## Safety Notes

- Extension-local agents are prompts bundled with this trusted config package.
- The bundled Scout child receives `scout_repository` through a dedicated capability environment marker; user-defined same-name agents do not.
- `scout_repository` is the only supported external repository checkout path for Scout. Direct `git clone` and `git fetch` commands are forbidden by the Scout instructions.
- `#AgentName` shortcuts run bundled extension-local agents with `confirmProjectAgents: false`.
- The raw `subagent` tool still accepts `agentScope` for advanced use, but the default bundled agents are discovered from this extension's own `agents/` directory.

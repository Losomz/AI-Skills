# Subagent Extension

Lightweight bundled subagents for Pi.

## Shortcuts

Use `#AgentName` in the editor to quickly delegate to bundled agents:

```text
#Explore 查找同步逻辑
#Explore 查问题 > #General 根据上一步结果修复
#Explore 查本地逻辑 | #Scout 查上游实现
```

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
Subagents running:
  ⏳ Explore pid=1234 8s — 查找资源加载相关代码
```

## Direct Isolated Runner

Trusted sibling extensions can call `runAgentInIsolatedProcess()` to start an independent Pi process without creating a parent-session message or `subagent` tool result. The new process runs its own main agent with the selected configuration. The runner uses the same ephemeral JSON process path as the tool (`--mode json -p --no-session`) and returns a normalized result containing status, PID, model, start/end time, exit code, and final output.

`IsolatedAgentProcessOptions.onUpdate` receives lifecycle updates as the process starts, runs, and reaches a terminal state. Direct calls deliberately do not publish into the shared `subagent-runs` widget; the caller owns its UI and persistence policy. `/git commit` uses a temporary status/widget while running, then appends a Pi custom entry that is persisted for display but excluded from LLM context. It never sends a delegation prompt, child output, or summary as a parent message.

## Worktree Isolation

Current version does **not** use Git worktree isolation.

`General` runs directly in the current workspace and can modify files. Be careful when running multiple writable General agents in parallel, because they can edit overlapping files.

`Explore` and `Scout` are read-only by prompt and tool policy.

## Safety Notes

- Extension-local agents are prompts bundled with this trusted config package.
- `#AgentName` shortcuts run bundled extension-local agents with `confirmProjectAgents: false`.
- The raw `subagent` tool still accepts `agentScope` for advanced use, but the default bundled agents are discovered from this extension's own `agents/` directory.

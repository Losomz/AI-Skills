# Plan Extension

Orchestration and planning mode for Pi. It helps the main agent triage work, inspect facts, design an approach, and only then switch back to execution.

## Features

- **Planning prompt injection**: injects a hidden prompt from `prompts/plan.md` while plan is active.
- **Tool-layer write protection**: removes write tools from the active tool list and blocks destructive/write-like bash commands.
- **Analysis-friendly bash**: allows non-mutating analysis commands instead of relying on a tiny allowlist.
- **Subagent-aware, but decoupled**: plan does not import subagent internals. The `subagent` tool enforces each agent's own `planMode` policy when plan is active.
- **Three-choice flow**: after each plan turn, choose `Stay`, `Execute`, or `Execute with additional instructions`.
- **Session persistence**: plan enabled state survives session resume.

## Commands

- `/plan` - Toggle plan mode.
- `/todos` - Show a note that numbered todo tracking is not used.
- `Alt+I` - Toggle plan shortcut.

## Prompt files

Prompt text is intentionally kept outside TypeScript:

```text
plan/
├── prompts/
│   ├── plan.md      # hidden reminder injected while planning
│   └── execute.md   # message sent when switching to execution
├── index.ts
└── utils.ts
```

Edit `prompts/plan.md` to tune planning behavior without touching extension logic.

## How It Works

### Plan mode

- The extension stores state as custom entries with `customType: "plan-state"`.
- Active tools are reduced to currently available analysis/delegation tools: `read`, `bash`, `grep`, `find`, `ls`, `questionnaire`, and `subagent` when those tools are present and active.
- `edit` and `write` are not exposed to the model.
- Bash commands are blocked when they appear to mutate files, dependencies, git state, or the system.
- A hidden `plan-context` message injects the content of `prompts/plan.md` before each agent turn.
- When plan is disabled, stale `plan-context` / legacy `plan-mode-context` reminders are filtered from context.

### Execution mode

- Full previous tool access is restored.
- The extension sends `prompts/execute.md` as a visible `plan-execute` message and triggers the next turn.
- Additional user instructions are appended when using `Execute with additional instructions`.

## Bash blocking policy

Blocked examples:

- File modification: `rm`, `mv`, `cp`, `mkdir`, `touch`, `chmod`, `tee`, redirection (`>`, `>>`)
- In-place edits / formatters: `sed -i`, `perl -i`, `prettier --write`, `eslint --fix`
- Dependency mutation: `npm install`, `pnpm add`, `yarn remove`, `pip install`
- Git write/state mutation: `git add`, `commit`, `push`, `pull`, `merge`, `rebase`, `reset`, `checkout`, `stash`, `clean`, `clone`
- System mutation: `sudo`, `kill`, `systemctl restart`, editors such as `vim`/`nano`/`code`

Commands not matching the deny list are allowed so normal analysis is less likely to be blocked.

## Subagents in Plan

Plan itself does not parse subagent files. The `subagent` extension reads its own `agents/*.md` frontmatter and enforces `planMode` at tool execution time:

```yaml
planMode: auto      # may be called proactively in plan
planMode: explicit  # only if the user explicitly names this subagent
planMode: deny      # never allowed in plan
```

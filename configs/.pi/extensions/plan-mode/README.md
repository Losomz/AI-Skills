# Plan Mode Extension

Read-only exploration mode for safe code analysis.

## Features

- **Read-only tools + delegated subagents**: Restricts the main agent to read, bash, grep, find, ls, questionnaire, subagent
- **Bash allowlist**: Only read-only bash commands are allowed
- **Opencode-style reminder**: Strong read-only planning prompt, without forcing numbered plans
- **Three-choice flow**: After each plan-mode turn, choose `Stay`, `Execute`, or `Execute with additional instructions`
- **Session persistence**: Plan-mode enabled state survives session resume

## Commands

- `/plan` - Toggle plan mode
- `/todos` - Show a note that numbered todo tracking is disabled
- `Alt+I` - Toggle plan mode shortcut

## Usage

1. Enable plan mode with `/plan` or `--plan` flag.
2. Ask the agent to inspect, analyze, or discuss an approach.
3. The agent stays read-only and may respond in whatever format fits the task: short explanation, bullets, checklist, or structured plan.
4. After the turn, choose one of three options:
   - `Stay` - keep discussing/analyzing with read-only tools.
   - `Execute` - leave plan mode, restore full tools, and execute the discussed approach.
   - `Execute with additional instructions` - enter extra execution instructions, then leave plan mode and execute.

## How It Works

### Plan Mode (Read-Only)

- Only read-only main-agent tools are available, plus `subagent` for delegation.
- Bash commands are filtered through an allowlist.
- The main agent is instructed not to edit files, write files, install dependencies, commit changes, or otherwise change system state.
- Subagents declare their own plan-mode policy in frontmatter:
  - `planMode: auto` may be called proactively in plan mode.
  - `planMode: explicit` may run only when the user explicitly names that agent.
  - `planMode: deny` is never allowed in plan mode.
- Numbered `Plan:` sections are not required and are not parsed.

### Execution Mode

- Full tool access is restored.
- The extension defers a `plan-mode-execute` custom message to the next macrotask, then calls `sendMessage(..., { triggerTurn: true })` after Pi has settled the current `agent_end` lifecycle.
- There is no numbered step extraction, progress widget, or `[DONE:n]` tracking.

### Command Allowlist

Safe commands (allowed):
- File inspection: `cat`, `head`, `tail`, `less`, `more`
- Search: `grep`, `find`, `rg`, `fd`
- Directory: `ls`, `pwd`, `tree`
- Git read: `git status`, `git log`, `git diff`, `git branch`
- Package info: `npm list`, `npm outdated`, `yarn info`
- System info: `uname`, `whoami`, `date`, `uptime`

Blocked commands:
- File modification: `rm`, `mv`, `cp`, `mkdir`, `touch`
- Git write from the main agent: `git add`, `git commit`, `git push`
- Package install: `npm install`, `yarn add`, `pip install`
- System: `sudo`, `kill`, `reboot`
- Editors: `vim`, `nano`, `code`

## Subagents in Plan Mode

Plan mode does not hardcode subagent names. Each subagent declares its behavior in its markdown frontmatter:

```yaml
planMode: auto      # AI may proactively use it in plan mode
planMode: explicit  # only if the user names this subagent
planMode: deny      # never in plan mode
```

This lets read-only agents such as Explore/Scout run automatically, while writable agents such as General can still be used when the user explicitly asks, e.g. to delegate a commit without leaving the current main conversation.

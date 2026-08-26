<system-reminder>
# Plan - System Reminder

Plan mode is ACTIVE. Inspect relevant facts, clarify material ambiguity, and prepare a decision-complete plan at the task's actual scope. The main agent must not modify the workspace or system.

## Core workflow

1. Resolve material ambiguity. Discover repository or system facts before asking the user; use conservative defaults for reversible details.
2. Inspect only the evidence needed to understand the relevant behavior, constraints, and existing conventions. Scale exploration to task complexity.
3. Summarize the intended changes, validation, and any material risks or assumptions. Keep straightforward tasks brief; expand only when concrete cross-module, compatibility, or failure concerns require it.

## Tool and write restrictions

Available main-agent tools in Plan mode: {{TOOLS}}

Only read, search, inspect history, run non-mutating validation, and ask questions that materially affect the approach.

Do not edit or write files, install dependencies, generate or format code, or run commands that change Git, workspace, or system state.

The `bash` tool always executes Bash, including on Windows. Use Bash syntax and `/dev/null`; never use `nul`, `NUL`, `nul:`, or `$null` as a direct Bash redirection target.

## Output expectations

Answer explanation or planning questions directly. For implementation requests, provide the plan and wait for an explicit Execute action. Use a concise structure appropriate to the task; do not force a rigid format.
</system-reminder>

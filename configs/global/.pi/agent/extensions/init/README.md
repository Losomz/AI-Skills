# Init Extension

This extension provides a `/init` command that creates or updates the current repository's `AGENTS.md`.

## Layout

```text
init/
  index.ts
  base.md              # base init instructions, always injected
  README.md
  templates/           # optional templates added on top of base.md
    godot_sumeru.md
```

`base.md` is the base prompt layer and is always injected. Edit it when the default `/init` behavior should change. Add reusable, optional initialization checklists to first-level `templates/*.md` files.

## What `/init` Does

1. Lets the user choose one optional template mode with Pi's built-in selector:
   - `default` = add no optional template; `base.md` is still included
   - any `templates/*.md` file = include `base.md` plus that optional template
2. Opens a Pi editor dialog so the user can add or revise focus/constraints before execution.
3. Injects the full init instructions as hidden context (`display: false`) so the TUI does not show a long prompt.
4. Sends a short visible user message that starts the agent turn.

Cancelling either dialog cancels the command without injecting context or starting the agent.

## Usage

```text
/init
/init default
/init godot_sumeru
/init godot_sumeru focus on Godot resource safety
/init focus on test and verification commands
```

Argument behavior:

- No argument: choose `default` or one optional template, then edit optional focus text.
- First argument `default`: skip template selection and add no optional template; `base.md` is still included.
- First argument matching a template name, with or without `.md`: skip template selection and add that template on top of `base.md`.
- Other arguments: treated as initial focus text; the template selector is still shown.

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

Templates are not final output. They must not be pasted directly into `AGENTS.md`.

# Plan Extension

Plan mode for Pi 0.80.4+. It lets the main agent inspect and plan while withholding its normal write tools, then returns to execution only through an explicit mode change.

## Entry points

- `/plan` and `Alt+I` call the same manual-toggle handler.
- `--plan` enables Plan after session state is restored, so it overrides a persisted disabled state.
- `Stay`, `Execute`, and `Execute with additional instructions` are shown after an interactive Plan turn.

Every transition passes through the single `requestMode()` function in `index.ts`. A switch requested while Pi is running becomes an in-memory pending target; the current run keeps its captured mode and the final target is applied only after `agent_settled` reports Pi idle.

Manual exit is not Execute. It only changes mode and records a one-shot inactive notice for the next real user prompt. Explicit Execute restores tools and sends one `followUp` message with `triggerTurn: true`.

## Structure

```text
plan/
├── index.ts       # Pi registration, lifecycle, and requestMode
├── state.ts       # persisted/runtime state and branch-state decoding
├── context.ts     # prompts and hidden-context normalization
├── utils.ts       # tool intersection and bounded write guard
├── prompts/
└── tests/
```

The extension intentionally has no adapter/controller/ports hierarchy. Pi side effects remain in `index.ts`; the other modules expose small helpers without importing Pi types.

## State and branches

New state entries use `customType: "plan-state"`:

```ts
interface PersistedPlanStateV2 {
  enabled: boolean;
  revision: number;
  toolsBeforePlan?: string[];
  notice?: { kind: "inactive"; revision: number };
}
```

Legacy `plan-state` or `plan-mode` entries containing `{ enabled }` remain readable. Pending state is never persisted. Restoration reads only `sessionManager.getBranch()` and does not append a new entry, so sibling branches do not leak mode state.

Entering Plan snapshots the complete active tool list. Plan tools are:

```text
Plan candidates ∩ registered tools ∩ tools active in the relevant snapshot
```

Leaving Plan restores the snapshot after filtering tools no longer registered.

## Subagent boundary

Plan has no Subagent protocol or policy. It treats `subagent` like any other Pi tool and retains it only when it is already registered and active. It does not import Subagent code, inspect agent files, or activate the tool.

A writable/full-access subagent can therefore modify the workspace while the main agent is in Plan. The main-agent guard does not provide process isolation; disable or restrict Subagent separately when stronger isolation is required.

## Write guard

While a run is captured in Plan, `edit` and `write` are blocked and malformed Bash input is rejected. `utils.ts` also blocks a short list of common Unix, Git, dependency, system, and PowerShell mutations while allowing ordinary inspection commands. Direct Bash null-device redirection is allowed only through `/dev/null`; CMD and PowerShell spellings such as `NUL` and `$null` are treated as file redirection.

This is a best-effort planning guard, not a security sandbox. The rule set is deliberately bounded rather than attempting to parse every shell grammar or program.

## Test

```powershell
node --test configs/global/.pi/agent/extensions/plan/tests/plan.test.ts
```

The focused suite covers unified entry behavior, pending/settled transitions, run-mode locking, inactive notices, Execute follow-up, startup/branch restoration, context cleanup, tool restoration, and static Subagent decoupling.

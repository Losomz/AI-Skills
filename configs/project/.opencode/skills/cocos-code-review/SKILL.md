---
name: cocos-code-review
description: Review Cocos Creator code changes for behavioral regressions, lifecycle bugs, event registration issues, UI flow risks, resource leaks, prefab/scene wiring mistakes, and project-structure mismatches. Use when the user asks for a review, risk assessment, bug hunt, regression check, code audit, or wants a change inspected before merge in this Cocos/Noelle-style project.
---

# Cocos Code Review

Use this skill when reviewing Cocos Creator code, prefab-related change sets, or startup/UI/resource flows in this repo style.

This is a review skill, not an implementation skill.
Prioritize real bugs, regressions, scene/prefab wiring risks, lifecycle mistakes, and missing validation.
Do not spend the review on pure formatting unless it creates maintenance or runtime risk.

For prefab JSON, meta, UUID compression, or serialized structure edits, also read:
- `.agents/skills/cocos-general/SKILL.md`

For normal implementation work instead of review, use:
- `.agents/skills/cocos-developer/SKILL.md`

## Review Goals

Focus on the highest-signal problems first:
- runtime bugs
- lifecycle ordering mistakes
- event registration or cleanup problems
- UI opening and closing regressions
- async race conditions
- resource loading and release issues
- missing scene or prefab mounting
- project-structure violations that are likely to break behavior

Treat style only as a secondary concern unless it hides defects.

## Repo-Aware Priorities

In this repo family, pay extra attention to:
- `onLoad`, `onEnable`, `start`, `show`, `hide`, `onDestroy` ordering
- `EventBaseComponent` auto registration and cancellation behavior
- `ClientEvent.dispatchEvent` being called before listeners exist
- `UI.open`, `UI.preload`, `UI.close`, `UI.release` usage
- `UIBase` lifecycle and whether events are registered in `show` or via component enable flow
- `ResLoader` and `GlobalLoader` usage, especially dynamic resource ownership
- scene and prefab mounting assumptions for scheduler or manager components
- Noelle framework conventions versus business-layer one-off implementations
- platform checks, SDK calls, and swallowed errors in startup flows

## Review Workflow

1. Identify the changed files and the execution path.
2. Reconstruct the runtime flow, not just local syntax.
3. Check whether the code can actually run with current scene/prefab wiring.
4. Check whether cleanup mirrors registration.
5. Check whether async work can outlive destroyed nodes or disabled components.
6. Check whether the change matches local project patterns and Noelle usage.
7. Report findings ordered by severity, then open questions, then residual risk.

## What To Inspect

### Lifecycle And Timing

Check:
- Is logic running in the correct lifecycle method?
- Is code assuming another component has already finished `onEnable` or `start`?
- Is `scheduleOnce(..., 0)` used as a timing guard, and is that guard actually sufficient?
- Can initialization run twice?
- Can disabled or destroyed nodes still receive callbacks?

Common risks:
- dispatching events before listeners register
- `show`/`hide` behavior depending on scene component `onEnable`
- initialization in `onLoad` that should wait until a later phase

### Event System

Check:
- Is the listener ever registered in the active scene or active prefab instance?
- Is the event name correct and centralized?
- Does registration happen more than once?
- Does cleanup happen on `hide`, `onDisable`, or `onDestroy` as appropriate?
- Can dispatch happen when no listeners exist?

Common risks:
- scheduler or manager script exists in code but is not mounted in the scene
- duplicate listeners after reopen
- hidden UI still handling events

### UI Flow

Check:
- Does the caller really need a scheduler/event hop, or would direct open be safer?
- If using a scheduler, is the scheduler mounted and active?
- Are `UI.open` options correct for mask/top/conflicts?
- Does the UI lifecycle expect `init` before `show`?
- Are open/close transitions compatible with current parent and canvas assumptions?

Common risks:
- calling a UI event with no scheduler listener
- preloading UI but forgetting scene wiring
- assuming a panel exists because its script exists

### Resource And Loader Usage

Check:
- Is `ResLoader` imported correctly and initialized before use?
- Is ownership of loaded assets clear?
- Is `GlobalLoader` used where shared caching is intended?
- Are dynamically loaded assets released or intentionally retained?
- Are bundle names and prefab paths correct?

Common risks:
- stale template imports
- resource leaks on repeated open/close
- using the wrong bundle/path pair

### Prefab, Scene, And Serialized Wiring

Check:
- Is the script actually mounted where the runtime flow expects it?
- Are serialized `@property` fields still valid after edits?
- Are prefab path changes reflected in all call sites?
- Are scene-level singleton or scheduler assumptions real, not implicit?

Common risks:
- script exists in repo but not in scene
- node inactive, so `onEnable` never runs
- renamed prefab path without updating UI static metadata

### Async, Errors, And Platform Code

Check:
- Are async startup failures degraded safely?
- Are thrown errors caught where failure is non-fatal?
- Are swallowed errors at least logged with context?
- Can callbacks fire after scene switch or node destruction?
- Are platform APIs guarded by environment checks?

Common risks:
- startup chain blocked by one optional SDK
- promise rejection hidden without context
- callback mutating invalid node/component state

## Findings Standard

When reporting review findings:
- Lead with findings, not summary.
- Order by severity.
- Include file references.
- State the user-visible or runtime impact.
- Mention why the current code is risky, not just that it differs from preference.
- If no bug-level findings exist, say so explicitly and mention residual risks or missing verification.

Use this structure:
- `High`: crashes, broken flow, missing registrations, bad prefab/scene wiring, data loss, severe leaks
- `Medium`: likely regressions, duplicated listeners, lifecycle fragility, cleanup gaps, misleading architecture
- `Low`: maintainability issues with concrete future risk

## Do Not

- Do not turn the review into a formatting pass.
- Do not recommend refactors unless they reduce a concrete risk.
- Do not assume a script is active just because the file exists.
- Do not trust event-driven UI flow without confirming listener registration path.
- Do not review prefab or scene related changes without checking actual serialized references when available.

## Deliverable Style

Keep the response practical and concise.
Prefer:
- findings first
- open questions second
- short overall assessment last

If the code path cannot be verified because a scene, prefab, or external template is missing, say that explicitly as a review limitation.

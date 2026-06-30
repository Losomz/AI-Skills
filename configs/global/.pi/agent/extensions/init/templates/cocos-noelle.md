# Cocos + Noelle AGENTS.md Initialization Template

## Purpose

Use this template when creating or updating `AGENTS.md` for Cocos Creator TypeScript projects that use the Noelle/company Cocos framework or closely related mini-game infrastructure. This template is source material and a checklist only. Do not copy it directly. Convert only verified project-specific Cocos and Noelle rules into the final file.

If the target repository is a Cocos project but does not use Noelle, use only the generic Cocos sections that are verified. If the target repository does not appear to be a Cocos project, omit this template entirely.

## Confirm Applicability First

Check for real project evidence before writing any Cocos or Noelle rules:

- Cocos markers: `assets/`, `settings/`, `package.json` creator metadata, `tsconfig.json`, `.scene`, `.prefab`, `.meta`, Cocos-specific imports from `cc`, or documented Cocos Creator version.
- TypeScript markers: `assets/scripts/`, `.ts` components, decorators such as `@ccclass` and `@property`.
- Noelle markers: a framework directory, `Noelle.init`, `LocalStorage`, `Network`, `ClientEvent`, `Logger`, `Singleton`, UI/audio/storage framework modules, or project docs naming Noelle.
- Mini-game/platform markers: guarded calls to `wx`, `tt`, `Env.isMiniGame()`, SDK adapter files, login/openid modules, ad/share/cloud-storage modules.

Only include paths, commands, framework names, and API names after verifying they exist in the target repository.

## Extract When Present

### Cocos Project Facts

- Cocos Creator major/minor version from README, `package.json`, settings, CI, or engine metadata. If sources disagree, state the conflict briefly instead of guessing.
- Actual script, resource, prefab, scene, config, build setting, and generated/cache directories used by the project.
- Which directories are safe business code and which are framework/vendor/generated/editor-owned areas.
- Existing repo instruction files such as `AGENTS.md`, `.cursor/rules/`, `.cursorrules`, `.github/copilot-instructions.md`, Pi/OpenCode/Codex configs.

### Task Triage and Exploration

Keep only if it matches the repository's agent workflow:

- Start by judging task size, impact area, and risk before editing.
- For Cocos work, inspect entrypoints, call chains, prefab/scene wiring, resource references, storage shape, and platform branches before changing code.
- Complex work includes cross-module UI flow, storage/migration, prefab/scene edits, resource or bundle changes, platform SDK behavior, build pipeline changes, and large refactors.
- Use subagents or isolated review only if the target agent environment supports them and the task benefits from parallel exploration or review.

### Cocos TypeScript Style

Verify existing conventions before writing them:

- Component style: `@ccclass`, `extends Component`, `@property` for editor-wired dependencies.
- Whether dependencies are expected to be assigned in Inspector rather than discovered by recursive runtime lookup.
- Import style, path aliases, `db://` usage, quote style, indentation, and logger style.
- Naming conventions for components/classes, methods/variables, constants, events, prefabs, scenes, and resources.
- Whether `any` is tolerated or should be avoided in new code.

High-signal rules to include when verified:

- Prefer minimal, local changes over broad refactors.
- Do not format the whole repository for unrelated changes.
- Follow surrounding file style instead of enforcing a new global style.
- Keep platform checks consistent with existing patterns such as `typeof wx !== 'undefined'` or the project's environment wrapper.

### Prefab, Scene, Meta, and Resource Safety

Include rules that are relevant to the repository's actual asset workflow:

- Treat `.prefab`, `.scene`, `.meta`, UUIDs, bundle names, and serialized `@property` references as high-risk.
- Before moving, renaming, deleting, or rewriting assets, check all references and call sites.
- Confirm scripts are actually mounted in scenes/prefabs before relying on lifecycle methods or event listeners.
- Confirm Inspector bindings after component, property, node hierarchy, or prefab path changes.
- Avoid hand-editing complex prefab/scene JSON unless the change is small, mechanical, and the serialized structure is understood.
- If the repo provides prefab validators, UUID compression tools, or prefab templates, document the exact verified commands.
- For manual prefab script mounting, verify that script `__type__` uses compressed UUID from the script `.meta`, not the raw UUID.
- Keep `__id__` references in range and contiguous when editing serialized arrays.

### Noelle Framework Usage

Only include after verifying the target repo uses Noelle or the same framework family:

- Prefer extending/reusing existing framework facilities instead of creating parallel systems.
- Do not modify framework implementation directories unless the user explicitly asks or the task truly requires framework changes.
- New game-specific behavior should usually live in business/application code, not inside framework internals.
- Record actual framework entrypoints, startup order, and initialization hooks if they affect future work.
- Record actual UI, audio, storage, network, event, singleton, and logging modules used by the project.

Common Noelle-style modules to look for and summarize only if present:

- `Noelle.init` or equivalent bootstrapping.
- Local storage wrappers such as `LocalStorage` and business storage services.
- `Network` or similar XHR-based mini-game-compatible request wrapper.
- `ClientEvent` or equivalent global event bus.
- `Logger` or project logging wrapper.
- `Singleton` pattern used by framework services.
- UI manager/base classes and their lifecycle (`open`, `preload`, `close`, `show`, `hide`, `onLoad`, `onEnable`, `onDestroy`, etc.).

### Storage, Login, and Cloud Sync

Include only after checking actual modules and docs:

- Whether business data is local-first, cloud-first, or mixed.
- Where local save keys, save schema, migrations, and update helpers live.
- Whether login/openid is implemented, stubbed, or platform-specific.
- Whether cloud storage is a real backend, platform cloud API, or not implemented.
- Cloud sync identifiers such as `appId`, `userId/openId`, `gameId` only if the target repo uses that shape.
- Empty cloud payload behavior, parse guards, retry policy, conflict strategy, size/rate limits, and environment separation if documented.

High-signal wording when verified:

- `Local save remains the source of truth; cloud storage is backup/sync/fallback unless product requirements say otherwise.`
- `Do not JSON.parse cloud data before checking for an empty string or missing payload.`
- `Cloud/local conflict strategy must be confirmed before implementing overwrite or merge behavior.`

### Platform SDK and Runtime Configuration

Include only for repositories with SDK adapters or platform runtime config:

- Which SDK adapter or platform wrapper is the supported entrypoint.
- Whether SDK config requires a real injected SDK/channel package rather than a normal Cocos local build.
- How to distinguish SDK injection failure from missing backend/operation configuration.
- Expected config value types and parsing rules.

High-signal rules when verified:

- Treat remote config values as strings unless the wrapper guarantees another type.
- For boolean switches, prefer explicit string checks such as `'1'` enabled and `'0'` disabled.
- Do not treat `'0'` as false implicitly; it is truthy in JavaScript/TypeScript.
- Parse numbers with `Number(...)` and `Number.isFinite`.
- Parse JSON config with `try/catch` and a safe default.
- Do not store secrets, tokens, or payment validation data in remote config.
- For SDK backend config problems, verify package source and SDK injection before changing business logic.

### Lifecycle, Events, UI, and Async Risks

Use these checks when they are relevant to the target codebase:

- Check ordering of `onLoad`, `onEnable`, `start`, custom `init`, `show`, `hide`, `onDisable`, and `onDestroy`.
- Confirm event listeners are registered before events are dispatched.
- Confirm registration cleanup mirrors registration location and lifecycle.
- Watch for duplicate listeners after panel reopen or component re-enable.
- Guard async callbacks that can outlive destroyed nodes, hidden panels, or scene switches.
- Check UI open/close/preload/release conventions before changing panel flow.
- Confirm schedulers/managers/listeners are actually mounted and active in the relevant scene or prefab.

### Commands and Verification

Prefer repository-provided commands. Do not invent commands.

Extract and verify:

- `package.json` scripts, task runner commands, lint/typecheck/test commands.
- Cocos Creator build/publish workflow if documented.
- CI templates and whether local CLI equivalents exist.
- Prefab/resource validation scripts if present.
- How to run a focused test or focused static check if the repo supports it.

If commands are absent, say so in the final `AGENTS.md` instead of guessing `npm test`, `npm run build`, or a Cocos CLI command.

## Do Not Copy Directly

Remove or generalize these from source projects:

- Specific game/product names, business module names, feature acronyms, panel names, storage keys, and event names.
- Exact local machine paths or reference project paths.
- Specific branch workflow, commit scopes, team names, or CI details unless verified in the target repository.
- Claims that the target repo has no tests, no lint, no local build, or a specific Cocos version unless re-verified.
- Project-specific helper scripts such as `noelle.sh` unless present and documented in the target repository.
- One-off debugging lessons that only apply to the source project.
- Business-specific SDK keys or GM/debug panel cases unless the target repo has the same feature and key.

## Target AGENTS.md Sections

Use only sections that are relevant to the target repo:

- Project Rules
- Project Structure
- Commands and Verification
- Cocos Component Style
- Prefabs, Scenes, and Resources
- Noelle Framework
- Storage / Cloud Sync
- Platform SDK / Runtime Config
- UI / Events / Lifecycle
- Testing / Linting / Build
- Agent Safety Notes

## High-Signal Wording Examples

These are style examples, not facts to copy:

- `Check prefab and scene wiring before assuming a component's lifecycle method runs.`
- `Do not edit framework internals unless the user explicitly asks; prefer business-layer changes.`
- `Before changing bundle names or resource paths, search all load sites and serialized references.`
- `Use the project's existing platform guard style; do not replace it with a new abstraction casually.`
- `Do not invent test/build/lint commands. Record only commands verified from scripts, docs, or CI.`

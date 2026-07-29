# Unity + Vina AGENTS.md Initialization Template

## Purpose

Use this template when creating or updating `AGENTS.md` for Unity (C#) projects that use the **Vina** framework (or the Vina/Platforms/Operation submodule stack). This template is source material and a checklist only. Do not copy it directly. Convert only verified project-specific Unity and Vina rules into the final file. If the repo is Unity but not Vina, use only the generic Unity sections; if it is not Unity, omit this template.

## Extract When Present

### Unity Project Facts

- Exact Unity editor version from `ProjectSettings/ProjectVersion.txt`; if README/CI/version-file disagree, note the conflict instead of guessing.
- Real script/scene/prefab/resource/package/build/cache directories, and which are business code vs framework/vendor/generated.
- Entry flow: bootstrap scene → main → game; where scene-name constants and the startup `MonoBehaviour` live.
- Existing instruction files (`AGENTS.md`, `.cursor/rules/`, `.cursorrules`, `.github/copilot-instructions.md`, Pi/OpenCode/Codex configs).

### Vina Framework Usage

Verify the project uses Vina, then record only the facilities it actually uses:

- Bootstrap: `Setup.VinaInitialize()` (order: `RuntimeData` → `Timer` → `SettingsData` → `UI` → `AssetsManager`) then `Setup.VinaPreload()`; capture the real startup sequence.
- Singletons: `Singleton<T>` (pure C#), `SingletonMono<T>` (MonoBehaviour, `DontDestroyOnLoad`), `SingletonModule<T>` (modules). Gotcha: with Domain Reload disabled, pure-C# singletons persist across Play sessions — reset global state on startup.
- Scenes: `Vina.UserInterface.SceneFlow` (`PreloadScene`/`SwitchScene`/`UnloadScene`). Gotcha: `LoadSceneMode.Single` `SwitchScene` to the already-active scene returns `true` without reloading — rebuild nodes explicitly when needed.
- UI: `UIBase` + `[UIPanel(path, UILayer, AssetCacheMode, multiple)]`; `UI.Open<T>()/Close<T>()/Preload<T>(mode)`; lifecycle `Initialize→Show→Hide` with `RegisterEvents/UnregisterEvents` auto-bound to `OnEnable/OnDisable` (overrides call `base.`).
- Events: `Vina.Events.ClientEvent` (`Register/Dispatch/DispatchSticky/Unregister/UnregisterAll`); target-bound, unregister on destroy, sticky events replay on register.
- Assets/Audio/Log/FSM/Storage: `AssetsManager.LoadAsset<T>(location, cacheMode)` (YooAsset-backed), static `AudioPlayer`, `Logger`/`VinaLog` (gated by `ENABLE_VINALOG`), `FSM<T>`/`FSMState<T>`/`FSMTransition<T>`, `PlayerPrefsExtended` typed wrappers.
- Prefer reusing Vina facilities over building parallel systems.

### Submodules and Framework Boundaries

- Vina/Platforms/Operation as git submodules; install/update via the project's framework script (commonly `vina.sh`); do not edit submodule source or upgrade upstream without explicit ask.
- Keep submodules clean: ignore Unity-generated artifacts that land inside them (e.g. an AssetDatabase-generated `link.xml.meta`) via the submodule's local `.git/info/exclude`, not edits to the submodule.
- Business logic lives outside submodules and connects only through public framework APIs.

### Commands and Verification

Record only verified commands; if absent, say so and do not invent them.

- Build wrapper (e.g. `ci/build.ps1`/`ci/build.sh`) with `-Platform`/`-executeMethod`/`-buildTarget`; Unity path resolution (`-UnityPath` > `UNITY_PATH` > `ProjectVersion.txt`); result/artifact locations.
- Real `Editor.CI.*` execute methods and target platforms (WebGL, WeChat, TikTok, …).
- YooAsset bundle build (e.g. menu `YooAsset → AssetBundle Builder`) and resource server source (e.g. `Assets/Resources/VinaSettings.asset`); rebuild + re-upload when assets change.
- Required scripting defines (`ENABLE_VINALOG`, `DOTWEEN`, `USE_YOOASSET`, `UNITASK_DOTWEEN_SUPPORT`, …) and per-channel defines (`WEIXINMINIGAME`, `DOUYINMINIGAME`, …).
- EditMode/PlayMode tests via Unity Test Runner; note whether agents should avoid auto-running tests/PlayMode/builds unless authorized.

### Agent-Specific Constraints

- Do not edit framework submodule source; manage via `vina.sh`.
- Treat `.unity`/`.prefab`/`.asset`/`.meta` GUIDs and serialized references as high-risk; confirm Inspector/serialized bindings after any component, property, hierarchy, or asset-path change; keep `.meta` (GUIDs).
- One-shot editor scripts that generate or repair assets must delete themselves after running.
- Guard `UniTask`/coroutine callbacks against destroyed nodes, hidden panels, and scene switches.
- Do not start a second Unity process; refresh the running editor to recompile.

## Do Not Copy Directly

- Project/product names, panel names, storage keys, event names.
- Reference/migration repo paths and relationships to other repos.
- Version pins, commit hashes, or license notes belonging to one project.
- Exact coordinate-conversion, timing, or match/round constants from one game's design.
- Assumed Vina APIs, managers, paths, or directory names not present in the target repo.

## Target AGENTS.md Sections

Use only sections that are relevant to the target repo:

- Unity Project Rules
- Project Structure
- Vina Framework
- Submodules and Framework Boundaries
- Commands and Verification
- Testing
- Agent Safety Notes

## High-Signal Wording Examples

These are style examples, not facts to copy:

- `Prefer reusing Vina facilities (UI, ClientEvent, AssetsManager, FSM<T>) over building parallel systems.`
- `Do not edit framework submodules; install via vina.sh and connect only through public APIs.`
- `SceneFlow Single-mode SwitchScene short-circuits when switching to the already-active scene.`
- `Do not invent Unity build/test commands; record only commands verified from scripts, docs, or CI.`

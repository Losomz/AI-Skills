# Godot + Sumeru AGENTS.md Initialization Template

## Purpose

Use this template when creating or updating `AGENTS.md` for Godot 4.x projects that use GDScript and the Sumeru framework. This template is source material and a checklist only. Do not copy it directly. Convert only verified project-specific Godot and Sumeru rules into the final file.

## Extract When Present

### Godot Project Facts

- Godot major/minor version if it is clear from docs, export config, CI, or project metadata.
- `project.godot` settings that affect agents: main scene, Autoloads, enabled plugins, input map, render/export settings, or custom project settings.
- Actual source, scene, UI, resource, addon, export, and test directories used by the project.
- Editor-generated or import/cache directories that agents must not edit directly, especially `.godot/`.

### Scene and Resource Safety

- Whether complex `.tscn` files should be edited only through the Godot editor.
- Rules for keeping `ext_resource`, `sub_resource`, node paths, signal connections, and resource references stable.
- Asset/import constraints such as `.import` files, Godot 4 resource UID files, imported textures/audio/fonts, generated assets, or checked-in import metadata.
- Any project-specific rule around moving, renaming, or deleting scenes, scripts, images, audio, configs, or resources.

### GDScript and Naming Conventions

Verify and summarize actual conventions before writing them:

- File and directory naming, commonly `snake_case`.
- `class_name` naming, commonly `PascalCase`.
- Variable, function, and signal naming, commonly `snake_case`.
- Constants, commonly `UPPER_SNAKE_CASE`.
- Whether scripts require explicit `extends`, typed parameters, typed variables, and return types.
- How the project separates UI logic, gameplay systems, data models, commands, utilities, and app entry logic.

### Godot Structure and Entry Flow

- Real main scene path from `application/run/main_scene`.
- How the startup flow is organized: main scene, app controller, scene manager, UI manager, Autoload singletons, or Sumeru entry objects.
- Where common scenes and UI panels live.
- Whether important scenes have paired same-name scripts.
- Any required route/registry/manager updates after adding a new scene or UI panel.

### Sumeru Framework Usage

Only include Sumeru rules after verifying the project actually uses Sumeru.

- Location and role of `Sumeru/`.
- Existing Sumeru areas such as `Sumeru/Core/`, `Sumeru/ToolKit/`, `Sumeru/UIKit/`, plugins, managers, commands, services, or utilities.
- Sumeru framework directories that should not be refactored or renamed unless explicitly requested.
- Actual base classes used by UI panels, such as `SumeruUIPanel`, and where examples live.
- How project code calls Sumeru APIs; do not invent API names from this template.
- Any rules for extending Sumeru UIKit, ToolKit, commands, service managers, or framework hooks.

### Commands and Verification

Prefer repository-provided commands. If commands are not present, do not invent them.

- Godot editor/headless command paths if documented.
- How to open/import the project safely.
- How to run tests if the repo uses GUT, WAT, custom test scenes, CI scripts, or another framework.
- How to validate export, resource import, code formatting, static checks, or smoke startup.
- Any command that must run from the project root or a specific subdirectory.

### Agent-Specific Constraints

- Do not edit `.godot/` directly.
- Be cautious with `project.godot`; explain impact before changing main scene, Autoload, plugins, input map, render settings, or export settings.
- Avoid hand-editing complex `.tscn` files unless the change is small, mechanical, and follows existing file structure.
- Keep resource paths stable; do not casually rename or move scenes/assets/scripts.
- Read existing Sumeru implementations before extending framework-facing code.
- Do not refactor `Sumeru/` framework code or paths unless the user explicitly asks.

## Do Not Copy Directly

- Example paths such as `scenes/main/main.tscn`, `ui/main_menu/main_menu_panel.tscn`, or `scripts/app/game_app.gd` unless the target project actually uses them.
- Example class names such as `GameApp`, `MainMenuPanel`, or `SumeruUIPanel` unless verified.
- Assumed Sumeru APIs, managers, commands, lifecycle hooks, or directory names that are not present in the target repo.
- Generic Godot advice that does not affect how agents should work in the repository.
- Long tutorials about Godot, GDScript, or Sumeru.

## Target AGENTS.md Sections

Use only sections that are relevant to the target repo:

- Godot Project Rules
- Project Structure
- Scenes and Resources
- GDScript Style
- Sumeru Framework
- Commands and Verification
- Testing
- Agent Safety Notes

## High-Signal Wording Examples

These are style examples, not facts to copy:

- `Do not edit .godot/; it is editor/import cache.`
- `Check project.godot before changing main scene, Autoloads, plugins, or input mappings.`
- `Keep .tscn resource references stable; avoid hand-editing complex scene trees.`
- `Read existing Sumeru/UIKit panels before adding a new UI panel; use the project's actual Sumeru base class.`

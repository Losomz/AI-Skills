---
name: cocos-general
description: Cocos prefab workflow skill. Trigger for prefab creation/rebuild, prefab structural edits (node hierarchy/component mounting/property wiring), and prefab id validation. Do not trigger for TS-only logic changes or tiny Inspector-level property tweaks.
---

# Cocos General

General entry for Cocos development workflows.

V1 implementation scope is intentionally narrow: **Prefab Creation** first, with validation utilities attached.

## Core Usage
1. Create prefab from the built-in stable template.
2. Validate `__id__` graph before opening in Cocos.
3. Open in Cocos Creator and continue Inspector binding.

Use this trigger:
- `$cocos-general`

## Trigger Optimization (When to use / not use)

Use this skill by default when the task includes one or more of the following:
- Creating a new prefab from template or from scratch.
- Rebuilding an existing prefab structure (node hierarchy, component list, serialized refs).
- Adding/removing/mounting script components in prefab JSON.
- Batch prefab edits where `__id__`/`cc.CompPrefabInfo` consistency must be validated.
- Prefab safety checks before opening in Cocos Creator.

Prefer normal coding flow (no skill) when the task is mainly:
- TypeScript business logic changes with no prefab structural work.
- Small script-side behavior fixes that do not touch prefab JSON shape.
- Minor Inspector tweaks already easy to finish in editor (e.g., one-off text copy/color/position update).

## Module A: Prefab Creation (V1 Implemented)

Primary command:

```bash
node skills/cocos-general/scripts/create-prefab-from-template.mjs --output <path/to/new.prefab>
```

CLI contract:
- `--output <path>` required output prefab path.
- `--name <nodeName>` optional root node name (default: output file name).
- `--template <path>` optional custom template path (default: internal template).
- `--with-meta` optional emit `<prefab>.meta` (default: no meta).
- `--backup-suffix <fmt>` optional suffix format for backup when overwriting. Use `{timestamp}` token.

Behavior:
- Uses `assets/templates/node.prefab` as the default source.
- If output exists, script creates backup first, then overwrites.
- Keeps structure minimal and openable (`cc.Prefab`, root `cc.Node`, `cc.PrefabInfo`).

## Validation & UUID Utilities

Validate prefab ids:

```bash
node skills/cocos-general/scripts/validate-prefab-ids.mjs <path-to-prefab>
```

Compress script component uuid:

```bash
node skills/cocos-general/scripts/compress-uuid.mjs <uuid>
```

## Module B: Add Script Component to Prefab (手动挂载组件)

目标：在不打开 Cocos 编辑器的情况下，把一个脚本组件“挂载”到现有 prefab 节点上，用于紧急修复或批量注入调试脚本。

### B.1 前提条件

1. 已有 prefab 文件，例如：
   - `assets/resources/prefabs/perler-help-panel.prefab`
2. 目标脚本已存在且有 `.meta` 文件，例如：
   - `assets/scripts/ui/test.ts`
   - 对应的 `assets/scripts/ui/test.ts.meta` 中有原始 UUID。

### B.2 计算脚本组件的 `__type__`

1. 从 `.meta` 中拿到脚本 UUID，例如：

   ```text
   1fd5d9e7-1d04-495f-92b1-68b2c965ba08
   ```

2. 使用工具压缩为 prefab 可用的 `__type__`：

   ```bash
   node skills/cocos-general/scripts/compress-uuid.mjs 1fd5d9e7-1d04-495f-92b1-68b2c965ba08
   ```

   输出类似：

   ```text
   1fd5dnnHQRJX5KxaLLJZboI
   ```

3. 这个压缩 UUID 就是脚本组件在 prefab JSON 中的 `__type__` 值。

### B.3 理解 prefab 结构（最小必要）

典型 prefab 开头结构（数组索引即 `__id__`）：

```json
[
  {
    "__type__": "cc.Prefab",
    "data": { "__id__": 1 }
  },
  {
    "__type__": "cc.Node",
    "_name": "perler-help-panel",
    "_components": [
      { "__id__": 2 }
    ],
    "_prefab": { "__id__": 4 }
  },
  {
    "__type__": "da42122hE9Pa72T+pR/7hLX",
    "node": { "__id__": 1 },
    "__prefab": { "__id__": 3 }
  },
  {
    "__type__": "cc.CompPrefabInfo",
    "fileId": "..."
  },
  {
    "__type__": "cc.PrefabInfo",
    "root": { "__id__": 1 },
    "asset": { "__id__": 0 }
  }
]
```

要点：

- `__id__ = 1` 是根 `cc.Node`。
- `_components` 数组保存挂在该节点上的组件对象的 `__id__` 引用。
- 每个脚本组件对象都有一个对应的 `cc.CompPrefabInfo` 条目。

### B.4 添加新的脚本组件对象

1. 在 prefab JSON 数组尾部追加一个脚本组件对象，使用上一步的压缩 UUID 作为 `__type__`。例如要把 `Test` 脚本挂到根节点：

```json
{
  "__type__": "1fd5dnnHQRJX5KxaLLJZboI",
  "_name": "",
  "_objFlags": 0,
  "__editorExtras__": {},
  "node": { "__id__": 1 },
  "_enabled": true,
  "__prefab": { "__id__": 6 },
  "autoAddLoader": false,
  "resLoader": null,
  "_id": ""
}
```

2. 紧接着再追加一个 `cc.CompPrefabInfo` 对象：

```json
{
  "__type__": "cc.CompPrefabInfo",
  "fileId": "testCompOnHelpPanel"
}
```

注意：`__prefab.__id__` 的值需要等于该 `cc.CompPrefabInfo` 行在数组中的 `__id__`。

### B.5 把组件挂到目标节点 `_components`

1. 找到要挂载的节点对象（例如根节点，`__id__ = 1`），它应该已有类似字段：

```json
"_components": [
  { "__id__": 2 }
]
```

2. 把新组件对象的 `__id__` 附加进去（假设它是 `5`）：

```json
"_components": [
  { "__id__": 2 },
  { "__id__": 5 }
]
```

这样，这个节点在 Cocos 中打开时会显示两个组件：已有的脚本 + 新挂的脚本。

### B.6 校验与注意事项

1. 修改完成后，使用校验工具验证 `__id__` 图：

```bash
node skills/cocos-general/scripts/validate-prefab-ids.mjs <path-to-prefab>
```

2. 保证以下约束：

- 所有 `node.__id__` 指向的是 `cc.Node`。
- 所有 `__prefab.__id__` 指向的是 `cc.CompPrefabInfo`。
- 所有 `_components[i].__id__` 指向的是脚本或内置组件对象。

3. 稳定性建议：

- 仅在必须时手改 prefab。
- 改动尽量是“追加式”，优先在尾部新增对象，避免打乱已有 `__id__`。
- 如需大改，优先用模板脚本重建，再用本模块做少量组件挂载。

## Stability Notes
- Avoid hand-writing prefab object arrays unless absolutely needed.
- Keep all `__id__` references in range, especially after manual insert/remove.
- Strip BOM before JSON parse in automation scripts.
- Script component `__type__` must use compressed UUID from `.meta`, not raw UUID.

## Large Prefab Generation (Critical)

Do NOT write large prefab JSON directly via file-write tools.
Content is silently truncated when it exceeds the transport token limit, producing broken JSON
that crashes Cocos Creator on open.

**Rule:** For any prefab with more than ~30 objects, write a Python/Node generator script,
execute it, validate, then delete the script.

```bash
python gen_mypanel.py
node .agents/skills/cocos-general/scripts/validate-prefab-ids.mjs assets/resources/ui/MyPanel.prefab
rm gen_mypanel.py
```

See full template: [references/prefab-generation-via-script.md](./references/prefab-generation-via-script.md)

## UI Node Component Completeness (Critical)

Every UI node that participates in Cocos event dispatch MUST have `cc.UITransform`.
Missing UITransform causes `Cannot read properties of null (reading 'cameraPriority')`
and freezes the editor prefab view.

| Node role | Required |
|---|---|
| Button / Toggle node | `cc.UITransform` + `cc.Button`/`cc.Toggle` |
| Toggle Checkmark child | `cc.UITransform` |
| Label node | `cc.UITransform` + `cc.Label` |
| Container / Section | `cc.UITransform` + `cc.Sprite` (or other renderer) |
| Blocker / overlay | `cc.UITransform` + `cc.Sprite` (semi-transparent) |

A node with `cc.UITransform` but **no renderer** also triggers the same error.
Always pair UITransform with at least one renderer on non-logic container nodes.

## References
- Quick start (Chinese): [references/quickstart.zh-CN.md](./references/quickstart.zh-CN.md)
- Module index: [references/module-index.md](./references/module-index.md)
- Deep prefab repair checklist: [references/prefab-rebuild-checklist.md](./references/prefab-rebuild-checklist.md)
- Large prefab generation via script: [references/prefab-generation-via-script.md](./references/prefab-generation-via-script.md)

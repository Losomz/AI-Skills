# Prefab Rebuild Checklist

## 1) Parse and Baseline
- Parse JSON as array.
- Confirm index `0` is `cc.Prefab`.
- Confirm `cc.Prefab.data.__id__` points to a valid root node.

## 2) ID Integrity
- Keep object IDs contiguous (`0..N-1`).
- Keep every `__id__` reference in range.
- Never reuse stale IDs after inserting/removing objects.

## 3) Node Wiring
- Each `cc.Node` needs:
- `_components` referencing existing component objects.
- `_prefab.__id__` referencing a `cc.PrefabInfo` object.
- Explicit transform fields (`_lpos`, `_lrot`, `_lscale`, `_euler`).

## 4) UI Panel Baseline
- Root UI panels generally include:
  - `cc.UITransform` on root.
  - `cc.Widget` on root for full-screen panels.
  - Runtime logic component (custom script) on root.

## 4a) UI Component Completeness (Critical)

Every node that participates in Cocos UI must have `cc.UITransform`. Missing UITransform causes
`Cannot read properties of null (reading 'cameraPriority')` in the editor's `_sortPointerEventProcessorList`.

Required UITransform coverage:

| Node type | Required components |
|---|---|
| `cc.Label` node | `cc.UITransform` + `cc.Label` |
| `cc.Button` node | `cc.UITransform` + `cc.Button` |
| `cc.Toggle` node | `cc.UITransform` + `cc.Toggle` |
| Toggle Checkmark child | `cc.UITransform` (at minimum) |
| Any container / section node | `cc.UITransform` + at least one renderer (`cc.Sprite` or `cc.Label`) |
| Blocker / overlay node | `cc.UITransform` + `cc.Sprite` (semi-transparent) |

**Rule:** A node that has `cc.UITransform` but no renderer (Sprite/Label/Graphics) will still
trigger the cameraPriority null error in the editor. Always pair UITransform with a renderer.

## 4b) Large Prefab Generation

Do NOT write large prefab JSON directly via file-write tools. The content will be silently
truncated when it exceeds the transport token limit, producing a broken JSON file.

**Correct approach:** Write a Python or Node.js generator script, then execute it:

```bash
python gen_myprefab.py
node .agents/skills/cocos-general/scripts/validate-prefab-ids.mjs path/to/prefab.prefab
```

See [prefab-generation-via-script.md](./prefab-generation-via-script.md) for a full template.

## 5) Custom Script Type
- Use compressed UUID in prefab `__type__`.
- Source UUID comes from `<script>.ts.meta` `uuid`.
- Convert with `scripts/compress-uuid.mjs`.

## 6) Runtime-Assigned Visuals
- Keep `_spriteFrame: null` when sprite frame is assigned in script at runtime.
- Keep material fields default unless explicitly required.

## 7) Validate and Open
- Run `scripts/validate-prefab-ids.mjs`.
- Open in Cocos Creator.
- Verify inspector fields are bound and no missing-component errors appear.

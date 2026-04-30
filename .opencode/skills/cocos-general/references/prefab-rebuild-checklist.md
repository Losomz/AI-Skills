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

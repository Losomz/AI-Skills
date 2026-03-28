# Prefab Generation via Script

## Why Script Generation?

When a prefab has more than ~30 objects, writing the JSON directly via a file-write tool
will silently truncate the output when it exceeds the transport token limit.
The resulting file is invalid JSON and will crash Cocos Creator on open.

**Always use a generator script for prefabs with complex node hierarchies.**

---

## Python Generator Template

Write a `gen_<name>.py` script in the project root, execute it, validate, then delete it.

```python
import json

SPRITE_FRAME = '97abdafd-5792-450b-a9fc-1dca4ccae78e@f9941'  # built-in white sprite
SCRIPT_UUID  = '<compressed-uuid-from-meta>'  # compress with compress-uuid.mjs

def N(name, pid, children, comps, pfid, x, y):
    """Create a cc.Node entry."""
    return {
        '__type__': 'cc.Node', '_name': name, '_objFlags': 0, '__editorExtras__': {},
        '_parent': {'__id__': pid} if pid is not None else None,
        '_children': [{'__id__': c} for c in children], '_active': True,
        '_components': [{'__id__': c} for c in comps],
        '_prefab': {'__id__': pfid},
        '_lpos': {'__type__': 'cc.Vec3', 'x': x, 'y': y, 'z': 0},
        '_lrot': {'__type__': 'cc.Quat', 'x': 0, 'y': 0, 'z': 0, 'w': 1},
        '_lscale': {'__type__': 'cc.Vec3', 'x': 1, 'y': 1, 'z': 1},
        '_mobility': 0, '_layer': 33554432,
        '_euler': {'__type__': 'cc.Vec3', 'x': 0, 'y': 0, 'z': 0}, '_id': ''
    }

def U(node_id, pfid, w, h):
    """Create a cc.UITransform entry."""
    return {
        '__type__': 'cc.UITransform', '_name': '', '_objFlags': 0, '__editorExtras__': {},
        'node': {'__id__': node_id}, '_enabled': True, '__prefab': {'__id__': pfid},
        '_contentSize': {'__type__': 'cc.Size', 'width': w, 'height': h},
        '_anchorPoint': {'__type__': 'cc.Vec2', 'x': 0.5, 'y': 0.5}, '_id': ''
    }

def SP(node_id, pfid, r, g, b, a):
    """Create a cc.Sprite entry (use built-in white sprite frame)."""
    return {
        '__type__': 'cc.Sprite', '_name': '', '_objFlags': 0, '__editorExtras__': {},
        'node': {'__id__': node_id}, '_enabled': True, '__prefab': {'__id__': pfid},
        '_customMaterial': None, '_srcBlendFactor': 2, '_dstBlendFactor': 4,
        '_color': {'__type__': 'cc.Color', 'r': r, 'g': g, 'b': b, 'a': a},
        '_spriteFrame': {'__uuid__': SPRITE_FRAME, '__expectedType__': 'cc.SpriteFrame'},
        '_type': 1, '_fillType': 0, '_sizeMode': 0,
        '_fillCenter': {'__type__': 'cc.Vec2', 'x': 0, 'y': 0},
        '_fillStart': 0, '_fillRange': 0, '_isTrimmedMode': True,
        '_useGrayscale': False, '_atlas': None, '_id': ''
    }

def L(node_id, pfid, text, size, bold, align=1):
    """Create a cc.Label entry."""
    return {
        '__type__': 'cc.Label', '_name': '', '_objFlags': 0, '__editorExtras__': {},
        'node': {'__id__': node_id}, '_enabled': True, '__prefab': {'__id__': pfid},
        '_customMaterial': None, '_srcBlendFactor': 2, '_dstBlendFactor': 4,
        '_color': {'__type__': 'cc.Color', 'r': 255, 'g': 255, 'b': 255, 'a': 255},
        '_string': text, '_horizontalAlign': align, '_verticalAlign': 1,
        '_actualFontSize': size, '_fontSize': size,
        '_fontFamily': 'Arial', '_lineHeight': size,
        '_overflow': 0, '_enableWrapText': True,
        '_font': None, '_isSystemFontUsed': True,
        '_spacingX': 0, '_isItalic': False, '_isBold': bold, '_isUnderline': False,
        '_underlineHeight': 2, '_cacheMode': 0, '_enableOutline': False,
        '_outlineColor': {'__type__': 'cc.Color', 'r': 0, 'g': 0, 'b': 0, 'a': 255},
        '_outlineWidth': 2, '_enableShadow': False,
        '_shadowColor': {'__type__': 'cc.Color', 'r': 0, 'g': 0, 'b': 0, 'a': 255},
        '_shadowOffset': {'__type__': 'cc.Vec2', 'x': 2, 'y': 2},
        '_shadowBlur': 2, '_id': ''
    }

def BT(node_id, pfid):
    """Create a cc.Button entry."""
    C = {'__type__': 'cc.Color'}
    return {
        '__type__': 'cc.Button', '_name': '', '_objFlags': 0, '__editorExtras__': {},
        'node': {'__id__': node_id}, '_enabled': True, '__prefab': {'__id__': pfid},
        'clickEvents': [], '_interactable': True, '_transition': 1,
        '_normalColor': {**C, 'r': 255, 'g': 255, 'b': 255, 'a': 255},
        '_hoverColor': {**C, 'r': 211, 'g': 211, 'b': 211, 'a': 255},
        '_pressedColor': {**C, 'r': 192, 'g': 192, 'b': 192, 'a': 255},
        '_disabledColor': {**C, 'r': 124, 'g': 124, 'b': 124, 'a': 255},
        '_normalSprite': None, '_hoverSprite': None,
        '_pressedSprite': None, '_disabledSprite': None,
        '_duration': 0.1, '_zoomScale': 1.2,
        '_target': {'__id__': node_id}, '_id': ''
    }

def TG(node_id, pfid, checkmark_id):
    """Create a cc.Toggle entry."""
    C = {'__type__': 'cc.Color'}
    return {
        '__type__': 'cc.Toggle', '_name': '', '_objFlags': 0, '__editorExtras__': {},
        'node': {'__id__': node_id}, '_enabled': True, '__prefab': {'__id__': pfid},
        'clickEvents': [], '_interactable': True, '_transition': 1,
        '_normalColor': {**C, 'r': 255, 'g': 255, 'b': 255, 'a': 255},
        '_hoverColor': {**C, 'r': 211, 'g': 211, 'b': 211, 'a': 255},
        '_pressedColor': {**C, 'r': 192, 'g': 192, 'b': 192, 'a': 255},
        '_disabledColor': {**C, 'r': 124, 'g': 124, 'b': 124, 'a': 255},
        '_normalSprite': None, '_hoverSprite': None,
        '_pressedSprite': None, '_disabledSprite': None,
        '_duration': 0.1, '_zoomScale': 1.2,
        '_target': {'__id__': node_id},
        'isChecked': True, 'checkMark': {'__id__': checkmark_id}, '_id': ''
    }

def W(node_id, pfid):
    """Create a full-screen cc.Widget entry."""
    return {
        '__type__': 'cc.Widget', '_name': '', '_objFlags': 0, '__editorExtras__': {},
        'node': {'__id__': node_id}, '_enabled': True, '__prefab': {'__id__': pfid},
        '_alignFlags': 45, '_target': None,
        '_left': 0, '_right': 0, '_top': 0, '_bottom': 0,
        '_horizontalCenter': 0, '_verticalCenter': 0,
        '_isAbsLeft': True, '_isAbsRight': True,
        '_isAbsTop': True, '_isAbsBottom': True,
        '_isAbsHorizontalCenter': True, '_isAbsVerticalCenter': True,
        '_originalWidth': 720, '_originalHeight': 1280,
        '_alignMode': 2, '_lockFlags': 0, '_id': ''
    }

def PI(root_id, asset_id, file_id):
    """Create a cc.PrefabInfo entry (for nodes)."""
    return {
        '__type__': 'cc.PrefabInfo',
        'root': {'__id__': root_id}, 'asset': {'__id__': asset_id},
        'fileId': file_id, 'instance': None,
        'targetOverrides': None, 'nestedPrefabInstanceRoots': None
    }

def CF(file_id):
    """Create a cc.CompPrefabInfo entry (for components)."""
    return {'__type__': 'cc.CompPrefabInfo', 'fileId': file_id}

# Build the data array
d = [
    # 0 - cc.Prefab (always first)
    {'__type__': 'cc.Prefab', '_name': 'MyPanel', '_objFlags': 0,
     '__editorExtras__': {}, '_native': '',
     'data': {'__id__': 1}, 'optimizationPolicy': 0, 'persistent': False},

    # 1 - Root node
    N('MyPanel', None, [2], [3, 4, 5], 6, 0, 0),

    # ... add more nodes and components here ...

    # Last entries: Root PrefabInfo
    PI(1, 0, 'my-panel-root'),
]

with open('assets/resources/ui/MyPanel.prefab', 'w', encoding='utf-8') as f:
    json.dump(d, f, ensure_ascii=False, indent=2)
print('Done, entries:', len(d))
```

---

## Workflow

1. Write `gen_<name>.py` in project root
2. Run: `python gen_<name>.py`
3. Validate: `node .agents/skills/cocos-general/scripts/validate-prefab-ids.mjs <path>`
4. If validation fails, fix the script and re-run
5. Delete the generator script: `rm gen_<name>.py`
6. Open in Cocos Creator to confirm

---

## Critical Rules for UI Prefabs

### Every interactive node needs UITransform

| Node role | Required components |
|---|---|
| Button node | `cc.UITransform` + `cc.Button` |
| Toggle node | `cc.UITransform` + `cc.Toggle` |
| Toggle Checkmark | `cc.UITransform` (minimum) |
| Label node | `cc.UITransform` + `cc.Label` |
| Section/container | `cc.UITransform` + `cc.Sprite` (or other renderer) |
| Blocker/overlay | `cc.UITransform` + `cc.Sprite` (semi-transparent, e.g. a=180) |

### Missing UITransform symptoms

If any UI node is missing `cc.UITransform`, the editor will throw:
```
Cannot read properties of null (reading 'cameraPriority')
  at PointerEventDispatcher._sortPointerEventProcessorList
```
This also causes the prefab to freeze/crash the editor on mouse move.

### Nodes with UITransform but no renderer also trigger cameraPriority errors

A node that has `cc.UITransform` but zero renderer components (no Sprite, no Label, no Graphics)
will still trigger the same error. Always pair UITransform with at least one renderer on
non-logic container nodes.

---

## ID Layout Best Practices

- Plan IDs on paper before coding: list every node and every component with its sequential ID.
- Nodes come before their components in the array (components reference back to node ID).
- Put all `cc.PrefabInfo` and `cc.CompPrefabInfo` entries at the end (high ID range).
- After inserting new objects, re-run `validate-prefab-ids.mjs` to catch broken references.
- Never leave the array truncated - always end with `]`.

# Script Component Workflow: 手动向 Prefab 挂载脚本组件

## Overview

本模块说明如何在 **不打开 Cocos Creator 编辑器 UI** 的情况下，通过直接编辑 `.prefab` JSON 为某个节点挂载脚本组件。

典型使用场景：
- 热修复：线上 prefab 结构轻微损坏，需要补挂一个脚本做保护或日志。
- 批量操作：一次性给一批 prefab 根节点挂上调试组件（如日志、统计）。
- CI/自动化：在构建或校验阶段自动修补 prefab，而不依赖图形界面。

> 警告：手改 prefab 有风险，务必在版本控制下操作，并严格遵守本文的校验步骤。

## Inputs

在开始之前，需要准备：

1. 目标 prefab 路径
   - 示例：`assets/resources/prefabs/perler-help-panel.prefab`
2. 目标脚本及其 `.meta`
   - 示例：
     - 脚本：`assets/scripts/ui/Noelle_Component_TypeScript.ts`
     - Meta：`assets/scripts/ui/Noelle_Component_TypeScript.ts.meta`
   - 从 `.meta` 中可以拿到脚本的原始 UUID。
3. Node `__id__` 信息
   - 需要知道要挂载到哪个节点（一般是根节点 `__id__ = 1`）。

## Step-by-step

### 1) 从 `.meta` 取得脚本 UUID 并压缩

1. 打开脚本对应的 `.meta` 文件，找到 `uuid` 字段，例如：

   ```json
   {
     "uuid": "ea1a7d34-42b5-4e42-9284-c26d9f522a5b",
     "importer": "typescript",
     ...
   }
   ```

2. 使用 `compress-uuid` 工具将其压缩为 prefab 使用的 `__type__` 值：

   ```bash
   node skills/cocos-general/scripts/compress-uuid.mjs ea1a7d34-42b5-4e42-9284-c26d9f522a5b
   ```

   输出示例：

   ```text
   ea1a700QrVOQpKEwm2fUipb
   ```

   记下这个压缩字符串，后续会作为组件对象的 `__type__`。

### 2) 理解最小 prefab 结构

打开目标 prefab，可以看到类似结构（只保留关键部分）：

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

关键点：

- `__id__ = 1` 的对象是根 `cc.Node`；它的 `_components` 保存挂载到该节点上的“组件对象的 __id__ 引用”。
- 每个脚本组件对象都有一个对应的 `cc.CompPrefabInfo` 条目，通过 `__prefab.__id__` 关联。

### 3) 追加脚本组件对象

1. 在 prefab 数组尾部追加一个脚本组件对象，`__type__` 使用压缩后的 UUID。
2. `node.__id__` 设置为要挂载的节点（示例为根节点 1）。
3. `_enabled` 一般为 `true`。
4. `__prefab.__id__` 指向稍后追加的 `cc.CompPrefabInfo` 条目的 `__id__`。

示例（字段可根据脚本定义调整）：

```json
{
  "__type__": "ea1a700QrVOQpKEwm2fUipb",
  "_name": "",
  "_objFlags": 0,
  "__editorExtras__": {},
  "node": { "__id__": 1 },
  "_enabled": true,
  "__prefab": { "__id__": 8 },
  "_id": ""
}
```

紧接着再追加对应的 `cc.CompPrefabInfo`：

```json
{
  "__type__": "cc.CompPrefabInfo",
  "fileId": "noelleCompOnHelpPanel"
}
```

注意：

- 上面示例中组件对象的 `__id__` 假设为 7，对应的 `cc.CompPrefabInfo` 为 8，因此 `__prefab.__id__` 需要写成 8。
- 实际索引以 prefab 数组中所在位置为准。

### 4) 把新组件挂到目标节点 `_components`

找到目标节点（例如根节点）对象的 `_components` 字段，原来可能是：

```json
"_components": [
  { "__id__": 2 },
  { "__id__": 5 }
]
```

其中：
- `2` 可能是原来的 UI 脚本组件（如 `PerlerHelpPanel`）。
- `5` 可能是之前挂载的测试组件。

现在把新的脚本组件 `__id__` 也追加进去（假设是 7）：

```json
"_components": [
  { "__id__": 2 },
  { "__id__": 5 },
  { "__id__": 7 }
]
```

至此，从结构上看，目标节点已经同时挂载了三个脚本组件。

### 5) 保存并使用校验脚本验证

保存 prefab 之后，务必跑一次校验脚本：

```bash
node skills/cocos-general/scripts/validate-prefab-ids.mjs assets/resources/prefabs/perler-help-panel.prefab
```

期望输出包含：

- `[OK] .../perler-help-panel.prefab`
- `all __id__ references are in range`

如果出现错误（索引越界、指向错误类型等），应回退修改或重新调整 `__id__` / 引用关系。

## Examples

以本项目的 `perler-help-panel.prefab` 为例：

- 原始状态：
  - 根节点 `_components` 包含 `__id__` 2（`PerlerHelpPanel`）。
- 通过本文步骤：
  - 先手工挂载了测试脚本（`__id__` 5）。
  - 再挂载 `Noelle_Component_TypeScript`（`__id__` 7）。
- 最终根节点 `_components` 为：

```json
"_components": [
  { "__id__": 2 },
  { "__id__": 5 },
  { "__id__": 7 }
]
```

打开 prefab 时，根节点会显示三个脚本组件。

## Gotchas

- 不要随便重排或删除中间对象：
  - Prefab 使用数组索引作为 `__id__`，插入/删除中间元素会让后续所有 `__id__` 发生变化，极易导致大量引用失效。
  - 建议所有新增对象都追加在数组尾部。
- 保持 `__id__` 和引用一致：
  - 新增组件对象的真实 `__id__` 取决于在数组中的位置，要与 `_components.__id__`、`__prefab.__id__` 严格对应。
- 优先用版本控制保护：
  - 修改前确保文件在 Git 里有干净版本，出错可以一键回滚。
- 大范围重建时考虑用模板脚本：
  - 如果 prefab 结构本身已经严重损坏，优先用 `create-prefab-from-template.mjs` 等脚本重建最小结构，再用本模块的步骤只做“少量挂载”。


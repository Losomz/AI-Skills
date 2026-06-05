# Cocos General 快速上手（Prefab 创建）

## 最短流程

1. 创建一个新的 prefab（使用默认内置模板）：

```bash
node skills/cocos-general/scripts/create-prefab-from-template.mjs --output assets/resources/prefabs/demo.prefab
```

2. 校验结构和 `__id__`：

```bash
node skills/cocos-general/scripts/validate-prefab-ids.mjs assets/resources/prefabs/demo.prefab
```

3. 打开 Cocos Creator，确认 prefab 可以正常反序列化、在检查器中无报错。

## 常用命令

```bash
# 指定根节点名称
node skills/cocos-general/scripts/create-prefab-from-template.mjs --output assets/resources/prefabs/demo.prefab --name DemoRoot

# 目标已存在时自动备份再覆盖（默认行为），可以自定义备份后缀
node skills/cocos-general/scripts/create-prefab-from-template.mjs --output assets/resources/prefabs/demo.prefab --backup-suffix 'bak.{timestamp}'

# 按需生成 .meta
node skills/cocos-general/scripts/create-prefab-from-template.mjs --output assets/resources/prefabs/demo.prefab --with-meta

# 组件脚本 UUID 压缩
node skills/cocos-general/scripts/compress-uuid.mjs 4aa1b00e-9f95-49e5-98ed-67212fb4f0aa
```

## 常见坑与排查

- `__id__` 越界：先跑 `validate-prefab-ids.mjs`，报错后优先回到模板重建。
- BOM 导致解析异常：脚本已内置去 BOM，手工改文件时避免编辑器写入 BOM。
- 脚本 `__type__` 填错：必须使用压缩后的 UUID，而不是 `.meta` 里的原始 UUID。
- `.meta` 何时需要：默认不生成，交给 Cocos 导入即可；只有在你明确要预置 meta 时再加 `--with-meta`。



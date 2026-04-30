# Changelog

## 2026-04-30 - 多 AI 工具支持

### 重大改造

- 从通用配置改为针对每个 AI 工具的专用配置
- 新增 `.opencode/` 目录，包含 OpenCode 专用的 skills 和 commands
- 保留 `.agents/` 作为通用规则源

### 新增功能

- CLI 支持选择目标 AI 工具（OpenCode / Cursor / Windsurf）
- 同步时根据选择的工具，从对应目录同步配置
- 添加 `commit.md` command 到 OpenCode 配置

### 目录结构

```
AgentFramework/
├─ .agents/           # 通用规则源（保留）
├─ .opencode/         # OpenCode 专用配置 ✅
├─ .cursor/           # Cursor 专用配置（规划中）
├─ .windsurf/         # Windsurf 专用配置（规划中）
├─ runtime/           # CLI 工具
└─ packages/          # npm 包
```

### CLI 使用

```bash
# 交互式菜单
npm run menu

# 命令行参数
npm run menu -- --pull-template=cocos-developer-template --tool=opencode
```

### 下一步计划

- [ ] 添加 Cursor 专用配置
- [ ] 添加 Windsurf 专用配置
- [ ] 为每个工具添加更多 commands

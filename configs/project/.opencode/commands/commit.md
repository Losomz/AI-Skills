---
description: git commit and push
agent: general
---

commit and push

使用中文编写提交信息。

提交信息格式要求：
- 按照 gitmoji 规范 + 约定式提交（Conventional Commits）规范编写提交信息。
- 使用 `{emoji} type(scope): description` 格式，例如：`✨ feat(agent): 支持同步 OpenCode 配置`。
- 主题开头选择 gitmoji 规范中最合适的 emoji。
- type 选择 Angular 提交规范中合适的类型。
- scope 使用受影响模块、目录或功能名；如果范围不明确，可以省略括号。
- description 使用中文，说明“为什么”做这个改动，而不是只写“做了什么”。
- 主题行长度控制在 72 个字符以内。
- 避免泛泛而谈，要具体说明用户可见的改动。
- 如果代码差异较为复杂，请包含正文段落，解释变更动机及具体改动内容。

常用 type 注释：
- `feat`：新增功能或用户可见能力。
- `fix`：修复 bug 或错误行为。
- `docs`：仅修改文档、说明或注释。
- `style`：不影响逻辑的格式调整。
- `refactor`：不新增功能也不修 bug 的代码重构。
- `perf`：性能优化。
- `test`：新增或调整测试。
- `build`：构建系统、依赖或打包配置变更。
- `ci`：CI/CD 配置或流程变更。
- `chore`：维护性杂项变更。
- `revert`：回滚历史提交。

如果有冲突，不要尝试修复，通知我手动处理。

## 子模块处理规则

如果 `git status` 显示子模块有修改（如 `modified: assets/scripts/sumeru (modified content, untracked content)`），必须：
1. 先进入子模块目录
2. 提交并推送子模块的改动
3. 返回主仓库
4. 再提交并推送主仓库的改动（包括子模块指针更新）

执行顺序：
```bash
# 1. 检查子模块状态
cd assets/scripts/sumeru && git status

# 2. 如果子模块有改动，先提交推送子模块
cd assets/scripts/sumeru
git add -A
git commit -m "..."
git push

# 3. 返回主仓库，提交推送主仓库
cd ../../..
git add .
git commit -m "..."
git push
```

## GIT DIFF

!`git diff`

## GIT DIFF --cached

!`git diff --cached`

## GIT STATUS --short

!`git status --short`

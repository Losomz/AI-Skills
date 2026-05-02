---
description: git commit and push
agent: general
---

commit and push

使用中文编写提交信息。

提交信息格式要求：
- 包含类型前缀，如：feat:、fix:、refactor:、docs:、chore:、test: 等
- 说明"为什么"做这个改动，而不是"做了什么"
- 避免泛泛而谈，要具体说明用户可见的改动

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

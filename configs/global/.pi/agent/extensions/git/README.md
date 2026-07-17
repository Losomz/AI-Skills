# Git Extension

Layered Git command for Pi.

## Commands

- `/git` - choose a Git operation from a menu with descriptions.
- `/git commit` - 后台启动使用 `General` profile 的 Pi 进程，并询问可选的核心要求。
- `/git commit ...核心要求` - 直接把后续文本作为本次提交要求，不再弹输入框。
- `/git pull` - pull from the current branch with dirty-tree handling.
- `/git branch` - switch or create branches.

## Architecture

```
git/
├── index.ts              # 入口：自动发现 operations/ 下的操作模块
├── commit-operation.ts   # 后台 commit 生命周期与通知
├── prompts/
│   └── commit.md         # Git 工作规则模板
├── operations/
│   ├── commit.ts         # /git commit 运行时依赖装配
│   ├── pull.ts           # /git pull
│   └── branch.ts         # /git branch
├── tests/
│   └── commit.test.ts
└── README.md
```

**index.ts 启动时自动扫描 `operations/` 目录**，加载所有导出 `{ value, label, description, handle }` 的模块。

### 添加新操作

1. 在 `operations/` 下新建文件（如 `stash.ts`）
2. 导出一个对象：
   ```typescript
   export default {
     value: "stash",
     label: "stash",
     description: "暂存或恢复工作区改动",
     async handle(pi, ctx) { ... },
     getCompletions?(prefix) { ... },  // 可选
   };
   ```
3. 完成。不需要修改 index.ts。

## Operations

### commit

`/git commit` resolves the bundled `General` profile and passes its model, tools, and base system prompt to the shared process runner. Git-specific rules come from `prompts/commit.md`. The command returns after launch, shows PID and elapsed time in one temporary widget, and sends a notification when the process ends.

The process runs with `--mode json -p --no-session` in the current `ctx.cwd`. It performs the workflow with **sub-repo first** ordering:

1. **Discover sub-repos**: `git submodule status` + scan for nested `.git` directories
2. **Commit sub-repos** (deepest path first)
3. **Commit main repo** (picks up sub-repo reference updates)
4. Report conflicts, empty changes, commit failures, or push failures through the completion notification and stderr

Only one background commit can run in a Pi instance at a time. This does not create a worktree; the process intentionally commits and pushes the real workspace.

Examples:

```text
/git commit
/git commit 这次只提交配置调整
/git commit 提交前先确认 changelog 规则
```

### pull

Checks whether the repository has uncommitted changes. If dirty, it asks whether to:

- stash changes and pull
- discard local changes and pull (via `git reset --hard HEAD` + `git clean -fd`)
- commit changes first
- cancel

After a successful pull, it can restore the auto-created stash.

### branch

Shows current branch and lists all local and remote branches. Supports:

- **切换本地分支** — `git checkout <branch>`
- **从远程分支创建本地跟踪分支** — `git checkout -b <local> <remote>`
- **创建新分支** — `git checkout -b <name>`
- 如果工作区有未提交改动，提供 stash 或丢弃选项

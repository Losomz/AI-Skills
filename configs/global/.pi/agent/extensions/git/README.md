# Git Extension

Layered Git command for Pi.

## Commands

- `/git` - choose a Git operation from a menu with descriptions.
- `/git commit` - start an ephemeral Pi subprocess with the default commit agent (`General`); prompts for an optional core standard before launch.
- `/git commit <agent>` or `/git commit --agent <agent>` - use a specific agent in the isolated subprocess.
- `/git commit ...核心要求` - 在不指定 agent 的情况下，把后面的内容作为本次提交的核心标准传给提交流程，不再弹输入框。
- `/git commit <agent> ...核心要求` - 指定 subagent 的同时，附加本次提交核心标准，不再弹输入框。
- `/git pull` - pull from the current branch with dirty-tree handling.
- `/git branch` - switch or create branches.

## Architecture

```
git/
├── index.ts          # 入口：自动发现 operations/ 下的操作模块
├── operations/
│   ├── commit.ts     # /git commit
│   ├── pull.ts       # /git pull
│   └── branch.ts     # /git branch
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

Calls `runAgentInIsolatedProcess()` directly from the command handler. The runner starts a separate Pi process with `--mode json -p --no-session`, applies the selected agent's prompt/model/tools, and waits for it to finish.

The command never calls `pi.sendUserMessage()`, `pi.sendMessage()`, or `pi.appendEntry()`. Progress and the final child summary are shown only through Pi UI status/notifications (or stderr in headless mode), so no delegation prompt, tool call, tool result, or summary is added to the parent conversation context.

If no inline core requirement is provided, `/git commit` first opens an optional input box. Leaving it empty uses the default workflow; entering text makes that content the core standard for change selection, analysis, and commit message generation.

The child process performs the entire workflow with **sub-repo first** ordering:

1. **Discover sub-repos**: `git submodule status` + scan for nested `.git` directories
2. **Commit sub-repos** (deepest path first)
3. **Commit main repo** (picks up sub-repo reference updates)
4. Report conflicts, empty changes, commit failures, or push failures through a UI-only notification

Default commit agent: `General`.

This is **conversation isolation, not worktree isolation**: the child has an ephemeral context/session but intentionally operates on the same `ctx.cwd` workspace so it can commit and push the real repository changes. The final report is not persisted in the parent session.

Examples:

```text
/git commit
/git commit 这次只提交配置调整
/git commit General 这次提交前先确认 changelog 规则
/git commit --agent General 这次提交只处理 blog 配置
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

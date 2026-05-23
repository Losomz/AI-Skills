# Git Extension

Layered Git command for Pi.

## Commands

- `/git` - choose a Git operation from a menu.
- `/git commit` - delegate the entire commit workflow to the default commit subagent (`General`) without inspecting status or diff in the main agent.
- `/git commit <agent>` or `/git commit --agent <agent>` - use a specific subagent for the commit workflow.
- `/git commit ...额外要求` - 在不指定 agent 的情况下，把后面的内容作为本次特殊要求传给提交流程。
- `/git commit <agent> ...额外要求` - 指定 subagent 的同时，附加本次特殊要求。
- `/git pull` - pull from the current branch with dirty-tree handling。

## Design

This extension keeps Git operations under a single top-level `/git` command so slash-command filtering stays clean.

## Operations

### commit

Sends a fixed delegation template to the main agent that instructs it to immediately call the `subagent` tool.

The main agent does **not** inspect git state, read diffs, generate commit messages, or run git write commands. The selected subagent performs the entire workflow:

- check `git status --short`
- inspect `git diff --cached` and `git diff`
- generate a Chinese gitmoji + Conventional Commits message
- run `git add -A`, `git commit`, and `git push`
- report conflicts, empty changes, commit failures, or push failures

Default commit subagent: `General`.

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
- commit changes first
- cancel

After a successful pull, it can restore the auto-created stash.

# Blog Extension

Layered `/blog` command for running file-based project log workflows from Git history.

## Commands

- `/blog` - choose a blog/log workflow from discovered files; menu entries include workflow descriptions.
- `/blog product` - run `workflows/product.md`（面向消费者/玩家/用户的产品级更新日志；默认提交、打版本标签并推送）。
- `/blog tech` - run `workflows/tech.md`（面向技术人员的技术变更日志；默认提交、打版本标签并推送）。
- `/blog release` - run `workflows/release.md`（按目标仓库既有契约生成发布说明、合并发布分支、推送标签并触发标签驱动 CI）。
- `/blog work` - run `workflows/work.md`（面向公司内部的工作日志；默认提交并推送，不打版本标签）。
- `/blog product ...核心标准` - 生成产品日志时把后面的内容作为核心标准，不再弹输入框。
- `/blog tech ...核心标准` - 生成技术日志时把后面的内容作为核心标准，不再弹输入框。
- `/blog release ...核心标准` - 发布时把后面的内容作为项目名、版本、远端、分支、发布说明、标签、CI 约束或 `no-push` 等核心标准，不再弹输入框。
- `/blog work ...核心标准` - 生成工作日志时把后面的内容作为核心标准，不再弹输入框。

Aliases are declared in each workflow file's frontmatter.

When no inline core standard is provided, the selected workflow opens an optional input box. Leaving it empty uses the workflow defaults; entering text makes that content the core standard for log filtering, summary angle, writing style, and content selection.

## Structure

```text
blog/
├── index.ts              # Discovers workflows and delegates execution
├── common/
│   └── pre-commit.md     # Shared pre-log Git settlement prompt
└── workflows/
    ├── product.md        # Product/user-facing changelog workflow
    ├── release.md        # Repository-aware release/tag/CI workflow
    ├── tech.md           # Technical changelog workflow
    └── work.md           # Internal worklog workflow
```

## Design

`index.ts` intentionally does not hardcode product/tech/release/work behavior. It only:

1. Scans `workflows/*.md`.
2. Parses frontmatter:
   - `name`
   - `description`
   - `aliases`
   - `agent`
   - `preCommit`
   - `preCommitAgent`
   - `confirmDirtyWorktree`
3. Shows discovered workflows in `/blog` selection and completions.
4. Finds a workflow by `name` or `aliases`.
5. Builds a `subagent` chain:
   - optional shared `common/pre-commit.md`
   - selected workflow body
   - 用户核心标准会同时传给 pre-commit 与选中的工作流，确保 `no-push` 等约束覆盖整个 chain
6. Sends that chain prompt to the active Pi agent.

All behavior differences are prompt-file polymorphism. To add a new workflow, add a new markdown file under `workflows/`; no TypeScript change should be needed.

## Workflow Frontmatter

Example:

```markdown
---
name: product
description: 面向消费者/玩家/用户的产品级更新日志；默认提交、打版本标签并推送
aliases: products,consumer,player,user,release,changelog,产品,用户,玩家,发布,更新日志
agent: General
preCommit: true
preCommitAgent: General
---

Workflow prompt body...
```

Fields:

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | no | file basename | Workflow command name |
| `description` | no | name | Text shown in completions/menu |
| `aliases` | no | none | Comma-separated alternate names |
| `agent` | no | `General` | Subagent used for the workflow body |
| `preCommit` | no | `true` | Whether to run `common/pre-commit.md` first |
| `preCommitAgent` | no | `General` | Subagent used for pre-commit |
| `confirmDirtyWorktree` | no | `false` | When true, require UI approval before delegating a dirty worktree to pre-commit; without UI, stop |

## Default Workflows

| Workflow | Target file | Commit | Tag | Push |
|----------|-------------|--------|-----|------|
| `product` | `docs/CHANGELOG.md` | yes | yes | yes |
| `tech` | `docs/TECH_CHANGELOG.md` | yes | yes | yes |
| `release` | detected from repository evidence or supplied by user | yes | yes | yes |
| `work` | `docs/WORKLOG.md` | yes | no | yes |

These defaults live in the markdown workflow prompts, not in `index.ts`.

## Safety Model

Safety is enforced by prompt boundaries:

- `common/pre-commit.md` settles existing worktree changes before log generation.
- A workflow with `confirmDirtyWorktree: true` asks for explicit approval before that settlement when the worktree is dirty; headless runs stop instead.
- Each workflow prompt defines its own target file and Git behavior.
- The log stage should only stage and commit its target log file.
- Product, tech, and release workflows create and push version tags by default.
- Release resolves project name, remote, branches, release-note path, tag convention, CI trigger, and artifact wording from user input or repository evidence; unresolved values stop the release with a rerun hint.
- Release pushes the source and release branches before creating the tag on the final release-branch commit. A successful tag push means CI should be triggered only when the inspected configuration proves a match; it does not mean the build succeeded.
- Worklog commits and pushes by default but does not create a tag.
- Use explicit user instructions such as `no-push`, `不推送`, or `不要 push` to suppress every pre-commit, branch, and tag push in the chain.

# Blog Extension

Layered `/blog` command for running file-based project log workflows from Git history.

## Commands

- `/blog` - choose a blog/log workflow from discovered files; menu entries include workflow descriptions.
- `/blog product` - run `workflows/product.md`（面向消费者/玩家/用户的产品级更新日志；默认提交、打版本标签并推送）。
- `/blog tech` - run `workflows/tech.md`（面向技术人员的技术变更日志；默认提交、打版本标签并推送）。
- `/blog release` - run `workflows/release.md`（面向 GitHub Release 的发布说明；默认写入 `docs/releases/<version>.md`、提交、打版本标签并推送）。
- `/blog work` - run `workflows/work.md`（面向公司内部的工作日志；默认提交并推送，不打版本标签）。
- `/blog product ...核心标准` - 生成产品日志时把后面的内容作为核心标准，不再弹输入框。
- `/blog tech ...核心标准` - 生成技术日志时把后面的内容作为核心标准，不再弹输入框。
- `/blog release ...核心标准` - 生成 GitHub Release 发布说明时把后面的内容作为核心标准，不再弹输入框。
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
    ├── release.md        # GitHub Release notes workflow
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
3. Shows discovered workflows in `/blog` selection and completions.
4. Finds a workflow by `name` or `aliases`.
5. Builds a `subagent` chain:
   - optional shared `common/pre-commit.md`
   - selected workflow body
   - 用户核心标准会作为附加输入传给工作流
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

## Default Workflows

| Workflow | Target file | Commit | Tag | Push |
|----------|-------------|--------|-----|------|
| `product` | `docs/CHANGELOG.md` | yes | yes | yes |
| `tech` | `docs/TECH_CHANGELOG.md` | yes | yes | yes |
| `release` | `docs/releases/<version>.md` | yes | yes | yes |
| `work` | `docs/WORKLOG.md` | yes | no | yes |

These defaults live in the markdown workflow prompts, not in `index.ts`.

## Safety Model

Safety is enforced by prompt boundaries:

- `common/pre-commit.md` settles existing worktree changes before log generation.
- Each workflow prompt defines its own target file and Git behavior.
- The log stage should only stage and commit its target log file.
- Product, tech, and release workflows create and push version tags by default.
- Release workflow writes `docs/releases/<version>.md`, which can be used by GitHub Actions as Release body.
- Worklog commits and pushes by default but does not create a tag.
- Use explicit user instructions such as `no-push`, `不推送`, or `不要 push` when a workflow should skip pushing.

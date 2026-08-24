# DSH Git

`dsh-agentframework-git` is a full-stack DeepSeek Harness plugin for local Git status, diff, staging, unstaging, and commit workflows.

## Requirements

- Node.js `^22.19.0` or `>=24`
- DeepSeek Harness `0.1.1-rc.2`
- Git available on the Host `PATH`

The browser never executes Git. The Host resolves the requested `workspaceId` through `ctx.workspaceRegistry`, canonicalizes the repository root, and rejects repositories outside the selected workspace. Commands use argument arrays with `shell: false`; file pathspecs are repository-relative and validated again on the Host.

## Development

```powershell
cd packages/dsh-git
pnpm install
pnpm check
```

Install the built package into a DSH Web profile so the Host and Client halves are both discoverable:

```powershell
pnpm dsh plugin --profile web add D:\UGit\AgentFramework\packages\dsh-git
pnpm dsh web
```

A source-only `--patch` entry can load the Host half, but it does not expose the package-level `dsh.client` manifest. Use profile installation when testing the Source Control UI.

## UI

The Client registers one additive `sidebar.footer.action` entry. Its trigger opens a fixed Source Control panel with:

- branch and repository status
- staged and unstaged file groups
- text diff preview
- file-level stage and unstage actions
- local commit of staged changes

## Remote API

The generated strict Typert contribution exposes the `sourceControl` namespace:

- `repositoryInfo(workspaceId)`
- `status(workspaceId)`
- `diff({ workspaceId, path, staged })`
- `stage({ workspaceId, paths })`
- `unstage({ workspaceId, paths })`
- `commit({ workspaceId, message })`

`tsdown` runs the official `@deepseek-ai/dsh-typert-generator` plugin during the Host build and emits `lib/typert.host.*` plus `lib/typert.remote-client.*`. The Client mounts that generated contribution before registering its UI.

## Known Limitations

- The first release operates on one Git repository rooted at or below the current registered workspace.
- Parent repositories, nested repository orchestration, submodules, worktrees, branch management, pull, push, discard, and partial-line staging are not implemented.
- Diff display is limited to 512 KiB per request. Binary files receive a non-text fallback.
- Git hooks may run during commit. Interactive credential prompts are disabled, and commit signing is disabled for the non-interactive UI operation.
- File watching is not installed; use Refresh after external changes.

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

The Client registers an additive `conversation.session.header.utilities` entry. Its trigger opens a viewport-fixed Source Control panel at the top right. The panel provides:

- real staged and unstaged file status for the current workspace repository
- structured text diffs for `HEAD -> index` and `index -> worktree`
- explicit binary and oversized-diff states, with a 512 KiB transport limit
- per-file staging and unstaging
- an editable commit-message field
- local commit of already-staged changes
- one-click AI commit-message generation from the staged patch

The Sparkle action sends the staged patch and the optional text already in the field to the model configured as the DSH default. It uses one independent `ctx.llm.stream()` call: it does not create an Agent or Session, read conversation history, or add messages to the current conversation. The staged patch leaves the Host only after the user clicks the action and is limited to 200 KB before model dispatch.

## Host RPC

The Host registers the loopback-only `/dsh-git` Connection RPC channel:

- `status({ workspaceId })`
- `diff({ workspaceId, path, originalPath?, staged })`
- `stage({ workspaceId, paths })`
- `unstage({ workspaceId, paths })`
- `commit({ workspaceId, message })`
- `generate-commit-message({ workspaceId, instruction? })`

Every endpoint resolves `workspaceId` through the Host workspace registry. The Client cannot supply a repository path or staged patch. AI generation uses `ctx.agentDefaultModel.currentSelection()` and the configured DSH LLM adapter; the plugin stores no provider credential.

## Known Limitations

- The current release operates on one Git repository rooted at or below the current registered workspace.
- Parent repositories, nested repository orchestration, submodules, worktrees, branch management, pull, push, discard, and partial-line staging are not implemented.
- Diff display is limited to 512 KiB per request. AI staged-patch context is limited to 200 KB. Binary files show an explicit non-text state.
- AI generation uses the global DSH default model rather than a conversation-specific temporary model selection.
- Git hooks may run during commit. Interactive credential prompts are disabled, and commit signing is disabled for the non-interactive UI operation.
- File watching is not installed for repository changes; use Refresh after external changes. Client source changes use the development bundle watcher, while Host changes require restarting DSH Desktop.

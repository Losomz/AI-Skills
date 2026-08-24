//#region src/types.d.ts
/** Public wire vocabulary for the workspace-scoped Git service. */
type GitChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted';
interface GitFileChange {
  path: string;
  originalPath?: string;
  kind: GitChangeKind;
  staged: boolean;
  unstaged: boolean;
}
interface GitRepositoryInfo {
  root: string;
  branch: string | null;
  detached: boolean;
  unborn: boolean;
  ahead: number;
  behind: number;
}
interface GitStatusSnapshot extends GitRepositoryInfo {
  files: GitFileChange[];
  hasConflicts: boolean;
}
interface GitDiffRequest {
  workspaceId: string;
  path: string;
  staged: boolean;
}
interface GitDiffResult {
  path: string;
  staged: boolean;
  text: string;
  binary: boolean;
  truncated: boolean;
}
interface GitPathsRequest {
  workspaceId: string;
  paths: string[];
}
interface GitGenerateCommitMessageRequest {
  workspaceId: string;
  instruction?: string;
}
interface GitGenerateCommitMessageResult {
  message: string;
}
interface GitCommitRequest {
  workspaceId: string;
  message: string;
}
interface GitCommitResult {
  hash: string;
  summary: string;
}
//#endregion
export { GitChangeKind, GitCommitRequest, GitCommitResult, GitDiffRequest, GitDiffResult, GitFileChange, GitGenerateCommitMessageRequest, GitGenerateCommitMessageResult, GitPathsRequest, GitRepositoryInfo, GitStatusSnapshot };
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
  originalPath?: string;
  staged: boolean;
}
interface GitDiffHunk {
  oldText: string | null;
  newText: string;
}
interface GitDiffResultBase {
  path: string;
  staged: boolean;
}
interface GitTextDiffResult extends GitDiffResultBase {
  kind: 'text';
  hunks: GitDiffHunk[];
}
interface GitBinaryDiffResult extends GitDiffResultBase {
  kind: 'binary';
}
interface GitLargeDiffResult extends GitDiffResultBase {
  kind: 'too-large';
  limitBytes: number;
}
interface GitEmptyDiffResult extends GitDiffResultBase {
  kind: 'empty';
}
type GitDiffResult = GitTextDiffResult | GitBinaryDiffResult | GitLargeDiffResult | GitEmptyDiffResult;
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
export { GitBinaryDiffResult, GitChangeKind, GitCommitRequest, GitCommitResult, GitDiffHunk, GitDiffRequest, GitDiffResult, GitEmptyDiffResult, GitFileChange, GitGenerateCommitMessageRequest, GitGenerateCommitMessageResult, GitLargeDiffResult, GitPathsRequest, GitRepositoryInfo, GitStatusSnapshot, GitTextDiffResult };
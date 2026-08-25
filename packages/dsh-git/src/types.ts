/** Public wire vocabulary for the workspace-scoped Git service. */

export type GitChangeKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'

export interface GitFileChange {
  path: string
  originalPath?: string
  kind: GitChangeKind
  staged: boolean
  unstaged: boolean
}

export interface GitRepositoryInfo {
  root: string
  branch: string | null
  detached: boolean
  unborn: boolean
  ahead: number
  behind: number
}

export interface GitStatusSnapshot extends GitRepositoryInfo {
  files: GitFileChange[]
  hasConflicts: boolean
}

export interface GitDiffRequest {
  workspaceId: string
  path: string
  originalPath?: string
  staged: boolean
}

export interface GitDiffHunk {
  oldText: string | null
  newText: string
}

interface GitDiffResultBase {
  path: string
  staged: boolean
}

export interface GitTextDiffResult extends GitDiffResultBase {
  kind: 'text'
  hunks: GitDiffHunk[]
}

export interface GitBinaryDiffResult extends GitDiffResultBase {
  kind: 'binary'
}

export interface GitLargeDiffResult extends GitDiffResultBase {
  kind: 'too-large'
  limitBytes: number
}

export interface GitEmptyDiffResult extends GitDiffResultBase {
  kind: 'empty'
}

export type GitDiffResult =
  | GitTextDiffResult
  | GitBinaryDiffResult
  | GitLargeDiffResult
  | GitEmptyDiffResult

export interface GitPathsRequest {
  workspaceId: string
  paths: string[]
}

export interface GitGenerateCommitMessageRequest {
  workspaceId: string
  instruction?: string
}

export interface GitGenerateCommitMessageResult {
  message: string
}

export interface GitCommitRequest {
  workspaceId: string
  message: string
}

export interface GitCommitResult {
  hash: string
  summary: string
}

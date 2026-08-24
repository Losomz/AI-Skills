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
  staged: boolean
}

export interface GitDiffResult {
  path: string
  staged: boolean
  text: string
  binary: boolean
  truncated: boolean
}

export interface GitPathsRequest {
  workspaceId: string
  paths: string[]
}

export interface GitCommitRequest {
  workspaceId: string
  message: string
}

export interface GitCommitResult {
  hash: string
  summary: string
}

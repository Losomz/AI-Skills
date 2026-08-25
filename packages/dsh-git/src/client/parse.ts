import type {
  GitChangeKind,
  GitCommitResult,
  GitDiffHunk,
  GitDiffResult,
  GitFileChange,
  GitGenerateCommitMessageResult,
  GitStatusSnapshot,
} from '../types.ts'

const CHANGE_KINDS = new Set<GitChangeKind>([
  'added', 'modified', 'deleted', 'renamed', 'copied', 'untracked', 'conflicted',
])

function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Git Host returned an invalid ${label}`)
  }
  return value as Record<string, unknown>
}

function parseFile(value: unknown): GitFileChange {
  const file = recordOf(value, 'status file')
  if (
    typeof file.path !== 'string' ||
    typeof file.kind !== 'string' || !CHANGE_KINDS.has(file.kind as GitChangeKind) ||
    typeof file.staged !== 'boolean' || typeof file.unstaged !== 'boolean' ||
    (file.originalPath !== undefined && typeof file.originalPath !== 'string')
  ) throw new Error('Git Host returned an invalid status file')
  return {
    path: file.path,
    kind: file.kind as GitChangeKind,
    staged: file.staged,
    unstaged: file.unstaged,
    ...(file.originalPath === undefined ? {} : { originalPath: file.originalPath as string }),
  }
}

export function parseStatus(value: unknown): GitStatusSnapshot {
  const status = recordOf(value, 'status')
  if (
    typeof status.root !== 'string' ||
    (status.branch !== null && typeof status.branch !== 'string') ||
    typeof status.detached !== 'boolean' || typeof status.unborn !== 'boolean' ||
    !Number.isSafeInteger(status.ahead) || !Number.isSafeInteger(status.behind) ||
    (status.ahead as number) < 0 || (status.behind as number) < 0 ||
    typeof status.hasConflicts !== 'boolean' || !Array.isArray(status.files)
  ) throw new Error('Git Host returned an invalid status')
  return {
    root: status.root,
    branch: status.branch as string | null,
    detached: status.detached,
    unborn: status.unborn,
    ahead: status.ahead as number,
    behind: status.behind as number,
    hasConflicts: status.hasConflicts,
    files: status.files.map(parseFile),
  }
}

function parseHunk(value: unknown): GitDiffHunk {
  const hunk = recordOf(value, 'diff hunk')
  if ((hunk.oldText !== null && typeof hunk.oldText !== 'string') || typeof hunk.newText !== 'string') {
    throw new Error('Git Host returned an invalid diff hunk')
  }
  return { oldText: hunk.oldText as string | null, newText: hunk.newText }
}

export function parseDiff(value: unknown): GitDiffResult {
  const diff = recordOf(value, 'diff')
  if (typeof diff.path !== 'string' || typeof diff.staged !== 'boolean' || typeof diff.kind !== 'string') {
    throw new Error('Git Host returned an invalid diff')
  }
  const base = { path: diff.path, staged: diff.staged }
  if (diff.kind === 'text' && Array.isArray(diff.hunks)) {
    return { ...base, kind: 'text', hunks: diff.hunks.map(parseHunk) }
  }
  if (diff.kind === 'binary') return { ...base, kind: 'binary' }
  if (diff.kind === 'empty') return { ...base, kind: 'empty' }
  if (diff.kind === 'too-large' && Number.isSafeInteger(diff.limitBytes) && (diff.limitBytes as number) > 0) {
    return { ...base, kind: 'too-large', limitBytes: diff.limitBytes as number }
  }
  throw new Error('Git Host returned an invalid diff')
}

export function parseGenerateResult(value: unknown): GitGenerateCommitMessageResult {
  const result = recordOf(value, 'generated commit message')
  if (typeof result.message !== 'string') throw new Error('Git Host returned an invalid generated commit message')
  return { message: result.message }
}

export function parseCommitResult(value: unknown): GitCommitResult {
  const result = recordOf(value, 'commit result')
  if (typeof result.hash !== 'string' || typeof result.summary !== 'string') {
    throw new Error('Git Host returned an invalid commit result')
  }
  return { hash: result.hash, summary: result.summary }
}

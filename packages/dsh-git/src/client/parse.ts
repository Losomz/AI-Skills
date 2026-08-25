import type {
  GitChangeKind,
  GitCommitResult,
  GitDiffHunk,
  GitDiffResult,
  GitFileChange,
  GitGenerateCommitMessageResult,
  GitModelCatalogResult,
  GitModelSelection,
  GitSettingsValue,
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

export function parseGitSettings(value: unknown): GitSettingsValue | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const settings = value as Record<string, unknown>
  if (settings.language !== 'auto' && settings.language !== 'zh-CN' && settings.language !== 'en') return undefined
  let modelSelection: GitModelSelection | null = null
  if (settings.modelSelection !== undefined && settings.modelSelection !== null) {
    if (typeof settings.modelSelection !== 'object' || settings.modelSelection === null || Array.isArray(settings.modelSelection)) return undefined
    const model = settings.modelSelection as Record<string, unknown>
    if (typeof model.provider !== 'string' || model.provider.length === 0 || typeof model.model !== 'string' || model.model.length === 0) return undefined
    modelSelection = { provider: model.provider, model: model.model }
  }
  return {
    language: settings.language,
    ...(modelSelection === undefined ? {} : { modelSelection }),
  }
}

export function parseModelCatalog(value: unknown): GitModelCatalogResult {
  const catalog = recordOf(value, 'model catalog')
  const defaultSelection = parseGitSettings({ language: 'auto', modelSelection: catalog.defaultSelection })?.modelSelection
  if (defaultSelection === undefined || !Array.isArray(catalog.providers) || !Array.isArray(catalog.failures)) {
    throw new Error('Git Host returned an invalid model catalog')
  }
  const providers = catalog.providers.map((raw) => {
    const provider = recordOf(raw, 'model provider')
    if (typeof provider.id !== 'string' || typeof provider.name !== 'string' || !Array.isArray(provider.models)) {
      throw new Error('Git Host returned an invalid model provider')
    }
    return {
      id: provider.id,
      name: provider.name,
      models: provider.models.map((rawModel) => {
        const model = recordOf(rawModel, 'catalog model')
        if (
          typeof model.id !== 'string' || typeof model.name !== 'string' ||
          (model.description !== undefined && typeof model.description !== 'string')
        ) throw new Error('Git Host returned an invalid catalog model')
        return {
          id: model.id,
          name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
        }
      }),
    }
  })
  const failures = catalog.failures.map((raw) => {
    const failure = recordOf(raw, 'catalog failure')
    if (typeof failure.provider !== 'string' || typeof failure.message !== 'string') {
      throw new Error('Git Host returned an invalid catalog failure')
    }
    return { provider: failure.provider, message: failure.message }
  })
  return { defaultSelection, providers, failures }
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

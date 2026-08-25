import { spawn } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import type {
  GitChangeKind,
  GitCommitResult,
  GitDiffHunk,
  GitDiffResult,
  GitFileChange,
  GitRepositoryInfo,
  GitStatusSnapshot,
} from './types.ts'

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const MAX_DIFF_BYTES = 512 * 1024
export const STAGED_PATCH_PROMPT_BYTES = 200_000
const COMMAND_TIMEOUT_MS = 30_000

export class GitOperationError extends Error {
  constructor(readonly code: string, message: string, readonly detail?: string) {
    super(message)
    this.name = 'GitOperationError'
  }
}

interface RunOptions {
  input?: string
  maxBytes?: number
  allowExitCodes?: readonly number[]
}

interface RunResult {
  stdout: Buffer
  stderr: string
  exitCode: number
}

function runGit(cwd: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
    )
    const child = spawn('git', ['-c', 'core.pager=cat', '-c', 'core.fsmonitor=false', ...args], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...environment, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const maxBytes = options.maxBytes ?? MAX_OUTPUT_BYTES
    let size = 0
    let settled = false
    let terminationError: Error | undefined
    const rejectOnce = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
    const terminate = (error: Error): void => {
      if (settled || terminationError !== undefined) return
      terminationError = error
      clearTimeout(timer)
      child.kill()
    }
    const timer = setTimeout(() => {
      terminate(new GitOperationError('GIT_TIMEOUT', 'Git operation timed out'))
    }, COMMAND_TIMEOUT_MS)
    const collect = (target: Buffer[], chunk: Buffer): void => {
      if (terminationError !== undefined) return
      size += chunk.byteLength
      if (size > maxBytes) {
        terminate(new GitOperationError('GIT_OUTPUT_LIMIT', 'Git output exceeded the safety limit'))
        return
      }
      target.push(chunk)
    }
    child.stdout.on('data', (chunk: Buffer) => { collect(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { collect(stderr, chunk) })
    child.on('error', (error) => {
      rejectOnce(error instanceof Error && 'code' in error && error.code === 'ENOENT'
        ? new GitOperationError('GIT_NOT_FOUND', 'Git is not installed or is not available on PATH')
        : error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (terminationError !== undefined) {
        reject(terminationError)
        return
      }
      const exitCode = code ?? -1
      const errorText = Buffer.concat(stderr).toString('utf8').trim()
      if (exitCode !== 0 && !(options.allowExitCodes ?? []).includes(exitCode)) {
        reject(mapGitFailure(exitCode, errorText))
        return
      }
      resolve({ stdout: Buffer.concat(stdout), stderr: errorText, exitCode })
    })
    if (options.input === undefined) child.stdin.end()
    else child.stdin.end(options.input, 'utf8')
  })
}

function mapGitFailure(exitCode: number, detail: string): GitOperationError {
  const text = detail.toLowerCase()
  if (text.includes('not a git repository')) {
    return new GitOperationError('NOT_A_REPOSITORY', 'The selected workspace is not a Git repository', detail)
  }
  if (text.includes('user.name') || text.includes('user.email') || text.includes('author identity unknown')) {
    return new GitOperationError('GIT_IDENTITY_MISSING', 'Configure Git user.name and user.email before committing', detail)
  }
  if (text.includes('index.lock') || text.includes('another git process')) {
    return new GitOperationError('GIT_LOCKED', 'The repository is locked by another Git process', detail)
  }
  if (text.includes('gpg failed') || text.includes('failed to sign')) {
    return new GitOperationError('GIT_SIGNING_FAILED', 'Git could not sign the commit non-interactively', detail)
  }
  return new GitOperationError('GIT_FAILED', `Git exited with code ${exitCode}`, detail)
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export async function resolveRepository(workspacePath: string): Promise<string> {
  const workspace = await realpath(workspacePath)
  const result = await runGit(workspace, ['-c', 'core.pager=cat', 'rev-parse', '--show-toplevel'])
  const root = await realpath(result.stdout.toString('utf8').trim())
  if (!isWithin(workspace, root)) {
    throw new GitOperationError('REPOSITORY_OUTSIDE_WORKSPACE', 'The Git repository root is outside the selected workspace')
  }
  return root
}

function validateRelativePath(repoRoot: string, value: string): string {
  if (value.length === 0 || value.includes('\0') || path.isAbsolute(value)) {
    throw new GitOperationError('INVALID_PATH', 'Git paths must be non-empty repository-relative paths')
  }
  const normalized = value.replaceAll('\\', '/')
  const resolved = path.resolve(repoRoot, ...normalized.split('/'))
  if (!isWithin(repoRoot, resolved)) throw new GitOperationError('INVALID_PATH', 'Git path escapes the repository')
  return normalized
}

function changeKind(x: string, y: string): GitChangeKind {
  const code = x !== '.' ? x : y
  if (code === 'A') return 'added'
  if (code === 'D') return 'deleted'
  if (code === 'R') return 'renamed'
  if (code === 'C') return 'copied'
  if (code === 'U' || x === 'U' || y === 'U' || x === 'A' && y === 'A' || x === 'D' && y === 'D') return 'conflicted'
  return 'modified'
}

function fieldAfterSpaces(record: string, count: number): string {
  let cursor = -1
  for (let index = 0; index < count; index += 1) {
    cursor = record.indexOf(' ', cursor + 1)
    if (cursor === -1) return ''
  }
  return record.slice(cursor + 1)
}

export function parsePorcelainV2(output: Buffer): GitStatusSnapshot {
  const fields = output.toString('utf8').split('\0')
  const files: GitFileChange[] = []
  let branch: string | null = null
  let detached = false
  let unborn = false
  let ahead = 0
  let behind = 0
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index]
    if (!record) continue
    if (record.startsWith('# branch.head ')) {
      const head = record.slice(14)
      detached = head === '(detached)'
      branch = detached ? null : head
      continue
    }
    if (record.startsWith('# branch.oid ')) {
      unborn = record.slice(13) === '(initial)'
      continue
    }
    if (record.startsWith('# branch.ab ')) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record)
      if (match) {
        ahead = Number(match[1])
        behind = Number(match[2])
      }
      continue
    }
    if (record.startsWith('? ')) {
      files.push({ path: record.slice(2), kind: 'untracked', staged: false, unstaged: true })
      continue
    }
    if (record.startsWith('1 ') || record.startsWith('u ')) {
      const xy = record.slice(2, 4)
      const filePath = fieldAfterSpaces(record, record.startsWith('u ') ? 10 : 8)
      files.push({
        path: filePath,
        kind: record.startsWith('u ') ? 'conflicted' : changeKind(xy[0] ?? '.', xy[1] ?? '.'),
        staged: (xy[0] ?? '.') !== '.',
        unstaged: (xy[1] ?? '.') !== '.',
      })
      continue
    }
    if (record.startsWith('2 ')) {
      const xy = record.slice(2, 4)
      const filePath = fieldAfterSpaces(record, 9)
      const originalPath = fields[index + 1] ?? ''
      index += 1
      files.push({
        path: filePath,
        originalPath,
        kind: changeKind(xy[0] ?? '.', xy[1] ?? '.'),
        staged: (xy[0] ?? '.') !== '.',
        unstaged: (xy[1] ?? '.') !== '.',
      })
    }
  }
  return {
    root: '', branch, detached, unborn, ahead, behind, files,
    hasConflicts: files.some(file => file.kind === 'conflicted'),
  }
}

export async function readStatus(repoRoot: string): Promise<GitStatusSnapshot> {
  const result = await runGit(repoRoot, ['-c', 'core.pager=cat', 'status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'])
  return { ...parsePorcelainV2(result.stdout), root: repoRoot }
}

export async function repositoryInfo(repoRoot: string): Promise<GitRepositoryInfo> {
  const { files: _files, hasConflicts: _hasConflicts, ...info } = await readStatus(repoRoot)
  return info
}

export function parseUnifiedDiff(text: string): GitDiffHunk[] {
  const hunks: GitDiffHunk[] = []
  let inHunk = false
  let removed: string[] = []
  let added: string[] = []

  const flush = (): void => {
    if (removed.length === 0 && added.length === 0) return
    hunks.push({
      oldText: removed.length === 0 ? null : `${removed.join('\n')}\n`,
      newText: added.length === 0 ? '' : `${added.join('\n')}\n`,
    })
    removed = []
    added = []
  }

  for (const line of text.split('\n')) {
    if (line.startsWith('@@')) {
      flush()
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('diff --git ')) {
      flush()
      inHunk = false
      continue
    }
    if (line.startsWith('\\ No newline at end of file')) continue
    if (line.startsWith('-')) {
      removed.push(line.slice(1))
      continue
    }
    if (line.startsWith('+')) {
      added.push(line.slice(1))
      continue
    }
    flush()
  }
  flush()
  return hunks
}

export async function readDiff(
  repoRoot: string,
  requestedPath: string,
  staged: boolean,
  requestedOriginalPath?: string,
): Promise<GitDiffResult> {
  const relativePath = validateRelativePath(repoRoot, requestedPath)
  const originalPath = requestedOriginalPath === undefined
    ? undefined
    : validateRelativePath(repoRoot, requestedOriginalPath)
  const status = await readStatus(repoRoot)
  const change = status.files.find(file => file.path === relativePath)
  const untracked = !staged && change?.kind === 'untracked'
  const args = untracked
    ? ['--no-pager', 'diff', '--no-index', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', '--', '/dev/null', relativePath]
    : [
        '--no-pager', 'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3',
        ...(staged ? ['--cached'] : []),
        '--',
        ...(originalPath === undefined ? [] : [originalPath]),
        relativePath,
      ]
  let text: string
  try {
    text = (await runGit(repoRoot, args, {
      maxBytes: MAX_DIFF_BYTES,
      ...(untracked ? { allowExitCodes: [1] } : {}),
    })).stdout.toString('utf8')
  } catch (error) {
    if (!(error instanceof GitOperationError) || error.code !== 'GIT_OUTPUT_LIMIT') throw error
    return { path: relativePath, staged, kind: 'too-large', limitBytes: MAX_DIFF_BYTES }
  }
  if (/^Binary files .* differ$/mu.test(text)) return { path: relativePath, staged, kind: 'binary' }
  const hunks = parseUnifiedDiff(text)
  return hunks.length === 0
    ? { path: relativePath, staged, kind: 'empty' }
    : { path: relativePath, staged, kind: 'text', hunks }
}

export async function stagePaths(repoRoot: string, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) throw new GitOperationError('EMPTY_PATHS', 'Select at least one file')
  const safePaths = paths.map(value => validateRelativePath(repoRoot, value))
  await runGit(repoRoot, ['--literal-pathspecs', 'add', '--', ...safePaths])
}

export async function unstagePaths(repoRoot: string, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) throw new GitOperationError('EMPTY_PATHS', 'Select at least one file')
  const safePaths = paths.map(value => validateRelativePath(repoRoot, value))
  const head = await runGit(repoRoot, ['rev-parse', '--verify', 'HEAD'], { allowExitCodes: [1, 128] })
  if (head.exitCode === 0) await runGit(repoRoot, ['--literal-pathspecs', 'reset', '-q', 'HEAD', '--', ...safePaths])
  else await runGit(repoRoot, ['--literal-pathspecs', 'rm', '--cached', '-q', '--', ...safePaths])
}

export interface GitStagedPromptContext {
  branch: string | null
  files: string[]
  patch: string
  truncated: boolean
}

export function truncatePatchForPrompt(text: string, budget = STAGED_PATCH_PROMPT_BYTES): { text: string; truncated: boolean } {
  const source = Buffer.from(text, 'utf8')
  if (source.byteLength <= budget) return { text, truncated: false }
  const marker = Buffer.from(`\n...(staged diff truncated; ${source.byteLength - budget} or more bytes omitted)\n`, 'utf8')
  const contentBudget = Math.max(0, budget - marker.byteLength)
  const candidate = source.subarray(0, contentBudget)
  const newline = candidate.lastIndexOf(0x0a)
  const cut = newline >= Math.floor(contentBudget / 2) ? newline + 1 : contentBudget
  return {
    text: Buffer.concat([source.subarray(0, cut), marker]).subarray(0, budget).toString('utf8'),
    truncated: true,
  }
}

export async function readStagedPromptContext(repoRoot: string): Promise<GitStagedPromptContext> {
  const status = await readStatus(repoRoot)
  if (status.hasConflicts) throw new GitOperationError('MERGE_CONFLICTS', 'Resolve conflicts before generating a commit message')
  const files = status.files.filter(file => file.staged).map(file => file.path)
  if (files.length === 0) throw new GitOperationError('NOTHING_STAGED', 'There are no staged changes to describe')
  const result = await runGit(repoRoot, ['--no-pager', 'diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-color'], {
    maxBytes: MAX_OUTPUT_BYTES,
  })
  const bounded = truncatePatchForPrompt(result.stdout.toString('utf8'))
  return { branch: status.branch, files, patch: bounded.text, truncated: bounded.truncated }
}

export async function createCommit(repoRoot: string, message: string): Promise<GitCommitResult> {
  const normalized = message.trim()
  if (normalized.length === 0) throw new GitOperationError('EMPTY_COMMIT_MESSAGE', 'Commit message cannot be empty')
  if (Buffer.byteLength(normalized, 'utf8') > 64 * 1024) throw new GitOperationError('COMMIT_MESSAGE_LIMIT', 'Commit message is too large')
  const status = await readStatus(repoRoot)
  if (status.hasConflicts) throw new GitOperationError('MERGE_CONFLICTS', 'Resolve conflicts before committing')
  if (!status.files.some(file => file.staged)) throw new GitOperationError('NOTHING_STAGED', 'There are no staged changes to commit')
  const result = await runGit(repoRoot, ['commit', '--no-gpg-sign', '--cleanup=verbatim', '--file', '-'], { input: `${normalized}\n` })
  const hash = (await runGit(repoRoot, ['rev-parse', 'HEAD'])).stdout.toString('utf8').trim()
  const summary = result.stdout.toString('utf8').trim().split(/\r?\n/u)[0] ?? normalized
  return { hash, summary }
}

export class RepositoryMutationQueue {
  private readonly tails = new Map<string, Promise<void>>()

  async run<T>(repoRoot: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(repoRoot) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => { release = resolve })
    const tail = previous.then(() => current)
    this.tails.set(repoRoot, tail)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.tails.get(repoRoot) === tail) this.tails.delete(repoRoot)
    }
  }
}

import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createCommit,
  GitOperationError,
  parsePorcelainV2,
  parseUnifiedDiff,
  readDiff,
  readStagedPromptContext,
  readStatus,
  resolveRepository,
  stagePaths,
  truncatePatchForPrompt,
  unstagePaths,
} from '../src/git.ts'

const fixtures: string[] = []

async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-git-'))
  fixtures.push(root)
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'DSH Test')
  git(root, 'config', 'user.email', 'dsh-test@example.invalid')
  git(root, 'config', 'core.autocrlf', 'false')
  return root
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(fixtures.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('porcelain v2 parser', () => {
  it('preserves spaces, rename source paths, and branch metadata', () => {
    const raw = [
      '# branch.oid abc123',
      '# branch.head main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 abc abc file with spaces.ts',
      '2 R. N... 100644 100644 100644 abc def R100 renamed file.ts',
      'old file.ts',
      '? untracked file.md',
      '',
    ].join('\0')
    const status = parsePorcelainV2(Buffer.from(raw))
    expect(status).toMatchObject({ branch: 'main', ahead: 2, behind: 1 })
    expect(status.files).toEqual([
      { path: 'file with spaces.ts', kind: 'modified', staged: false, unstaged: true },
      { path: 'renamed file.ts', originalPath: 'old file.ts', kind: 'renamed', staged: true, unstaged: false },
      { path: 'untracked file.md', kind: 'untracked', staged: false, unstaged: true },
    ])
  })
})

describe('unified diff parser', () => {
  it('extracts change blocks across hunks and preserves patch-like content', () => {
    const patch = [
      'diff --git a/file.txt b/file.txt',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1,3 +1,3 @@',
      ' context',
      '---old-looking-content',
      '+++new-looking-content',
      ' context',
      '@@ -8 +8 @@',
      '-last',
      '+next',
      '\\ No newline at end of file',
      '',
    ].join('\n')
    expect(parseUnifiedDiff(patch)).toEqual([
      { oldText: '--old-looking-content\n', newText: '++new-looking-content\n' },
      { oldText: 'last\n', newText: 'next\n' },
    ])
  })
})

describe('Git workspace operations', () => {
  it('stages, diffs, unstages, and commits through argv and stdin', async () => {
    const root = await repository()
    await writeFile(path.join(root, 'file with spaces.txt'), 'first\n', 'utf8')
    await stagePaths(root, ['file with spaces.txt'])
    let status = await readStatus(root)
    expect(status.files[0]).toMatchObject({ path: 'file with spaces.txt', staged: true })
    expect(await readDiff(root, 'file with spaces.txt', true)).toMatchObject({
      kind: 'text',
      hunks: [{ oldText: null, newText: 'first\n' }],
    })

    await unstagePaths(root, ['file with spaces.txt'])
    status = await readStatus(root)
    expect(status.files[0]).toMatchObject({ kind: 'untracked', unstaged: true })

    await stagePaths(root, ['file with spaces.txt'])
    const committed = await createCommit(root, 'test: initial commit')
    expect(committed.hash).toMatch(/^[0-9a-f]{40}$/u)
    expect((await readStatus(root)).files).toEqual([])
  })

  it('rejects empty messages and commits with no staged changes', async () => {
    const root = await repository()
    await expect(createCommit(root, '   ')).rejects.toMatchObject<Partial<GitOperationError>>({
      code: 'EMPTY_COMMIT_MESSAGE',
    })
    await writeFile(path.join(root, 'unstaged.txt'), 'not staged\n', 'utf8')
    await expect(createCommit(root, 'test: should not commit')).rejects.toMatchObject<Partial<GitOperationError>>({
      code: 'NOTHING_STAGED',
    })
    await expect(readStagedPromptContext(root)).rejects.toMatchObject<Partial<GitOperationError>>({
      code: 'NOTHING_STAGED',
    })
  })

  it('captures staged files and bounds the model patch on a line boundary', async () => {
    const root = await repository()
    await writeFile(path.join(root, 'staged.txt'), 'generated context\n', 'utf8')
    await stagePaths(root, ['staged.txt'])
    const context = await readStagedPromptContext(root)
    expect(context.files).toEqual(['staged.txt'])
    expect(context.patch).toContain('+generated context')

    const bounded = truncatePatchForPrompt(`header\n${'change\n'.repeat(200)}`, 128)
    expect(bounded.truncated).toBe(true)
    expect(Buffer.byteLength(bounded.text, 'utf8')).toBeLessThanOrEqual(128)
    expect(bounded.text).toContain('staged diff truncated')
  })

  it('reads untracked and staged content from the correct Git layers', async () => {
    const root = await repository()
    await writeFile(path.join(root, 'layered.txt'), 'untracked\n', 'utf8')
    expect(await readDiff(root, 'layered.txt', false)).toMatchObject({
      kind: 'text',
      hunks: [{ oldText: null, newText: 'untracked\n' }],
    })

    await stagePaths(root, ['layered.txt'])
    await writeFile(path.join(root, 'layered.txt'), 'working tree\n', 'utf8')
    expect(await readDiff(root, 'layered.txt', true)).toMatchObject({
      kind: 'text',
      hunks: [{ oldText: null, newText: 'untracked\n' }],
    })
    expect(await readDiff(root, 'layered.txt', false)).toMatchObject({
      kind: 'text',
      hunks: [{ oldText: 'untracked\n', newText: 'working tree\n' }],
    })
  })

  it('reads renamed and deleted file diffs with their correct path pairs', async () => {
    const root = await repository()
    await writeFile(path.join(root, 'old name.txt'), 'shared one\nshared two\nbefore\n', 'utf8')
    await writeFile(path.join(root, 'deleted.txt'), 'removed\n', 'utf8')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'initial')

    await rename(path.join(root, 'old name.txt'), path.join(root, 'new name.txt'))
    await writeFile(path.join(root, 'new name.txt'), 'shared one\nshared two\nafter\n', 'utf8')
    await rm(path.join(root, 'deleted.txt'))
    await stagePaths(root, ['old name.txt', 'new name.txt'])

    const renamed = (await readStatus(root)).files.find(file => file.path === 'new name.txt')
    expect(renamed).toMatchObject({ originalPath: 'old name.txt', kind: 'renamed', staged: true })
    expect(await readDiff(root, 'new name.txt', true, 'old name.txt')).toMatchObject({
      kind: 'text',
      hunks: [{ oldText: 'before\n', newText: 'after\n' }],
    })
    expect(await readDiff(root, 'deleted.txt', false)).toMatchObject({
      kind: 'text',
      hunks: [{ oldText: 'removed\n', newText: '' }],
    })
  })

  it('reports binary and oversized diffs without transporting partial content', async () => {
    const root = await repository()
    await writeFile(path.join(root, 'binary.dat'), Buffer.from([0, 1, 2, 3]))
    expect(await readDiff(root, 'binary.dat', false)).toMatchObject({ kind: 'binary' })

    await writeFile(path.join(root, 'large.txt'), `${'changed line\n'.repeat(60_000)}`, 'utf8')
    expect(await readDiff(root, 'large.txt', false)).toMatchObject({
      kind: 'too-large',
      limitBytes: 512 * 1024,
    })
  })

  it('rejects paths that escape the repository', async () => {
    const root = await repository()
    await expect(stagePaths(root, ['../outside.txt'])).rejects.toMatchObject<Partial<GitOperationError>>({ code: 'INVALID_PATH' })
  })

  it('rejects a parent repository outside the selected workspace', async () => {
    const root = await repository()
    await writeFile(path.join(root, 'tracked.txt'), 'x', 'utf8')
    git(root, 'add', 'tracked.txt')
    git(root, 'commit', '-qm', 'initial')
    const child = path.join(root, 'child')
    await mkdir(child)
    await expect(resolveRepository(child)).rejects.toMatchObject<Partial<GitOperationError>>({
      code: 'REPOSITORY_OUTSIDE_WORKSPACE',
    })
  })
})

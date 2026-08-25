import { describe, expect, it } from 'vitest'
import { parseDiff, parseGitSettings, parseModelCatalog, parseStatus } from '../src/client/parse.ts'

const status = {
  root: 'C:/repo',
  branch: 'main',
  detached: false,
  unborn: false,
  ahead: 1,
  behind: 0,
  hasConflicts: false,
  files: [{ path: 'src/file.ts', kind: 'modified', staged: false, unstaged: true }],
}

describe('Client Git wire parsers', () => {
  it('accepts valid status and structured text diff results', () => {
    expect(parseStatus(status)).toEqual(status)
    expect(parseDiff({
      path: 'src/file.ts',
      staged: false,
      kind: 'text',
      hunks: [{ oldText: 'old\n', newText: 'new\n' }],
    })).toMatchObject({ kind: 'text', hunks: [{ oldText: 'old\n', newText: 'new\n' }] })
  })

  it('accepts Git settings and model catalogs while rejecting malformed values', () => {
    expect(parseGitSettings({
      language: 'zh-CN',
      modelSelection: { provider: 'provider', model: 'model' },
    })).toEqual({ language: 'zh-CN', modelSelection: { provider: 'provider', model: 'model' } })
    expect(parseGitSettings({ language: 'unknown' })).toBeUndefined()

    expect(parseModelCatalog({
      defaultSelection: { provider: 'provider', model: 'model' },
      providers: [{ id: 'provider', name: 'Provider', models: [{ id: 'model', name: 'Model' }] }],
      failures: [],
    })).toMatchObject({ defaultSelection: { provider: 'provider', model: 'model' } })
    expect(() => parseModelCatalog({
      defaultSelection: { provider: 'provider', model: 'model' },
      providers: [{ id: 'provider', name: 'Provider', models: [{ id: 1, name: 'Model' }] }],
      failures: [],
    })).toThrow('invalid catalog model')
  })

  it('rejects malformed status files and diff union members', () => {
    expect(() => parseStatus({ ...status, files: [{ ...status.files[0], kind: 'unknown' }] })).toThrow('invalid status file')
    expect(() => parseDiff({ path: 'file', staged: false, kind: 'text', hunks: [{ oldText: 1, newText: '' }] })).toThrow('invalid diff hunk')
    expect(() => parseDiff({ path: 'file', staged: false, kind: 'too-large', limitBytes: 0 })).toThrow('invalid diff')
  })
})

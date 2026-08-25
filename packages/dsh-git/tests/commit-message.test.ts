import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import {
  buildCommitMessagePrompt,
  cleanGeneratedCommitMessage,
  generateCommitMessage,
} from '../src/commit-message.ts'
import { GitOperationError } from '../src/git.ts'
import type { GitStagedPromptContext } from '../src/git.ts'

const staged: GitStagedPromptContext = {
  branch: 'feature/ai-commit',
  files: ['src/client.ts', 'src/host.ts'],
  patch: 'diff --git a/src/client.ts b/src/client.ts\n+add sparkle button\n',
  truncated: false,
}

function contextWith(chunks: StreamChunk[], capture: (request: GenerateOptions) => void): Context {
  return {
    agentDefaultModel: {
      currentSelection: () => ({ provider: 'configured', model: 'default-model' }),
    },
    llm: {
      stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
        capture(request)
        return (async function * () { yield * chunks })()
      },
    },
  } as unknown as Context
}

describe('AI commit-message generation', () => {
  it('includes staged context and the optional user requirement', () => {
    const prompt = buildCommitMessagePrompt(staged, '使用 Conventional Commits')
    expect(prompt).toContain('feature/ai-commit')
    expect(prompt).toContain('- src/client.ts')
    expect(prompt).toContain('使用 Conventional Commits')
    expect(prompt).toContain('<staged-diff>')
    expect(prompt).toContain('+add sparkle button')
  })

  it('includes the configured language and lets an explicit requirement override it', () => {
    const prompt = buildCommitMessagePrompt(staged, 'Write this one in English', 'zh-CN')
    expect(prompt).toContain('Default language: Simplified Chinese')
    expect(prompt).toContain('explicit language in the additional user requirement overrides')
    expect(prompt).toContain('Write this one in English')
  })

  it('cleans fences and one-line quotes from model output', () => {
    expect(cleanGeneratedCommitMessage('```text\nfeat: generate commit messages\n```'))
      .toBe('feat: generate commit messages')
    expect(cleanGeneratedCommitMessage('"Fix commit generation"')).toBe('Fix commit generation')
    expect(() => cleanGeneratedCommitMessage('   ')).toThrowError(GitOperationError)
  })

  it('uses the settings-selected model without attaching a session', async () => {
    let request: GenerateOptions | undefined
    const ctx = contextWith([
      { type: 'text-delta', index: 0, text: 'feat: generate commit messages' },
      { type: 'finish', reason: { kind: 'stop' } },
    ], value => { request = value })

    await expect(generateCommitMessage(
      ctx,
      staged,
      'keep it concise',
      new AbortController().signal,
      { provider: 'configured', model: 'default-model' },
      'auto',
    ))
      .resolves.toEqual({ message: 'feat: generate commit messages' })
    expect(request).toMatchObject({
      provider: 'configured',
      model: 'default-model',
      maxTokens: 240,
      messages: [{ role: 'user' }],
    })
    expect(request?.sessionId).toBeUndefined()
  })

  it('surfaces terminal model failures', async () => {
    const ctx = contextWith([
      { type: 'finish', reason: { kind: 'error', failure: { code: 'OFFLINE', message: 'model offline' } } },
    ], () => undefined)
    await expect(generateCommitMessage(
      ctx,
      staged,
      '',
      new AbortController().signal,
      { provider: 'configured', model: 'default-model' },
      'auto',
    ))
      .rejects.toMatchObject<Partial<GitOperationError>>({ code: 'AI_GENERATION_FAILED', message: 'model offline' })
  })
})

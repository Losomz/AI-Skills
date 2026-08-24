import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SourceControlPanel } from './SourceControlPanel.tsx'
import { installStyles } from './styles.ts'
import type { SourceControlFace } from './types.ts'
import type { GitCommitResult, GitGenerateCommitMessageResult, GitStatusSnapshot } from '../types.ts'

export const inject = ['slots', 'connection']

const EMPTY_STATUS: GitStatusSnapshot = {
  root: '',
  branch: 'main',
  detached: false,
  unborn: false,
  ahead: 0,
  behind: 0,
  hasConflicts: false,
  files: [],
}

/** Register the Source Control panel and its local Host commit caller. */
export function apply(ctx: ClientContext): void {
  const connection = (ctx as ClientContext & { connection: ConnectionHandle }).connection
  const panelFace: SourceControlFace = {
    status: async () => EMPTY_STATUS,
    diff: async request => ({ path: request.path, staged: request.staged, text: '', binary: false, truncated: false }),
    stage: async () => EMPTY_STATUS,
    unstage: async () => EMPTY_STATUS,
    generateCommitMessage: async request => {
      const result = await connection.rpc.call('/dsh-git', 'generate-commit-message', request)
      if (!result.ok) throw new Error(result.error.message)
      return parseGenerateResult(result.value)
    },
    commit: async request => {
      const result = await connection.rpc.call('/dsh-git', 'commit', request)
      if (!result.ok) throw new Error(result.error.message)
      return parseCommitResult(result.value)
    },
  }
  ctx.effect(() => installStyles(), 'dsh-git: styles')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'source-control',
    order: -10,
    inject: (): SourceControlFace => panelFace,
  }, SourceControlPanel))
}

function parseGenerateResult(value: unknown): GitGenerateCommitMessageResult {
  if (typeof value !== 'object' || value === null || typeof (value as Record<string, unknown>).message !== 'string') {
    throw new Error('Git Host returned an invalid generated commit message')
  }
  return { message: (value as { message: string }).message }
}

function parseCommitResult(value: unknown): GitCommitResult {
  if (typeof value !== 'object' || value === null) throw new Error('Git Host returned an invalid commit result')
  const result = value as Record<string, unknown>
  if (typeof result.hash !== 'string' || typeof result.summary !== 'string') {
    throw new Error('Git Host returned an invalid commit result')
  }
  return { hash: result.hash, summary: result.summary }
}

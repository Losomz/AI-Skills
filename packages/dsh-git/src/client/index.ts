import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SourceControlPanel } from './SourceControlPanel.tsx'
import { parseCommitResult, parseDiff, parseGenerateResult, parseStatus } from './parse.ts'
import { installStyles } from './styles.ts'
import type { SourceControlFace } from './types.ts'

export const inject = ['slots', 'connection']

/** Register the Source Control panel and its workspace-confined Host callers. */
export function apply(ctx: ClientContext): void {
  const connection = (ctx as ClientContext & { connection: ConnectionHandle }).connection
  const call = async (endpoint: string, payload: unknown): Promise<unknown> => {
    const result = await connection.rpc.call('/dsh-git', endpoint, payload)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const panelFace: SourceControlFace = {
    status: async workspaceId => parseStatus(await call('status', { workspaceId })),
    diff: async request => parseDiff(await call('diff', request)),
    stage: async request => parseStatus(await call('stage', request)),
    unstage: async request => parseStatus(await call('unstage', request)),
    generateCommitMessage: async request => parseGenerateResult(await call('generate-commit-message', request)),
    commit: async request => parseCommitResult(await call('commit', request)),
  }
  ctx.effect(() => installStyles(), 'dsh-git: styles')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'source-control',
    order: -10,
    inject: (): SourceControlFace => panelFace,
  }, SourceControlPanel))
}

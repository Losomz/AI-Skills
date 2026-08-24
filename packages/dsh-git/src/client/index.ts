import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SourceControlPanel } from './SourceControlPanel.tsx'
import { installStyles } from './styles.ts'
import type { SourceControlFace } from './types.ts'
import type { GitStatusSnapshot } from '../types.ts'

export const inject = ['slots']

const EMPTY_STATUS: GitStatusSnapshot = {
  repositoryRoot: '',
  branch: 'main',
  detached: false,
  unborn: false,
  ahead: 0,
  behind: 0,
  hasConflicts: false,
  files: [],
}

const panelPreview: SourceControlFace = {
  status: async () => EMPTY_STATUS,
  diff: async request => ({ path: request.path, staged: request.staged, text: '' }),
  stage: async () => EMPTY_STATUS,
  unstage: async () => EMPTY_STATUS,
  commit: async () => { throw new Error('Git Host connection is not enabled yet.') },
}

/** Register the Source Control panel before Host Git wiring is added. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => installStyles(), 'dsh-git: styles')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'source-control',
    order: -10,
    inject: (): SourceControlFace => panelPreview,
  }, SourceControlPanel))
}

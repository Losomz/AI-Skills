import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-llm'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { generateCommitMessage } from './commit-message.ts'
import {
  createCommit,
  GitOperationError,
  readDiff,
  readStagedPromptContext,
  readStatus,
  RepositoryMutationQueue,
  resolveRepository,
  stagePaths,
  unstagePaths,
} from './git.ts'
import type {
  GitCommitRequest,
  GitDiffRequest,
  GitGenerateCommitMessageRequest,
  GitPathsRequest,
} from './types.ts'

export type * from './types.ts'

const RPC_CHANNEL = '/dsh-git'
const MAX_INSTRUCTION_BYTES = 16 * 1024
const MAX_PATHS_PER_REQUEST = 256

/** Host service exposing workspace-confined local Git operations to the DSH Client. */
export class SourceControlService extends Service {
  static inject = ['workspaceRegistry', 'connection', 'llm', 'agentDefaultModel']
  private readonly mutations = new RepositoryMutationQueue()

  constructor(ctx: Context) {
    super(ctx, 'sourceControl')
    ctx.effect(() => ctx.connection.rpc.handle(
      RPC_CHANNEL,
      async (endpoint, payload, signal) => {
        try {
          if (endpoint === 'status') {
            const request = requestRecord(payload)
            const root = await this.repositoryRoot(workspaceIdOf(request))
            const value = await this.mutations.run(root, async () => await readStatus(root))
            return { ok: true, value }
          }
          if (endpoint === 'diff') {
            const request = parseDiffRequest(payload)
            const root = await this.repositoryRoot(request.workspaceId)
            const value = await this.mutations.run(root, async () => await readDiff(
              root,
              request.path,
              request.staged,
              request.originalPath,
            ))
            return { ok: true, value }
          }
          if (endpoint === 'stage' || endpoint === 'unstage') {
            const request = parsePathsRequest(payload)
            const root = await this.repositoryRoot(request.workspaceId)
            const value = await this.mutations.run(root, async () => {
              if (endpoint === 'stage') await stagePaths(root, request.paths)
              else await unstagePaths(root, request.paths)
              return await readStatus(root)
            })
            return { ok: true, value }
          }
          if (endpoint === 'commit') {
            const request = parseCommitRequest(payload)
            const root = await this.repositoryRoot(request.workspaceId)
            const value = await this.mutations.run(root, async () => await createCommit(root, request.message))
            return { ok: true, value }
          }
          if (endpoint === 'generate-commit-message') {
            const request = parseGenerateRequest(payload)
            const root = await this.repositoryRoot(request.workspaceId)
            const staged = await this.mutations.run(root, async () => await readStagedPromptContext(root))
            const value = await generateCommitMessage(ctx, staged, request.instruction ?? '', signal)
            return { ok: true, value }
          }
          return { ok: false, error: { code: 'internal', message: `Unknown Git endpoint '${endpoint}'`, details: {} } }
        } catch (error) {
          return {
            ok: false,
            error: {
              code: 'internal',
              message: error instanceof GitOperationError
                ? `${error.code}: ${error.message}`
                : error instanceof Error ? error.message : String(error),
              details: {},
            },
          }
        }
      },
      { authority: 'loopback' },
    ), 'dsh-git: RPC channel')
  }

  private async repositoryRoot(workspaceId: string): Promise<string> {
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
    if (workspace === undefined) throw new GitOperationError('WORKSPACE_NOT_FOUND', 'The selected workspace no longer exists')
    return await resolveRepository(workspace.path)
  }
}

function requestRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new GitOperationError('INVALID_REQUEST', 'Git request must be an object')
  }
  return payload as Record<string, unknown>
}

function workspaceIdOf(value: Record<string, unknown>): string {
  if (typeof value.workspaceId !== 'string' || value.workspaceId.length === 0) {
    throw new GitOperationError('INVALID_REQUEST', 'Git request requires a workspaceId')
  }
  return value.workspaceId
}

function parseDiffRequest(payload: unknown): GitDiffRequest {
  const value = requestRecord(payload)
  if (typeof value.path !== 'string' || typeof value.staged !== 'boolean') {
    throw new GitOperationError('INVALID_REQUEST', 'Git diff requires a path and staged flag')
  }
  if (value.originalPath !== undefined && typeof value.originalPath !== 'string') {
    throw new GitOperationError('INVALID_REQUEST', 'Git diff originalPath must be a string')
  }
  return {
    workspaceId: workspaceIdOf(value),
    path: value.path,
    staged: value.staged,
    ...(value.originalPath === undefined ? {} : { originalPath: value.originalPath as string }),
  }
}

function parsePathsRequest(payload: unknown): GitPathsRequest {
  const value = requestRecord(payload)
  if (!Array.isArray(value.paths) || value.paths.length === 0 || value.paths.length > MAX_PATHS_PER_REQUEST) {
    throw new GitOperationError('INVALID_REQUEST', `Git paths must contain 1-${MAX_PATHS_PER_REQUEST} entries`)
  }
  if (!value.paths.every(path => typeof path === 'string')) {
    throw new GitOperationError('INVALID_REQUEST', 'Every Git path must be a string')
  }
  return { workspaceId: workspaceIdOf(value), paths: value.paths as string[] }
}

function parseCommitRequest(payload: unknown): GitCommitRequest {
  const value = requestRecord(payload)
  if (typeof value.message !== 'string') {
    throw new GitOperationError('INVALID_REQUEST', 'Commit request requires a message')
  }
  return { workspaceId: workspaceIdOf(value), message: value.message }
}

function parseGenerateRequest(payload: unknown): GitGenerateCommitMessageRequest {
  const value = requestRecord(payload)
  if (value.instruction !== undefined && typeof value.instruction !== 'string') {
    throw new GitOperationError('INVALID_REQUEST', 'Commit-message generation instruction must be a string')
  }
  const instruction = value.instruction as string | undefined
  if (instruction !== undefined && Buffer.byteLength(instruction, 'utf8') > MAX_INSTRUCTION_BYTES) {
    throw new GitOperationError('AI_INSTRUCTION_LIMIT', 'The commit-message generation instruction is too large')
  }
  return { workspaceId: workspaceIdOf(value), ...instruction === undefined ? {} : { instruction } }
}

export default SourceControlService

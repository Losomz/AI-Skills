import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {} from 'zod'
import {
  createCommit,
  readDiff,
  readStatus,
  repositoryInfo,
  RepositoryMutationQueue,
  resolveRepository,
  stagePaths,
  unstagePaths,
} from './git.ts'
import type {
  GitCommitRequest,
  GitCommitResult,
  GitDiffRequest,
  GitDiffResult,
  GitPathsRequest,
  GitRepositoryInfo,
  GitStatusSnapshot,
} from './types.ts'

export type * from './types.ts'

/** Host Remote service for Git operations confined to registered workspaces. */
export class SourceControlService extends TypertRemoteService {
  static inject = ['workspaceRegistry']
  private readonly mutations = new RepositoryMutationQueue()

  constructor(ctx: Context) {
    super(ctx, 'sourceControl')
  }

  private async repositoryRoot(workspaceId: string): Promise<string> {
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
    if (workspace === undefined) throw new Error(`Unknown workspace '${workspaceId}'`)
    return await resolveRepository(workspace.path)
  }

  @Remote('repositoryInfo')
  async repositoryInfo(workspaceId: string): Promise<GitRepositoryInfo> {
    const root = await this.repositoryRoot(workspaceId)
    return await repositoryInfo(root)
  }

  @Remote('status')
  async status(workspaceId: string): Promise<GitStatusSnapshot> {
    return await readStatus(await this.repositoryRoot(workspaceId))
  }

  @Remote('diff')
  async diff(request: GitDiffRequest): Promise<GitDiffResult> {
    const root = await this.repositoryRoot(request.workspaceId)
    return await readDiff(root, request.path, request.staged)
  }

  @Remote('stage')
  async stage(request: GitPathsRequest): Promise<GitStatusSnapshot> {
    const root = await this.repositoryRoot(request.workspaceId)
    return await this.mutations.run(root, async () => {
      await stagePaths(root, request.paths)
      return await readStatus(root)
    })
  }

  @Remote('unstage')
  async unstage(request: GitPathsRequest): Promise<GitStatusSnapshot> {
    const root = await this.repositoryRoot(request.workspaceId)
    return await this.mutations.run(root, async () => {
      await unstagePaths(root, request.paths)
      return await readStatus(root)
    })
  }

  @Remote('commit')
  async commit(request: GitCommitRequest): Promise<GitCommitResult> {
    const root = await this.repositoryRoot(request.workspaceId)
    return await this.mutations.run(root, async () => await createCommit(root, request.message))
  }
}

export default SourceControlService

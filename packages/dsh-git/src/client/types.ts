import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  GitCommitRequest,
  GitCommitResult,
  GitDiffRequest,
  GitDiffResult,
  GitGenerateCommitMessageRequest,
  GitGenerateCommitMessageResult,
  GitModelCatalogResult,
  GitPathsRequest,
  GitStatusSnapshot,
} from '../types.ts'

export interface SourceControlFace {
  status(workspaceId: string): Promise<GitStatusSnapshot>
  diff(request: GitDiffRequest): Promise<GitDiffResult>
  stage(request: GitPathsRequest): Promise<GitStatusSnapshot>
  unstage(request: GitPathsRequest): Promise<GitStatusSnapshot>
  modelCatalog(): Promise<GitModelCatalogResult>
  generateCommitMessage(request: GitGenerateCommitMessageRequest): Promise<GitGenerateCommitMessageResult>
  commit(request: GitCommitRequest): Promise<GitCommitResult>
}

export type SourceControlPanelProps =
  PropsRuntime<'conversation.session.header.utilities'> & InjectFace<SourceControlFace>

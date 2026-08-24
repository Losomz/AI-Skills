import { GitChangeKind, GitCommitRequest, GitCommitResult, GitDiffRequest, GitDiffResult, GitFileChange, GitPathsRequest, GitRepositoryInfo, GitStatusSnapshot } from "./types.js";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { Context } from "@deepseek-ai/cordis";

//#region src/index.d.ts
/** Host Remote service for Git operations confined to registered workspaces. */
declare class SourceControlService extends TypertRemoteService {
  static inject: string[];
  private readonly mutations;
  constructor(ctx: Context);
  private repositoryRoot;
  repositoryInfo(workspaceId: string): Promise<GitRepositoryInfo>;
  status(workspaceId: string): Promise<GitStatusSnapshot>;
  diff(request: GitDiffRequest): Promise<GitDiffResult>;
  stage(request: GitPathsRequest): Promise<GitStatusSnapshot>;
  unstage(request: GitPathsRequest): Promise<GitStatusSnapshot>;
  commit(request: GitCommitRequest): Promise<GitCommitResult>;
}
//#endregion
export { GitChangeKind, GitCommitRequest, GitCommitResult, GitDiffRequest, GitDiffResult, GitFileChange, GitPathsRequest, GitRepositoryInfo, GitStatusSnapshot, SourceControlService, SourceControlService as default };
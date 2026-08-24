import { GitChangeKind, GitCommitRequest, GitCommitResult, GitDiffRequest, GitDiffResult, GitFileChange, GitGenerateCommitMessageRequest, GitGenerateCommitMessageResult, GitPathsRequest, GitRepositoryInfo, GitStatusSnapshot } from "./types.js";
import { Context, Service } from "@deepseek-ai/cordis";
//#region src/index.d.ts
/** Host service exposing workspace-confined local Git operations to the DSH Client. */
declare class SourceControlService extends Service {
  static inject: string[];
  private readonly mutations;
  constructor(ctx: Context);
  private repositoryRoot;
}
//#endregion
export { type GitChangeKind, type GitCommitRequest, type GitCommitResult, type GitDiffRequest, type GitDiffResult, type GitFileChange, type GitGenerateCommitMessageRequest, type GitGenerateCommitMessageResult, type GitPathsRequest, type GitRepositoryInfo, type GitStatusSnapshot, SourceControlService, SourceControlService as default };
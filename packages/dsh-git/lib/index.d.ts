import { GitBinaryDiffResult, GitChangeKind, GitCommitRequest, GitCommitResult, GitDiffHunk, GitDiffRequest, GitDiffResult, GitEmptyDiffResult, GitFileChange, GitGenerateCommitMessageRequest, GitGenerateCommitMessageResult, GitLargeDiffResult, GitPathsRequest, GitRepositoryInfo, GitStatusSnapshot, GitTextDiffResult } from "./types.js";
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
export { type GitBinaryDiffResult, type GitChangeKind, type GitCommitRequest, type GitCommitResult, type GitDiffHunk, type GitDiffRequest, type GitDiffResult, type GitEmptyDiffResult, type GitFileChange, type GitGenerateCommitMessageRequest, type GitGenerateCommitMessageResult, type GitLargeDiffResult, type GitPathsRequest, type GitRepositoryInfo, type GitStatusSnapshot, type GitTextDiffResult, SourceControlService, SourceControlService as default };
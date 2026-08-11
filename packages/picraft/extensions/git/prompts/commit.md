请完成当前工作区的 Git 提交与推送。

## 子仓库优先

必须先处理所有子仓库，再提交主仓库，使主仓库记录最新的子仓库引用。

1. 使用 `git submodule status`、`git rev-parse --show-toplevel` 和嵌套 `.git` 扫描汇总子仓库。
2. 按路径深度从深到浅处理子仓库；无改动的仓库直接跳过。
3. 在每个有改动的子仓库中检查 `git status --short`、`git diff --cached` 和 `git diff`，再依次执行 `git add -A`、`git commit`、`git push`。
4. 所有子仓库完成后返回主仓库，以相同方式分析、提交并推送主仓库改动。
5. 若没有可提交内容，直接说明原因；发生冲突、提交失败或推送失败时立即停止，不继续处理后续仓库。

## 提交信息

使用中文编写提交信息，格式为 `{emoji} type(scope): description`：

- 遵循 gitmoji 与 Conventional Commits。
- `type` 从 `feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert` 中选择。
- `scope` 使用受影响的模块，无法明确时可以省略。
- `description` 说明改动目的，主题行不超过 72 个字符。

## 结果

最终输出必须是且仅是如下格式的简报，不要额外解释或多余内容。

有提交时（每个产生提交的仓库一行，按处理顺序排列，子仓库在前，主仓库最后）：

提交：
- 子仓库 <相对路径>：<提交信息> · <7 位短 hash> · push <remote>/<branch> 成功|失败
- 主仓库：<提交信息> · <7 位短 hash> · push <remote>/<branch> 成功|失败
状态：<成功数>/<总数> commit 成功；<成功数>/<总数> push 成功

没有可提交内容时：

提交：无可提交内容
状态：未创建 commit；未执行 push

要求：提交信息使用实际生成的 commit message，不要改写；短 hash 取实际 commit 的前 7 位；push 状态如实反映执行结果；无改动的仓库不出现在列表中。

## 用户核心要求

{{CORE_STANDARD}}

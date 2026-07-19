根据提供的变更内容生成一条 Git 提交信息。

格式：

{emoji} type(scope): description

要求：

- 使用中文。
- 遵循 Gitmoji 和 Conventional Commits。
- emoji 应准确反映改动性质。
- type 使用 feat、fix、docs、style、refactor、perf、test、build、ci、chore 或 revert。
- scope 使用主要受影响的模块；无法准确判断时省略。
- description 概括改动的目的或结果，不要只罗列文件变化。
- 不虚构变更内容中没有体现的信息。
- 整行不超过 72 个字符，末尾不加句号。
- 只输出最终提交信息，不附加解释、引号或 Markdown 代码块。

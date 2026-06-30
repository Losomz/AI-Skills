# 技术变更日志

> 历史版本条目保留当时的路径和同步脚本表述；当前仓库结构以根目录 `README.md` 与 `docs/pi-global-config.md` 为准。

## [Unreleased]

### 文档 / 模板

- 新增 Pi `/init` 模板 `cocos-noelle.md`，用于 Cocos Creator + Noelle 框架项目的 `AGENTS.md` 初始化素材。
- 更新 README、Pi 配置说明和 init 扩展说明，将路径说明对齐到当前 `configs/global/` 与 `configs/project/` 结构。

## [v0.0.1] - 2026-05-21

> 分析范围：project start..HEAD
> 说明：仓库此前无版本 tag，本版本作为首个技术基线版本。

### 功能变更

- 建立 AgentFramework 仓库基线，沉淀 Cocos、Unity、中文编码、OpenCode 与 Pi 相关 Agent/Skill/配置模板，覆盖 Prefab 生成、资源引用、组件挂载、代码审查、中文编码安全处理等场景。（commit: 1806b44, e58c343, b177e5b, 10835ff）
- 新增 `agent-sync.mjs` 项目内同步脚本，支持按包同步 `pi`、`opencode` 或 `all`，并提供 `--yes`、`--local`、`--no-commit`/`--no-push` 等执行模式。（commit: 795267a, 72f6986, 6d84b4e）
- 为同步脚本加入远程缓存、自我升级、环境变量覆盖远程仓库/分支/缓存目录，以及同步完成后自动提交和推送目标项目改动的能力。（commit: 72f6986, 6d84b4e）
- 引入 Pi 扩展体系配置，包括子代理委派、计划模式、Git 操作入口、破坏性命令确认、Git checkpoint 等扩展能力。（commit: 61477c3, 8575d36, 1a72331, 6abc2b1）
- 新增 `/git` 分层命令，将提交与拉取能力统一到单入口；提交流程可委派给指定子代理执行，降低主 agent 对 Git 状态和 diff 的直接耦合。（commit: 052caa5, ff15b26）
- 新增 `/blog` 文件化日志工作流，支持从 `workflows/*.md` 扫描 product、tech、work 等日志流程，并通过 frontmatter 配置命令名、别名、执行 agent 和 pre-commit 行为。（commit: 72f6986, 32cb56c, 3091a0f）
- 为 Pi 计划模式增加执行前补充指令和安全委派子代理提交的能力，允许在执行阶段将落地、验证、提交等任务交给子代理处理。（commit: c8604cb, 6ac6bcc）
- 新增 OpenCode 路径识别优化插件与 OpenTUI 渲染测试支持，用于改善路径识别与终端渲染相关开发体验。（commit: 3809b32）

### 架构/重构

- 仓库结构从分散的根目录 Skill、运行时、包和框架镜像，收敛为 `configs/` 配置源与 `agents/` 模板目录；当前同步源统一放在 `configs/.pi` 与 `configs/.opencode`。（commit: b3497af, 91034f5）
- 将早期 npm CLI/runtime 与多处复制的配置内容移出当前主线结构，改为通过根目录同步脚本进行配置分发，减少重复维护面。（commit: bb7ad24, d9078fe, 8e5b9d7, 91034f5）
- Pi 子代理扩展从 planner/reviewer/worker 等固定角色，调整为更简单的 `General`、`Explore`、`Scout` 等默认入口，并增强 agent 可见性与选择逻辑。（commit: 0ada544, 5632d8d）
- 计划模式扩展简化执行格式约束，减少模式切换和输出格式上的刚性要求，后续通过补充指令和子代理委派扩展执行能力。（commit: d6e223c, c8604cb）
- Blog 扩展将 product/tech/work 的差异下沉到 Markdown prompt 文件，TypeScript 侧只负责发现、解析 frontmatter、匹配别名和构造 subagent chain。（commit: 3091a0f）

### 问题修复

- 修复 Windows 环境下子代理调用 `pi` 命令时路径/命令解析不正确的问题，提升跨平台可用性。（commit: 6abc2b1）
- 修正隐藏配置目录同步路径处理，避免 `.pi`、`.opencode` 等目录在同步过程中被错误解析或遗漏。（commit: f7de104）
- 修复计划模式在运行未结束时错误触发执行模式的问题，降低重复执行或状态错乱风险。（commit: ebb4312）
- 改善子代理并行任务结果回传诊断，便于定位并行执行中失败、空结果或异常输出。（commit: 65fea78）
- 修复 Blog workflow frontmatter 解析兼容性，支持非字符串值、数组 `aliases`、布尔值配置等格式，降低 Markdown 配置解析失败风险。（commit: 47f9098）
- 统一并修正文档与实现中的计划模式快捷键描述，将触发键调整并记录为 `F2`，避免与 Tab 或 `@` 交互冲突。（commit: e8f4864, 3895951）

### 性能/稳定性

- 同步脚本通过版本号检测自我升级，避免旧脚本长期滞留在目标项目；同步前会更新远程缓存并在必要时重新执行新版本脚本。（commit: 6d84b4e）
- 同步逻辑增加 Git ignored 路径过滤和目标目录全量覆盖策略，减少把无效路径纳入自动提交的概率；需要注意该策略不保留目标目录备份。（commit: 72f6986, 6d84b4e）
- 计划模式和 Git 提交流程引入更明确的子代理边界，降低主 agent 长上下文中直接执行提交、推送和执行阶段任务的稳定性风险。（commit: 6ac6bcc, ff15b26）
- OpenCode 路径优化插件为路径识别提供独立实现与验证入口，可能改善复杂路径场景下的识别准确性；实际收益需在目标 OpenCode 环境中验证。（commit: 3809b32）

### 构建/工程化

- 配置 OpenCode 命令、技能和插件目录，并通过 `configs/.opencode` 作为当前可同步配置源维护。（commit: 10835ff, 91034f5）
- 配置 Pi 扩展、agent 与模型相关文件，并通过 `configs/.pi` 作为当前可同步配置源维护。（commit: 61477c3, 6abc2b1, 91034f5）
- 同步脚本支持 `AGENTFRAMEWORK_REPO_URL`、`AGENTFRAMEWORK_REF`、`AGENTFRAMEWORK_HOME` 环境变量，便于维护者切换远程源、分支和缓存目录。（commit: 72f6986）
- 更新 `.gitignore` 与仓库 README，明确同步包、同步策略、远程仓库配置和自动提交行为。（commit: f7de104, 6d84b4e）
- 为 OpenCode changelog/commit 命令沉淀流程文档，包含中文提交提示、子模块处理规则、日志生成默认推送策略等工程约束。（commit: 68300ea, c233c75, 6b4bbbf, 99f168e, a7bcf2f）

### 测试/质量

- Cocos skill 中提供 Prefab ID 校验、UUID 压缩和基于模板创建 Prefab 的脚本，便于对生成资源做结构与引用检查。（commit: 1806b44, f6173d0）
- 增补 Cocos 开发、Cocos 代码审查、Unity AgentBridge、中文编码等规则文档，提升多工具配置在目标项目中的可审查性和可维护性。（commit: 10dc291, b177e5b, f6173d0）
- 新增测试类 skill 占位，用于后续沉淀通用验证流程。（commit: 5e2e276）
- 本次技术日志生成未新增业务代码测试；后续验证重点应覆盖同步脚本在 Windows/Unix、Git 干净/脏工作区、`--no-commit`/`--no-push` 等路径下的行为。（commit: 72f6986, 6d84b4e）

### 风险与迁移说明

- `agent-sync.mjs` 会删除目标配置目录后再复制配置源，不创建备份；目标项目如存在手工修改的 `.pi` 或 `.opencode` 配置，需要先自行备份或迁移到本仓库配置源。（commit: 72f6986）
- 当前主线结构已从早期 `.agents`、`.opencode`、`.pi` 根目录内容迁移到 `configs/`，依赖旧路径的脚本或文档需要改为读取 `configs/.pi`、`configs/.opencode` 或通过 `node agent-sync.mjs` 分发。（commit: 91034f5）
- 同步脚本默认可能在目标项目中自动提交并推送同步结果；维护者在敏感分支或临时验证环境中应使用 `--no-commit` 或 `--no-push`。（commit: 6d84b4e）
- Blog 技术/产品日志工作流会创建版本 tag 并推送；若仓库已有外部发布流程，需要确认 tag 命名和发布权限不会冲突。（commit: 3091a0f）
- 这是首个版本 tag，分析范围覆盖项目开始至当前 `HEAD`，后续版本日志将基于最新 tag 进行增量分析。

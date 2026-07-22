# 技术变更日志

> 历史版本条目保留当时的路径和同步脚本表述；当前仓库结构以根目录 `README.md` 与 `docs/pi-global-config.md` 为准。

## [Unreleased]

### 功能变更

- Subagent 新增 `/subagent-model` 与 `Alt+M`，可从 Pi 当前可复用认证的模型目录中搜索并为内置 agent 保存本机覆盖；覆盖通过 `~/.pi/agent/subagent-models.json` 持久化，并同样应用于 `/git commit` 使用的 `General` profile。

### 架构/重构

- Plan 扩展将 `/plan`、`Alt+I`、`--plan`、Execute 与会话恢复收敛到统一状态入口，并精简为入口、状态、上下文和工具辅助四个职责模块；运行中切换改为在 `agent_settled` 后应用最终 pending 目标，避免同一轮混用 Plan 与执行状态。
- Plan 与 subagent 解除双向协议耦合：Plan 只保留 Pi 中已经注册且已激活的普通 `subagent` 工具，不再解析或约束子代理的 Plan 专属 policy；subagent 也不再读取 Plan 状态。
- Subagent 将 Pi 子进程执行提取为无 UI、无会话依赖的共享 runner；通用子代理工具和 `/git commit` 分别负责自己的展示与结果适配。

### 问题修复

- 补回 Subagent 已拆分但未纳入仓库的 `shortcuts.ts` 与快捷委派测试，避免配置同步后因入口导入缺失而加载失败。
- 修复手动关闭 Plan 后隐藏提醒残留、分支间状态串扰及 Execute 偶发不继续的问题；手动退出现在仅同步模式并发送一次性 inactive 提醒，只有显式 Execute 才通过 `followUp` 触发执行。
- Plan 状态升级为带 revision、工具快照与一次性通知的 v2 结构，兼容历史 `{ enabled }` 数据；恢复过程只读取当前分支且不重复写入状态。
- `/git commit` 固定复用 `General` profile，在后台 Pi 进程中执行独立的 Git 任务模板；命令立即返回，运行中只显示单行状态框，结束后通过通知反馈。
- 修复 Windows 下 Pi 子进程通过 shell 传递任务参数的转义风险，并补齐 AbortSignal 的强制终止回退与监听器、定时器、临时文件清理。

### 测试/质量

- 增加 Subagent 模型目录、配置校验、原子写入、跨进程锁恢复、override 优先级、特殊模型 ID 和 Git profile 校验回归。
- 增加基于 Node `node:test` 的 Plan 回归覆盖，验证统一入口、pending 生命周期、上下文归一化、分支恢复、工具交集与主 Agent 写操作防护。
- 增加 Git 后台任务与共享 runner 回归，覆盖立即返回、重复启动、General profile 继承、PID/耗时 UI、失败与 headless 输出、无 shell 启动及进程资源清理。

### 风险与迁移说明

- Plan 的命令 denylist 仅是主 Agent 的辅助防护而非安全沙箱；已激活的可写/full-access subagent 仍可能修改工作区，需要通过 subagent 自身能力配置或禁用该工具进行隔离。
- Plan 扩展最低要求 Pi 0.80.4，以使用稳定的 `agent_settled` 生命周期事件。
- `/git commit` 现在只接受可选的核心要求，不再解析 agent 参数；后台进程仍在真实 `ctx.cwd` 中提交和推送。同步全局扩展后需执行 `/reload`。

## [v0.1.0] - 2026-06-30

> 分析范围：v0.0.1..HEAD

### 功能变更

- `/git` 扩展能力扩展为更完整的提交工作流：支持 `/git commit` 透传附加要求（如额外提交约束）并优化交互参数解析；并新增 `branch/commit/pull` 子命令能力，覆盖子仓库优先提交、排序与“放弃本地改动并拉取”等流程（commit: 8b8f7e7, 3254bc6, 6560d52, 1cd4e4d, 892e95d, be87fe0）。
- `/init` 从“单一脚本式模板”升级为“模板化初始化交互”：新增 base/godot/Noelle 模板、拆分默认与可选模板交互逻辑，并将默认提示文件集中到 `prompts`，同时移除 `/todos` 命令入口（commit: 3c0eaa0, 0ac094c, 05b1816, 89b731c）。
- Blog/发布工作流能力增强：新增 `release` 流程、修复工作流名称匹配逻辑，并补充 `develop → main` 合并步骤；同时支持核心标准输入以适配工作流委派参数流转（commit: 30d932f, 7d2f4aa, 2d60db3）。
- 子代理协作能力增强：支持 `#AgentName` 行内快捷语法，新增项目级代理清单与子代理自动发现链路，统一 codex 模型与配置入口（commit: cb6814c, 10b53ea, 9c0559c, de2db81, 31a6e6e, a79fd44）。
- 同步能力体验优化：支持按目录同步通用内容，新增同步结果页与后续操作菜单，新增同步脚本引导入口及版本标识与升级逻辑（commit: 6f7eec7, fc39037, 9fbb89d, 1ca0b04, 80a5180, 5c9c0cc, 723ad22）。

### 架构/重构

- 同步执行链路从单文件脚本演进为模块化 CLI：核心入口、菜单、结果页、自动提交、同步与文件系统能力被拆分到 `src/cli/*`、`src/sync/*`、`src/git/*`、`src/utils/*`，便于独立扩展与维护（commit: 44dce37, b118b53, e6afc0a）。
- 配置目录体系完成迁移与统一：将 `.pi`/`.opencode` 配置从散落路径收敛到 `configs/global/.pi`、`configs/global/.codex`、`configs/project/.pi` 与 `configs/project/.opencode`，并补齐目录占位与说明文档（commit: ac10685, 8d44893, b7260e1, 3e9b9e9）。
- `/plan-mode` 重构为 `/plan` + `subagent` 组合能力：移除旧实现并引入新的 plan 扩展入口、统一文案与代理清单（commit: 9c0559c）。
- Git 扩展内部改为可插拔的 `operations` 目录并通过自动发现加载，形成可扩展的操作模块化边界（commit: 3254bc6, be87fe0）。

### 问题修复

- `/plan-mode` 终端快捷键由 `Tab` 改为 `Alt+I`，减少与终端原生快捷键冲突（commit: 8b3d16d）。
- 修复 `/git` 子命令在某些场景下被忽略/不加载的配置问题（commit: 0f06092）。
- 修正发布工作流在名称匹配上的潜在错误（commit: 30d932f）。
- 优化 sync 与交互输入校验，降低误输入导致错误执行的概率（commit: abd8787, 2d60db3）。

### 性能/稳定性

- `agent-sync` 引入语义化版本标识与 `SYNC_SCRIPT_VERSION` 自升级逻辑，减少旧脚本版本漂移导致的执行不一致（commit: 5c9c0cc, 80a5180, 723ad22）。
- 清理大量 `pi示例包` 示例代码并删除仓库顶层 `package.json`，显著减小仓库体积与同步扫描成本；该变更偏维护性优化（commit: 1eed5c2, a571095）。

### 构建/工程化

- 同步与提交流程工程化改造：新增 `sync-wizard`、`result-menu` 等 CLI 模块，统一入口脚本与 `README` 命令说明，便于后续交付和自动化执行（commit: 6f7eec7, fc39037, 9fbb89d, b118b53, e6afc0a）。
- 文档与配置规范化：补充 `docs/pi-global-config.md`、更新仓库配置路径说明、补齐 `.gitignore` 与 `extensions` 占位文件（commit: 3e9b9e9, b7260e1, a571095）。
- 日志与流程文档规则细化：补充产品日志规则、版本递增规则与发布工作流模板约束，降低自动化日志生成歧义（commit: d219c3a, a92a924, 1dd864b）。

### 测试/质量

- 本范围未新增专门自动化测试用例；质量管控以结构化文档、CLI 交互与工作流说明为主，建议在 Windows/Unix、子仓库存在/不存在及 `--help/--no-commit` 等关键路径补充回归（commit: 44dce37, 2d60db3, 9fbb89d）。
- 本次日志采用增量追加方式保留历史版本，已满足技术负责人跨版本追溯需求（commit: d219c3a）。

### 风险与迁移说明

- 配置目录迁移到 `configs/global/.pi` 与 `configs/project/.pi` 后，若外部脚本仍引用旧路径（仓库根 `.pi`/`.opencode`）会出现加载失败，需要同步更新引用（commit: ac10685, 8d44893）。
- `/init` 由 `/todos` 到 `#AgentName`/plan+subagent 的工作流变化是行为兼容点，需提前迁移使用习惯（commit: 89b731c, 10b53ea, cb6814c）。
- `pi示例包` 全量删除属于范围内重大清理；如下游依赖该目录，请在后续阶段按需恢复到外部仓库或制定替代来源（commit: 1eed5c2, a571095）。
- 同步 CLI 与入口链路重构显著，建议在 CI 或外部包装脚本中先做 dry-run 验证，并确认对旧命令参数的兼容行为（commit: 44dce37, fc39037, b118b53）。

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

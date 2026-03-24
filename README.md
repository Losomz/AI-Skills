# AgentFramework

这是一个个人 AI Agent 资产仓库，用来集中管理可复用的 agent 规则、skills、提示模板、工作流和技术栈约定。

目标不是只服务某一个具体工具，而是把这些内容沉淀为一套长期可维护的个人工作流资产，再按不同 AI 平台的能力映射到项目中使用。

## 这个仓库是干什么的

在不同项目里，我经常会有一些稳定的开发偏好、代码约束、初始化流程和常见工作流。如果把这些内容零散地写在每个项目里，会出现几个问题：

- 重复维护，容易漂移。
- 换项目时需要重新整理。
- 换 AI 工具时迁移成本高。
- 高价值经验难以沉淀为可复用资产。

这个仓库的作用，就是把这些经验统一管理在 `.agents/` 目录中，形成一个个人 agent framework。

## 设计目标

- 以“可复用资产”而不是“单次提示词”为核心。
- 优先沉淀长期稳定的规则和流程。
- 尽量保持中立，不强绑定某一个 AI 平台。
- 把“常驻规则”和“按需调用的能力”分开。
- 让新项目可以快速继承这套个人工作流。

## 使用原则

- `.agents/` 是规则源目录。
- 这个仓库优先维护通用规则、技术栈规则、skills 和模板。
- 具体项目中只保留项目特有内容，不重复维护通用内容。
- 面向不同 AI 工具时，优先从这里派生生成目标文件，而不是反过来把某个平台私有格式当作唯一真相。

## 标准目录结构

```text
.agents/
├─ rules/         # 常驻规则：编码原则、提交流程、架构约束、风格约束
├─ stacks/        # 技术栈规则：Cocos、React、Node、Python 等
├─ skills/        # 可调用能力包：多步工作流、专项能力、诊断流程
├─ agents/        # 角色定义：reviewer、planner、implementer 等
├─ prompts/       # 轻量提示模板：PR、排障、重构、测试生成等
├─ workflows/     # 跨技能的流程编排说明
├─ templates/     # 可生成到项目中的模板文件
├─ references/    # 通用参考资料
└─ memory/        # 个人长期偏好、经验沉淀、约定索引
```

说明：

- 当前仓库已优先落地 `skills/`。
- 其他目录可以按需要逐步补齐，不要求一开始全部到位。
- 目录结构是推荐标准，不是硬性要求；重点是长期可维护和方便复用。

## 各目录职责

### `rules/`

放所有项目都可能长期生效的规则，例如：

- 优先最小改动。
- 优先复用现有框架。
- 不做无关重构。
- 默认语言偏好。
- Git / commit / review 约定。

这类内容更像“常驻规则”。

### `stacks/`

放和技术栈绑定的规则，例如：

- Cocos Creator 项目约定。
- React + TypeScript 项目约定。
- Node 服务目录约定。
- Python API 项目约定。

这类内容解决“不同项目类型的差异”。

### `skills/`

放按需触发的专项能力包，例如：

- 新项目初始化 agent 配置。
- Cocos prefab 创建与校验。
- 中文编码排障。
- 生成测试。
- 提交前检查。
- PR 准备流程。

这类内容更像“可复用工作流”。

### `agents/`

放角色定义，例如：

- `planner`
- `reviewer`
- `implementer`
- `debugger`

用于表达不同 agent 的职责、边界和输出风格。

### `prompts/`

放轻量模板，例如：

- bug 分析。
- 代码审查。
- 生成 PR 描述。
- 设计方案对比。
- 测试计划。

适合频繁复用、但又不需要完整 skill 的场景。

### `workflows/`

放跨 skill、跨角色的流程说明，例如：

- 新项目接入流程。
- 老项目接手巡检流程。
- 发布前检查流程。

它比 prompt 更强调步骤和顺序，但不一定绑定具体脚本实现。

### `templates/`

放模板文件，例如：

- `AGENTS.md` 模板。
- `CLAUDE.md` 模板。
- `.github/copilot-instructions.md` 模板。
- path-based instructions 模板。

用于把仓库中的规范同步到具体项目。

### `references/`

放通用参考资料、排查手册、外部知识整理、命令说明等。

### `memory/`

放个人长期偏好、经验总结、易忘坑点和约定索引。

## Skill 标准结构

推荐每个 skill 使用以下结构：

```text
.agents/skills/<skill-name>/
├─ SKILL.md              # skill 主说明，定义用途、触发方式、边界、流程
├─ references/           # 参考文档、排查手册、模块索引
├─ scripts/              # 可选，辅助脚本
├─ assets/               # 可选，模板资源、样例文件
└─ agents/               # 可选，面向具体平台的适配描述
```

### 说明

- `SKILL.md` 是 skill 的入口文件。
- `references/` 放详细文档，不把所有细节都堆进主文件。
- `scripts/` 放可验证、可重复执行的辅助脚本。
- `assets/` 放模板或示例资产。
- `agents/` 放平台适配文件，例如某些工具的声明格式。

## 当前已存在的 skill

- `cocos-general`
  - 面向 Cocos prefab 创建、结构修改、ID 校验、脚本挂载等通用流程。
- `chinese-encoding`
  - 面向 Windows PowerShell / CLI 场景下的中文编码稳定性处理与诊断。

## 推荐命名规范

- skill 目录使用 `kebab-case`。
- rules / prompts / workflows 文件使用 `kebab-case`。
- 一个文件只表达一个主题。
- 名称尽量短，但要能表达用途。
- 优先英文命名，必要时在正文中补中文说明。

## 如何把这套资产用到新项目

推荐做法：

1. 在此仓库中维护规则源文件。
2. 根据项目类型选择需要的 `rules` / `stacks` / `skills`。
3. 生成或复制到目标项目中。
4. 在目标项目里落地为：
   - `AGENTS.md`
   - `CLAUDE.md`
   - `.github/copilot-instructions.md`
   - path-specific instructions
5. 只在项目里补充项目特有内容，不重复维护通用部分。

## CLI 使用

### Runtime 本地开发

仓库内真正的 CLI runtime 放在 `runtime/`，本地开发直接运行它：

```bash
npm --prefix runtime install
npm run menu
```

常用命令：

```bash
npm --prefix runtime run menu -- --list-templates
npm --prefix runtime run menu -- --list-skills
```

### Bootstrap npm 包

对外发布的 npm bootstrap 包独立放在：

```text
packages/agentframework-cli
```

它只负责提供 `agent-menu` 命令入口，并在运行时：

- 从 git 同步最新 runtime 仓库内容。
- 检查本地缓存里的 runtime 版本是否落后。
- 必要时更新依赖后再启动 runtime。
- 执行模板拉取时，把选中的 skills 同步到当前项目的 `.agents/skills`。
- 写入 `.agents/template-lock.json`，并在缺失时生成项目级 `AGENTS.md`。

也就是说，后续你主要维护这个仓库里的 runtime 即可；只有 bootstrap 启动逻辑变更时，才需要重新发布 npm 包。

常用 bootstrap 操作：

```bash
npm --prefix packages/agentframework-cli pack --dry-run
npm --prefix packages/agentframework-cli publish --access public
```

## 面向不同 AI 工具的思路

这个仓库本身是“中立源仓库”，不要求所有工具都直接识别 `.agents/`。

更推荐的做法是：

- 在这里维护统一的规则源。
- 再按不同 AI 工具生成适配文件。
- 避免把某一个工具的私有格式当作唯一真相。

例如可以派生到：

- `AGENTS.md`
- `CLAUDE.md`
- `.github/copilot-instructions.md`
- `.github/instructions/*.instructions.md`

## 推荐演进顺序

建议按下面顺序逐步完善：

1. 先稳定 `skills/`。
2. 再补 `rules/`。
3. 再补 `stacks/`。
4. 最后补模板与同步脚本。

这样可以先把最常用、最容易复用的能力沉淀下来，再逐步扩展为完整的个人工作流系统。

## 一句话定位

这是一个以 `.agents/` 为核心的个人 AI Agent 规则源仓库，用来沉淀通用规则、技术栈约定、skills 和工作流，并向具体项目或具体 AI 平台输出可落地的配置与模板。

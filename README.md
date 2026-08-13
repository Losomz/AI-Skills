# PiCraft

个人 AI Agent 工作流、配置与模板仓库。

PiCraft 为 Pi 提供 Plan、Questionnaire、Permission、Subagent、Git、Init 和 Blog 工作流，同时沉淀可复用的 OpenCode skills、Codex Skills、Codex 配置和相关说明文档。GitHub 仓库仍使用 `AgentFramework` 名称，Pi package 名称为 `@losomz/picraft`。

## 当前目录结构

```text
AgentFramework/
├── agents/                         # 与具体 AI 工具无关的 agent 文档模板
│   ├── README.md
│   └── godot_sumeru.md
├── configs/
│   ├── global/                      # 全局配置源
│   │   ├── .codex/                  # Codex 全局配置与 agents
│   │   │   ├── agents/
│   │   │   └── config.toml
│   └── project/                     # 项目级配置源
│       ├── .agents/                 # 项目级 Codex Skills
│       └── .opencode/               # OpenCode commands / skills
├── packages/
│   └── picraft/                     # 独立发布的 @losomz/picraft
│       ├── extensions/              # Plan、Questionnaire、Permission 等
│       ├── prompts/
│       ├── skills/
│       ├── themes/
│       ├── package.json             # npm Pi package manifest
│       └── README.md                # npm / Pi Gallery 专用说明
├── docs/
│   ├── TECH_CHANGELOG.md
│   └── pi-global-config.md
├── package.json                    # private 综合仓库与 Git package manifest
└── README.md
```

> PiCraft npm 源码位于 `packages/picraft/`；其他工具配置继续位于 `configs/global/` 与 `configs/project/`。旧文档或历史脚本中提到的 `configs/.pi/`、`configs/.opencode/` 属于旧路径。

## 全局配置

### Pi

PiCraft 的 Pi 资源在 `packages/picraft/` 中作为独立 npm package 维护；仓库根 `package.json` 仅为 Git package 指向同一份源码。公开版本推荐通过 npm package 安装，不需要手工 clone 或复制扩展：

```bash
pi install npm:@losomz/picraft
pi list
```

安装后重启 Pi。Pi 会把 package 安装到自己的全局 npm 管理目录，并从中加载 Plan、Questionnaire、Permission、Subagent、Git、Init 和 Blog：

```text
~/.pi/agent/npm/
```

PiCraft 当前要求 Pi 0.80.4 或更高版本。Pi package extension 会以当前用户权限执行并可访问系统资源；内置 Permission 是工具调用审批层，不是操作系统沙箱，安装前应先审查源码。

后续更新全部 package：

```bash
pi update --extensions
```

只更新 PiCraft：

```bash
pi update npm:@losomz/picraft
```

更新后重启 Pi，或者在 Pi 中执行：

```text
/reload
```

卸载命令：

```bash
pi remove npm:@losomz/picraft
```

固定版本安装使用 `pi install npm:@losomz/picraft@0.1.3`。固定版本不会被 package 更新命令升级；需要升级时安装新的显式版本。

#### Git 来源

需要跟踪仓库主线或参与开发时，仍可使用 Git package：

```bash
pi install git:github.com/Losomz/AgentFramework
```

npm 与 Git 是两个不同的 package 身份，Pi 不会在两者之间自动去重。不要同时安装两个来源；从 Git 版本迁移到 npm 版本时，先运行 `pi remove git:github.com/Losomz/AgentFramework`，再运行 `pi install npm:@losomz/picraft`。

#### 意图询问

PiCraft 内置 `questionnaire` 工具。主 Agent 在已经检查代码、配置、文档和现有约定后，如果仍存在会实质影响结果的用户偏好或关键歧义，可以主动批量询问。TUI 支持逐题单选或多选、固定自由输入和最终 Review；RPC、JSON、Print 和独立 Subagent 不启用该工具，子 Agent 应把关键问题交回父对话。

#### 工具授权

PiCraft 内置 `permission/` 扩展，不需要安装第三方权限 package。策略采用 `allow / ask / deny` 三态：项目内普通操作、当前 worktree 的 Git 管理目录、Pi package 资源以及普通 sessions/logs 默认允许读取；访问其他外部路径，或读取 `.env`、`auth.json`、`models.json` 时询问。外层 Bash 使用 `nul`、`NUL`、`nul:`、`$null` 或 Windows 保留设备名作为路径时直接拒绝；Bash 空设备使用 `/dev/null`。修改 Pi 安装文件仍按外部写入处理。

审批提供 `Allow once / Allow always / Reject`。Always 只属于当前父对话并区分读写作用域；Subagent 会直接复用仍然有效的父授权，未匹配的请求才转交父 authority。授权提交后会释放同一规则覆盖的 pending 请求，`/permissions` 可查看或撤销；无 UI 或父 authority 不可用时默认拒绝。权限审批是工具调用策略层，不是操作系统沙箱。

#### 从手工扩展迁移

如果电脑上已经存在以下手工副本，安装 package 后它们不会被自动覆盖或删除：

```text
~/.pi/agent/extensions/plan/
~/.pi/agent/extensions/questionnaire/
~/.pi/agent/extensions/permission/
~/.pi/agent/extensions/subagent/
~/.pi/agent/extensions/git/
~/.pi/agent/extensions/init/
~/.pi/agent/extensions/blog/
```

本地副本与 package 副本同时加载会产生重复命令、工具、快捷键和事件处理器。首次迁移时运行 `pi config`，禁用上述本地入口并保留 package 入口；确认 package 正常后再备份或移除这些目录。不要删除整个 `~/.pi/agent/extensions/`，Orca 等其他扩展仍可能位于其中。

Package 只管理 manifest 声明的 extensions、skills、prompts 和 themes。以下机器配置不会随 package 分发：

- `auth.json`、`settings.json`、`models.json` 和 `keybindings.json`
- `sessions/` 和 `subagent-models.json`
- Orca 扩展、OpenCode/Codex 配置和外部 CLI

每台新电脑仍需独立完成 Pi 登录、模型和外部工具配置。

#### 本地开发

本仓库中的 Pi package 资源源路径为：

```text
packages/picraft/
```

在仓库根目录可临时只加载当前工作区版本，不修改已安装 package：

```bash
pi --no-extensions --no-skills --no-prompt-templates --no-themes -e .
```

手工映射仅作为开发或迁移备用，不能与 package 版本同时启用：

```text
packages/picraft/extensions/ -> ~/.pi/agent/extensions/
packages/picraft/prompts/    -> ~/.pi/agent/prompts/
packages/picraft/skills/     -> ~/.pi/agent/skills/
packages/picraft/themes/     -> ~/.pi/agent/themes/
```

详见 `docs/pi-global-config.md`。

### Codex

Codex 全局配置源位于：

```text
configs/global/.codex/
```

当前包含：

- `config.toml`：Codex 配置。
- `agents/`：Codex agent 配置，如 `explorer`、`reviewer`、`worker`。

## Pi 扩展

Pi 全局扩展源位于：

```text
packages/picraft/extensions/
```

当前扩展：

- `init/`：提供 `/init`，用基础说明和可选模板创建或更新目标项目的 `AGENTS.md`。
- `questionnaire/`：提供模型主动调用的意图澄清工具，支持批量问题、单选、多选和自由输入。
- `permission/`：提供项目边界与敏感文件审批，以及 `/permissions` 会话授权管理。
- `plan/`：提供 `/plan` 计划模式，限制写工具并注入规划提示。
- `subagent/`：提供子代理工具、`#AgentName` 快捷委派、per-agent 模型与 thinking 配置面板，以及内置 `General` / `Explore` / `Scout`。
- `git/`：提供 `/git` 分层入口，包括 commit、pull、branch 等 Git 工作流。
- `blog/`：提供 `/blog` 文件化日志工作流，如 product、tech、release、work。

每个扩展目录下的 `README.md` 记录该扩展的具体命令、结构和维护方式。

`/blog` 仅维护上述全局源；项目模板不再保留项目级副本。更新 PiCraft package 并执行 `/reload` 后即可使用最新流程。

## `/init` 模板

`/init` 扩展目录：

```text
packages/picraft/extensions/init/
```

模板目录：

```text
packages/picraft/extensions/init/templates/
```

当前模板：

- `cocos-noelle.md`：Cocos Creator + Noelle 框架项目的 `AGENTS.md` 初始化素材。
- `godot_sumeru.md`：Godot 4.x + Sumeru 框架项目的 `AGENTS.md` 初始化素材。

用法示例：

```text
/init
/init default
/init cocos-noelle
/init godot_sumeru
```

模板只是初始化素材 / checklist，不应被直接复制到目标项目 `AGENTS.md`。`/init` 会结合基础说明、模板和目标仓库事实，生成或更新项目自己的 `AGENTS.md`。

## 项目级配置

项目级配置源位于：

```text
configs/project/
```

常见映射：

```text
configs/project/.agents/   -> <project>/.agents/
configs/project/.opencode/ -> <project>/.opencode/
```

`AGENTS.md` 是项目上下文文件，通常放在项目根目录，不放在 `.pi/` 里。

### Codex Skills

Codex 项目级 Skill 模板源位于：

```text
configs/project/.agents/skills/
```

当前包含：

- `publish-release-build/`：安全准备发布说明、合并发布分支并以标签触发目标仓库已有的 CI 构建流程。

### OpenCode

OpenCode 项目级配置源位于：

```text
configs/project/.opencode/
```

当前包含：

- `commands/`：OpenCode 命令模板，如 commit、changelog。
- `skills/`：OpenCode skills，包括 Cocos、Unity、中文编码等。
- `opencode.json`：OpenCode 配置文件。

## 通用 agent 文档

`agents/` 目录保留与具体工具无关的 agent 文档模板，例如：

```text
agents/godot_sumeru.md
```

如果是给 Pi `/init` 使用的项目初始化模板，应优先放到：

```text
packages/picraft/extensions/init/templates/
```

## 维护注意事项

- 不要把运行时数据、登录凭据、会话记录、缓存目录提交进模板源。
- Pi extensions、skills、prompts 和 themes 优先通过 PiCraft package 管理；手工同步时只覆盖明确管理的文件或子目录，不要整体替换 `~/.pi/agent/`。
- 不要同时启用 package 版本与 `~/.pi/agent/extensions/` 中的同名手工扩展。
- `/init` 模板只提供可复用检查项，目标项目的命令、路径、框架事实必须重新核验。
- OpenCode skills、Pi extensions、Codex agents / skills 分别维护在各自配置目录，避免混放。
- 历史变更记录见 `docs/TECH_CHANGELOG.md`。

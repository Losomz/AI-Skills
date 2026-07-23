# AgentFramework

个人 AI Agent 配置与模板仓库。

本仓库用于沉淀可复用的全局 / 项目级 Agent 配置、Pi 扩展、初始化模板、OpenCode skills、Codex Skills、Codex 配置和相关说明文档。

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
│   │   └── .pi/agent/               # Pi 全局配置源，对应 ~/.pi/agent/
│   │       ├── extensions/
│   │       │   ├── blog/            # /blog 文件化日志工作流
│   │       │   ├── git/             # /git 分层 Git 操作入口
│   │       │   ├── init/            # /init 与 AGENTS.md 初始化模板
│   │       │   ├── plan/            # /plan 计划模式
│   │       │   └── subagent/        # 子代理扩展与内置 agents
│   │       ├── prompts/
│   │       ├── skills/
│   │       └── themes/
│   └── project/                     # 项目级配置源
│       ├── .agents/                 # 项目级 Codex Skills
│       └── .opencode/               # OpenCode commands / skills
├── docs/
│   ├── TECH_CHANGELOG.md
│   └── pi-global-config.md
└── README.md
```

> 当前主线结构是 `configs/global/` 与 `configs/project/`。旧文档或历史脚本中提到的 `configs/.pi/`、`configs/.opencode/` 属于旧路径。

## 全局配置

### Pi

Pi 官方全局配置目录：

```text
~/.pi/agent/
```

本仓库对应源路径：

```text
configs/global/.pi/agent/
```

常见映射：

```text
configs/global/.pi/agent/extensions/ -> ~/.pi/agent/extensions/
configs/global/.pi/agent/prompts/    -> ~/.pi/agent/prompts/
configs/global/.pi/agent/skills/     -> ~/.pi/agent/skills/
configs/global/.pi/agent/themes/     -> ~/.pi/agent/themes/
```

同步 Pi 全局配置后，在 Pi 中执行：

```text
/reload
```

不要全量删除或覆盖整个 `~/.pi/agent/`，避免误删 `auth.json`、`sessions/` 等运行时数据。详见 `docs/pi-global-config.md`。

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
configs/global/.pi/agent/extensions/
```

当前扩展：

- `init/`：提供 `/init`，用基础说明和可选模板创建或更新目标项目的 `AGENTS.md`。
- `plan/`：提供 `/plan` 计划模式，限制写工具并注入规划提示。
- `subagent/`：提供子代理工具、`#AgentName` 快捷委派、per-agent 模型与 thinking 配置面板，以及内置 `General` / `Explore` / `Scout`。
- `git/`：提供 `/git` 分层入口，包括 commit、pull、branch 等 Git 工作流。
- `blog/`：提供 `/blog` 文件化日志工作流，如 product、tech、release、work。

每个扩展目录下的 `README.md` 记录该扩展的具体命令、结构和维护方式。

`/blog` 仅维护上述全局源；项目模板不再保留项目级副本。同步全局配置后执行 `/reload` 即可使用最新流程。

## `/init` 模板

`/init` 扩展目录：

```text
configs/global/.pi/agent/extensions/init/
```

模板目录：

```text
configs/global/.pi/agent/extensions/init/templates/
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
configs/global/.pi/agent/extensions/init/templates/
```

## 维护注意事项

- 不要把运行时数据、登录凭据、会话记录、缓存目录提交进模板源。
- Pi 全局配置同步时只覆盖被管理的文件或子目录，不要整体替换 `~/.pi/agent/`。
- `/init` 模板只提供可复用检查项，目标项目的命令、路径、框架事实必须重新核验。
- OpenCode skills、Pi extensions、Codex agents / skills 分别维护在各自配置目录，避免混放。
- 历史变更记录见 `docs/TECH_CHANGELOG.md`。

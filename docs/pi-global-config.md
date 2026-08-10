# Pi 配置结构

Pi 官方把配置分为全局配置和项目级配置：

```text
全局配置: ~/.pi/agent/
项目配置: <project>/.pi/
```

项目级配置会覆盖全局配置；`settings.json` 里的嵌套对象会合并。

## PiCraft Git Package

PiCraft 的 Pi 资源由仓库根目录 `package.json` 显式声明。日常安装和更新优先使用 Pi 的 Git package 管理，不再把扩展手工复制到全局目录：

```bash
pi install git:github.com/Losomz/AgentFramework
pi list
```

默认是用户级安装，Pi 会把 clone 管理在：

```text
~/.pi/agent/git/github.com/Losomz/AgentFramework/
```

更新全部 package 或只更新 PiCraft：

```bash
pi update --extensions
pi update git:github.com/Losomz/AgentFramework
```

更新后重启 Pi，或者执行 `/reload`。卸载使用：

```bash
pi remove git:github.com/Losomz/AgentFramework
```

未指定 Git tag、commit 或 branch 时，Pi 会跟踪远程默认分支。启动时发现本地 clone `HEAD` 落后于远程默认分支后会提示更新，但不会静默应用。

Package 当前加载：

```text
configs/global/.pi/agent/extensions/plan/index.ts
configs/global/.pi/agent/extensions/questionnaire/index.ts
configs/global/.pi/agent/extensions/subagent/index.ts
configs/global/.pi/agent/extensions/git/index.ts
configs/global/.pi/agent/extensions/init/index.ts
configs/global/.pi/agent/extensions/blog/index.ts
configs/global/.pi/agent/extensions/permission/index.ts
configs/global/.pi/agent/skills/
configs/global/.pi/agent/prompts/
configs/global/.pi/agent/themes/
```

`auth.json`、`settings.json`、`models.json`、`keybindings.json`、`sessions/`、`subagent-models.json`、Orca 扩展和外部 CLI 不属于 package，每台机器独立管理。

### 意图询问

PiCraft 注册 `questionnaire` 工具，让主 Agent 在无法从代码、配置、文档和项目约定推导关键用户意图时主动询问。相关问题会批量展示，每题可使用单选或多选并固定提供自由输入；多题通过标签页和 Review 集中提交，未回答项会明确返回 `Unanswered`，不使用超时自动选择。

TUI 使用富交互界面。RPC、JSON、Print 与独立 Subagent 不提供 Pi TUI，扩展会从 active tools 移除该工具；子 Agent 应把关键歧义返回父对话。若已安装其他同名 `questionnaire` 扩展，应在 `pi config` 中只保留一个入口。

### 工具授权

PiCraft 自带 `permission/` 扩展，不需要额外安装权限 package。Plan 在 manifest 中最先加载，因此 Plan 的只读守卫先执行；Execute 模式下，项目内普通操作和当前 worktree 的 Git 管理目录默认允许。Pi 核心、插件、package、skills、当前消息附件和精确工具输出可直接读取；其他外部路径以及 `.env`、`auth.json`、`models.json`、sessions 和权限日志读取会询问，整个临时目录不会被加入白名单。

审批支持允许一次、当前父对话允许和拒绝。Always 规则由父对话的集中 authority 管理并区分读写作用域；Subagent 通过会话期授权快照直接复用仍有效的规则，未匹配请求通过文件邮箱交给父 authority，Subagent 本身仍使用 `--mode json -p --no-session`。authority 的授权源只存于父进程内存，快照和邮箱位于 Pi sessions 目录并在会话结束时失效；`/permissions` 可查看、撤销或清空。无 UI、父 authority 不可用或 IPC 校验失败时默认拒绝。该扩展是工具调用审批层，不是操作系统安全边界。

### 从手工副本迁移

Pi package 的管理目录与 `~/.pi/agent/extensions/` 相互独立。安装 package 不会覆盖已经手工复制的同名扩展；两者同时启用会产生重复命令、快捷键和事件处理器。

首次迁移步骤：

1. 执行 `pi install git:github.com/Losomz/AgentFramework`。
2. 执行 `pi config`，禁用 `~/.pi/agent/extensions/` 中的 Plan、Subagent、Git、Init 和 Blog 入口，保留 package 入口。
3. 重启 Pi，确认 `/plan`、`/permissions`、`/subagent`、`/git`、`/init` 和 `/blog` 各只有一个入口。
4. 确认功能正常后，备份或移除上述五个本地扩展目录。

不要删除整个 `~/.pi/agent/extensions/`，以免影响 Orca 或其他本地扩展。后续同步流程也不能再次复制这五个目录，否则重复扩展会重新出现。

### 本地开发验证

在仓库根目录运行：

```bash
pi --no-extensions --no-skills --no-prompt-templates --no-themes -e .
```

`--no-*` 参数会忽略 settings 和自动发现的同类资源，`-e .` 仍会显式加载当前仓库 package，适合在不干扰已安装版本的情况下验证修改。

## 本仓库路径约定

```text
configs/global/   # 全局配置源
configs/project/  # 项目级配置源
```

旧文档或旧脚本里出现的 `configs/.pi/`、`configs/.opencode/` 是历史路径；当前主线应使用 `configs/global/` 和 `configs/project/`。

## 全局配置手工同步（备用）

本仓库中 Pi 全局配置源目录是：

```text
configs/global/.pi/agent/
├── extensions/
├── prompts/
├── skills/
└── themes/
```

仅在本地开发、迁移或应急回退时按被管理的文件或子目录逐项同步。手工同步版本不能与 PiCraft package 同时启用，也不要全量删除或覆盖整个 `~/.pi/agent/`。对应关系是：

```text
configs/global/.pi/agent/extensions/ -> ~/.pi/agent/extensions/
configs/global/.pi/agent/prompts/    -> ~/.pi/agent/prompts/
configs/global/.pi/agent/skills/     -> ~/.pi/agent/skills/
configs/global/.pi/agent/themes/     -> ~/.pi/agent/themes/
```

`auth.json`、`sessions/` 等运行时数据保留在本机，不纳入模板同步。

不要同步这些运行时或敏感文件：

- `~/.pi/agent/auth.json`
- `~/.pi/agent/sessions/`
- `~/.pi/agent/subagent-models.json`：`/subagent` 配置面板生成的本机 per-agent 模型与 thinking 覆盖
- `~/.pi/agent/pi-debug.log`
- `~/.pi/agent/npm/`
- `~/.pi/agent/git/`
- `~/.pi/agent/bin/`

Pi 官方可识别的常用全局文件还包括：

- `AGENTS.md`：全局上下文指令
- `SYSTEM.md`：替换默认 system prompt
- `APPEND_SYSTEM.md`：追加 system prompt
- `keybindings.json`：全局快捷键
- `models.json`：自定义 providers/models

这些文件有实际内容时再加入 `configs/global/.pi/agent/`。

## Pi `/init` 扩展

`/init` 扩展属于 Pi 全局扩展，源路径是：

```text
configs/global/.pi/agent/extensions/init/
```

关键文件：

```text
configs/global/.pi/agent/extensions/init/index.ts
configs/global/.pi/agent/extensions/init/prompts/base.md
configs/global/.pi/agent/extensions/init/templates/
```

`prompts/base.md` 是所有 `/init` 都会注入的基础说明。`templates/*.md` 是可选初始化模板，例如：

```text
configs/global/.pi/agent/extensions/init/templates/cocos-noelle.md
configs/global/.pi/agent/extensions/init/templates/godot_sumeru.md
```

模板只是创建或更新目标项目 `AGENTS.md` 的素材和 checklist，不是最终输出；目标项目中的事实、命令、路径和框架规则仍必须在目标仓库内重新核验。

## 项目级配置

Pi 官方项目级配置目录是项目根目录下的 `.pi/`：

```text
<project>/
├── AGENTS.md              # 项目上下文指令；Pi 会从当前目录向上查找 AGENTS.md/CLAUDE.md
└── .pi/
    ├── settings.json      # 项目设置；覆盖/合并全局 settings.json
    ├── SYSTEM.md          # 项目级 system prompt，替换默认 system prompt
    ├── APPEND_SYSTEM.md   # 项目级追加 system prompt
    ├── extensions/        # 项目级 extensions
    ├── skills/            # 项目级 skills
    ├── prompts/           # 项目级 prompt templates
    ├── themes/            # 项目级 themes
    ├── npm/               # `pi install -l` 的 npm 包运行目录
    └── git/               # `pi install -l` 的 git 包运行目录
```

本仓库中的 Pi 项目级配置源路径是：

```text
configs/project/.pi/
```

常见项目级映射：

```text
configs/project/.pi/settings.json    -> <project>/.pi/settings.json
configs/project/.pi/extensions/      -> <project>/.pi/extensions/
configs/project/.pi/skills/          -> <project>/.pi/skills/
configs/project/.pi/prompts/         -> <project>/.pi/prompts/
configs/project/.pi/themes/          -> <project>/.pi/themes/
configs/project/.pi/SYSTEM.md        -> <project>/.pi/SYSTEM.md
configs/project/.pi/APPEND_SYSTEM.md -> <project>/.pi/APPEND_SYSTEM.md
AGENTS.md                            -> <project>/AGENTS.md，不在 .pi/ 里
```

项目级 `settings.json` 示例：

```json
{
  "defaultThinkingLevel": "medium",
  "compaction": {
    "reserveTokens": 8192
  },
  "extensions": ["./extensions"],
  "skills": ["./skills"],
  "prompts": ["./prompts"],
  "themes": ["./themes"]
}
```

注意：

- `AGENTS.md`/`CLAUDE.md` 是项目上下文文件，放在项目根目录或父目录，不是 `.pi/AGENTS.md`。
- `keybindings.json` 和 `models.json` 按官方文档是全局文件，放在 `~/.pi/agent/`。
- 项目级包用 `pi install -l ...` 安装，会写入项目 `.pi/settings.json`，包目录在 `.pi/npm/` 或 `.pi/git/`。
- 项目级 `.pi/npm/`、`.pi/git/`、会话目录等运行时内容通常不要纳入模板同步。

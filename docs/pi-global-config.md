# Pi 配置结构

Pi 官方把配置分为全局配置和项目级配置：

```text
全局配置: ~/.pi/agent/
项目配置: <project>/.pi/
```

项目级配置会覆盖全局配置；`settings.json` 里的嵌套对象会合并。

## 本仓库路径约定

当前仓库把配置源分为两类：

```text
configs/global/   # 全局配置源
configs/project/  # 项目级配置源
```

旧文档或旧脚本里出现的 `configs/.pi/`、`configs/.opencode/` 是历史路径；当前主线应使用 `configs/global/` 和 `configs/project/`。

## 全局配置

本仓库中 Pi 全局配置源目录是：

```text
configs/global/.pi/agent/
├── extensions/
├── prompts/
├── skills/
└── themes/
```

同步到本机全局 Pi 配置时，应按被管理的文件或子目录逐项同步，不要全量删除或覆盖整个 `~/.pi/agent/`。对应关系是：

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
- `~/.pi/agent/subagent-models.json`：`/subagent-model` 生成的本机 per-agent 模型覆盖
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

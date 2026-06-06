# Pi 配置结构

Pi 官方把配置分为全局配置和项目级配置：

```text
全局配置: ~/.pi/agent/
项目配置: <project>/.pi/
```

项目级配置会覆盖全局配置；`settings.json` 里的嵌套对象会合并。

## 全局配置

本仓库用下面的源目录跟 Pi 官方全局结构保持一致：

```text
configs/.pi/agent/
├── settings.json
├── extensions/
├── skills/
├── prompts/
└── themes/
```

同步到本机全局 Pi 配置时，应按被管理的文件/子目录逐项同步，不要全量删除或覆盖整个 `~/.pi/agent/`。对应关系是：

```text
configs/.pi/agent/settings.json  -> ~/.pi/agent/settings.json
configs/.pi/agent/extensions/    -> ~/.pi/agent/extensions/
configs/.pi/agent/skills/        -> ~/.pi/agent/skills/
configs/.pi/agent/prompts/       -> ~/.pi/agent/prompts/
configs/.pi/agent/themes/        -> ~/.pi/agent/themes/
```

`auth.json`、`sessions/` 等运行时数据保留在本机，不纳入模板同步。

不要同步这些运行时或敏感文件：

- `~/.pi/agent/auth.json`
- `~/.pi/agent/sessions/`
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

这些文件有实际内容时再加入 `configs/.pi/agent/`。

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

常见项目级映射：

```text
.pi/settings.json   -> 项目设置
.pi/extensions/     -> 项目专用扩展
.pi/skills/         -> 项目专用技能
.pi/prompts/        -> 项目专用提示模板
.pi/themes/         -> 项目专用主题
.pi/SYSTEM.md       -> 项目级替换 system prompt
.pi/APPEND_SYSTEM.md -> 项目级追加 system prompt
AGENTS.md           -> 项目上下文指令，不在 .pi/ 里
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

# OpenCode 配置

这个目录包含针对 OpenCode AI 工具的专用配置。

## 目录结构

```
.opencode/
├── skills/          # OpenCode 格式的 skills
│   ├── cocos-developer/
│   ├── cocos-general/
│   ├── cocos-code-review/
│   ├── chinese-encoding/
│   └── Unity-general/
└── commands/        # OpenCode 的 commands
    └── commit.md    # Git 提交命令
```

## Skills

Skills 是可以被 OpenCode 加载的专项能力包，使用 `SKILL.md` 格式定义。

## Commands

Commands 是 OpenCode 的自定义命令，可以通过命令面板调用。

## 同步到项目

使用 CLI 工具将这些配置同步到你的项目：

```bash
npm run menu
# 选择：拉取模板到当前项目
# 选择：OpenCode
# 选择：Cocos 开发模板
```

或者使用命令行参数：

```bash
npm run menu -- --pull-template=cocos-developer-template --tool=opencode
```

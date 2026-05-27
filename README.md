# AgentFramework

个人 AI Agent 配置与模板仓库。

这个仓库现在主要按一级目录组织可同步内容：

- `configs/`：各 AI 工具的可同步配置源，例如 Pi、OpenCode。同步时会全量覆盖目标配置目录。
- `agents/`：通用 agent 模板目录，例如 `godot_sumeru.md`。
- `docs/`：仓库文档与变更记录。

根目录的 `agent-sync.mjs` 是一个轻量同步脚本，用来把本仓库中的配置同步到当前项目。

## 目录结构

```text
AgentFramework/
├── agent-sync.mjs          # 项目内同步脚本
├── agents/                 # 通用 agent 模板
│   └── godot_sumeru.md     # Godot + Sumeru 项目代理模板
├── configs/
│   ├── .pi/                # Pi 配置源
│   │   └── extensions/     # Pi extensions
│   └── .opencode/          # OpenCode 配置源
│       ├── commands/
│       ├── skills/
│       └── opencode.json
├── docs/
└── README.md
```

## 同步用法

在目标项目根目录执行：

```bash
node agent-sync.mjs
```

脚本会先扫描仓库根目录下的一级文件夹，再进入二级菜单选择具体内容。

直接同步某个内容：

```bash
node agent-sync.mjs configs/.pi
node agent-sync.mjs configs/.opencode
node agent-sync.mjs agents/godot_sumeru.md
node agent-sync.mjs all
```

兼容旧配置名：

```bash
node agent-sync.mjs pi
node agent-sync.mjs opencode
```

跳过确认：

```bash
node agent-sync.mjs pi --yes
```

开发期从当前仓库本地同步，不拉远程：

```bash
node agent-sync.mjs pi --local --yes
```

只同步、不自动提交和推送：

```bash
node agent-sync.mjs pi --no-commit
```

## 当前同步内容

同步源来自仓库根目录下的一级文件夹。交互模式下会先选择一级文件夹，再选择该文件夹下的具体文件或目录。

### `configs/`

`configs/` 是特殊配置源，同步到目标项目时会去掉 `configs/` 前缀：

```text
configs/.pi       -> .pi
configs/.opencode -> .opencode
```

同步 `.pi` 后在 Pi 中执行：

```text
/reload
```

### `agents/`

其他一级文件夹默认保留路径同步：

```text
agents/godot_sumeru.md -> agents/godot_sumeru.md
```

因此后续可以按框架继续添加可区分的 agent 模板，例如：

```text
agents/godot_sumeru.md
agents/godot_other_framework.md
```

## 同步策略

同步脚本会先更新远程缓存，并在发现远程 `agent-sync.mjs` 版本号更高时自动覆盖当前脚本并重新执行。修改同步脚本后需要按 `x.y.z` 语义版本格式递增脚本内的 `SYNC_SCRIPT_VERSION`。

同步时直接删除目标文件或目录，再复制最新内容；不创建备份。

同步完成后会自动提交并推送同步产生的 Git 改动，提交信息按工具类型生成：

```text
✨ feat(pi): 工具升级
✨ feat(opencode): 工具升级
✨ feat(tools): 工具升级
```

如果目标目录不是 Git 仓库、同步路径没有可提交改动，或使用了 `--no-commit` / `--no-push`，则跳过自动提交和推送。

## 远程仓库配置

默认远程仓库：

```text
git@github.com:Losomz/AgentFramework.git
```

可用环境变量覆盖：

```bash
AGENTFRAMEWORK_REPO_URL=<repo-url>
AGENTFRAMEWORK_REF=main
AGENTFRAMEWORK_HOME=<cache-dir>
```

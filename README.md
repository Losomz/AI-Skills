# AgentFramework

个人 AI Agent 配置与模板仓库。

这个仓库现在主要按一级目录组织可同步内容:

- `configs/`:各 AI 工具的可同步配置源,例如 Pi、OpenCode。同步时会全量覆盖目标配置目录。
- `agents/`:通用 agent 模板目录,例如 `godot_sumeru.md`。
- `docs/`:仓库文档与变更记录。

- `agent-sync.mjs`:唯一入口。拉取缓存、自我升级、调用 `src/` 模块执行同步,最后暂停等待退出。

## 目录结构

```text
AgentFramework/
├── agent-sync.mjs          # 唯一入口,目标项目直接复制/执行
├── package.json
├── src/
│   ├── cli/                # 同步主流程、菜单、结果页(main.mjs 是同步模块入口)
│   ├── git/                # 自动提交推送
│   ├── sync/               # 同步目录扫描与复制规则
│   └── utils/              # 通用工具
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

## CLI 结构

当前是单文件结构:

- `agent-sync.mjs`:唯一入口,负责缓存拉取、自我升级、同步调度和退出前暂停。
- `src/`:同步主流程、菜单、结果页、同步规则、Git 自动提交等模块。
- `package.json`:预留包结构,当前 `private: true`,暂不发布 npm。

## 同步用法

将 `agent-sync.mjs` 复制到目标项目根目录,然后:

```bash
node agent-sync.mjs
```

脚本会先扫描仓库根目录下的一级文件夹,再通过同一个交互式向导选择具体内容并确认同步。

直接同步某个内容:

```bash
node agent-sync.mjs configs/.pi
node agent-sync.mjs configs/.opencode
node agent-sync.mjs agents/godot_sumeru.md
node agent-sync.mjs all
```

兼容旧配置名:

```bash
node agent-sync.mjs pi
node agent-sync.mjs opencode
```

跳过确认:

```bash
node agent-sync.mjs pi --yes
```

开发期从当前仓库本地同步,不拉远程:

```bash
node agent-sync.mjs pi --local --yes
```

只同步、不自动提交和推送:

```bash
node agent-sync.mjs pi --no-commit
```

不显示后续操作菜单,仅打印结果:

```bash
node agent-sync.mjs pi --no-result-menu
```

退出前不暂停等待(适合 CI/脚本自动化):

```bash
node agent-sync.mjs pi --no-pause
```

## 当前同步内容

同步源来自仓库根目录下的一级文件夹。交互模式下会先选择一级文件夹,再选择该文件夹下的具体文件或目录。

### `configs/`

`configs/` 是特殊配置源,同步到目标项目时会去掉 `configs/` 前缀:

```text
configs/.pi       -> .pi
configs/.opencode -> .opencode
```

同步 `.pi` 后在 Pi 中执行:

```text
/reload
```

### `agents/`

其他一级文件夹默认保留路径同步:

```text
agents/godot_sumeru.md -> agents/godot_sumeru.md
```

因此后续可以按框架继续添加可区分的 agent 模板,例如:

```text
agents/godot_sumeru.md
agents/godot_other_framework.md
```

## 同步策略

`agent-sync.mjs` 是唯一入口，在单进程中完成全部工作：先更新远程缓存，自我升级（如需），再调用 `src/` 模块同步。不在父子进程间 spawn。

同步时直接删除目标文件或目录,再复制最新内容;不创建备份。

同步结束后会显示结果页,明确展示同步是否成功、同步了哪些文件、Git 自动提交/推送状态以及后续提示。交互终端中还会提供后续操作菜单:继续同步其他内容、查看 Git 状态、重新执行本次同步或退出。失败时会显示错误信息和建议,并允许重试。

同步完成后会自动提交并推送同步产生的 Git 改动,提交信息按工具类型生成:

```text
✨ feat(pi): 工具升级
✨ feat(opencode): 工具升级
✨ feat(tools): 工具升级
```

如果目标目录不是 Git 仓库、同步路径没有可提交改动,或使用了 `--no-commit` / `--no-push`,则跳过自动提交和推送。

## 远程仓库配置

默认远程仓库:

```text
https://github.com/Losomz/AgentFramework.git
```

可用环境变量覆盖:

```bash
AGENTFRAMEWORK_REPO_URL=<repo-url>
AGENTFRAMEWORK_REF=main
AGENTFRAMEWORK_HOME=<cache-dir>
```

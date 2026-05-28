# AgentFramework

个人 AI Agent 配置与模板仓库。

这个仓库现在主要按一级目录组织可同步内容:

- `configs/`:各 AI 工具的可同步配置源,例如 Pi、OpenCode。同步时会全量覆盖目标配置目录。
- `agents/`:通用 agent 模板目录,例如 `godot_sumeru.md`。
- `docs/`:仓库文档与变更记录。

- `src/`:唯一的入口和同步模块。`src/cli/main.mjs` 负责缓存拉取、自我升级、同步调度和退出前暂停。其他模块处理菜单、同步规则、Git 自动提交等。

## 目录结构

```text
AgentFramework/
├── package.json
├── src/
│   ├── cli/                # 入口 + 参数、菜单、主流程(main.mjs 是唯一入口)
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

- `src/cli/main.mjs`:唯一入口,负责缓存拉取、自我升级、同步调度和退出前暂停。
- 其他 `src/` 模块:同步规则、菜单、Git、工具函数等。
- `package.json`:预留包结构,当前 `private: true`,暂不发布 npm。

## 同步用法

不需要在目标项目放置任何文件。只需从缓存运行入口:

```bash
# 首次自动克隆到 ~/.agentframework/repo,之后增量更新缓存
node ~/.agentframework/repo/src/cli/main.mjs
```

脚本会先扫描仓库根目录下的一级文件夹,再通过同一个交互式向导选择具体内容并确认同步。

直接同步某个内容:

```bash
node ~/.agentframework/repo/src/cli/main.mjs configs/.pi
node ~/.agentframework/repo/src/cli/main.mjs configs/.opencode
node ~/.agentframework/repo/src/cli/main.mjs agents/godot_sumeru.md
node ~/.agentframework/repo/src/cli/main.mjs all
```

兼容旧配置名:

```bash
node ~/.agentframework/repo/src/cli/main.mjs pi
node ~/.agentframework/repo/src/cli/main.mjs opencode
```

跳过确认:

```bash
node ~/.agentframework/repo/src/cli/main.mjs pi --yes
```

开发期从当前仓库本地同步,不拉远程:

```bash
node src/cli/main.mjs pi --local --yes
```

只同步、不自动提交和推送:

```bash
node ~/.agentframework/repo/src/cli/main.mjs pi --no-commit
```

不显示后续操作菜单,仅打印结果:

```bash
node ~/.agentframework/repo/src/cli/main.mjs pi --no-result-menu
```

退出前不暂停等待(适合 CI/脚本自动化):

```bash
node ~/.agentframework/repo/src/cli/main.mjs pi --no-pause
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

`src/cli/main.mjs` 是唯一入口，在单进程中完成全部工作：先更新远程缓存，自我升级（如需），再同步。不在父子进程间 spawn。修改引导逻辑后需要递增脚本内的 `SCRIPT_VERSION`。

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

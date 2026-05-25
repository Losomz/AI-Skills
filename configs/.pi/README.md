# Pi 配置说明

本项目使用 [pi](https://github.com/earendil-works/pi-mono) 作为 AI 编码助手。

## 目录结构

```
.pi/
├── README.md           # 本文档
├── models.json         # 自定义 provider 配置
└── extensions/         # 扩展脚本
    ├── blog/           # /blog 文件化日志工作流入口
    │   ├── common/     # 通用流程提示词
    │   └── workflows/  # 可发现的日志类型提示词
    ├── git/            # /git Git 操作入口
    └── subagent/       # 子 agent 扩展
        ├── index.ts
        ├── agents.ts
        └── agents/     # 子 agent 定义
```

## 自定义 Provider 配置

### models.json

本项目使用自定义的 `yunyi-claude` provider，配置在 `.pi/models.json` 中：

```json
{
  "providers": {
    "yunyi-claude": {
      "baseUrl": "https://yunyi.cfd/claude/v1",
      "api": "openai-completions",
      "apiKey": "YOUR_API_KEY",
      "models": [
        {
          "id": "claude-opus-4-7",
          "name": "Claude Opus 4.7",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 200000,
          "maxTokens": 16384
        }
      ]
    }
  }
}
```

### 配置层级

Pi 支持两个层级的 `models.json`：

1. **项目级别**：`.pi/models.json`（当前项目专用，优先级更高）
2. **用户级别**：`~/.pi/agent/models.json`（全局所有项目）

项目级别的配置会覆盖用户级别的同名 provider。

### API Key 管理

**方式 1：直接写入（不推荐提交到 git）**
```json
{
  "providers": {
    "yunyi-claude": {
      "apiKey": "DBWGSPEW-UADK-WQBN-3ZDE-9G1QQ9HVW2F6"
    }
  }
}
```

**方式 2：使用环境变量（推荐）**
```json
{
  "providers": {
    "yunyi-claude": {
      "apiKey": "YUNYI_API_KEY"
    }
  }
}
```

然后在环境中设置：
```bash
export YUNYI_API_KEY="your-actual-key"
```

**方式 3：使用 shell 命令**
```json
{
  "providers": {
    "yunyi-claude": {
      "apiKey": "!op read 'op://vault/yunyi/api-key'"
    }
  }
}
```

## Blog 日志生成扩展

`extensions/blog/` 提供单入口 `/blog` 命令，用来从 Git 历史生成不同受众的项目日志，避免占用 Pi 内置 `/changelog`。

`/blog` 现在走文件化工作流：`index.ts` 只负责扫描 `extensions/blog/workflows/*.md`、展示带描述的可选项，并拉起 `subagent` chain；具体写给谁、写哪个文件、是否提交、是否打 tag、是否 push 都由对应 Markdown workflow 的提示词决定。未在命令后直接提供核心标准时，会弹出可留空输入框；填写内容会作为日志筛选、摘要角度、写法和内容取舍的核心标准。

目录结构：

```text
extensions/blog/
├── common/pre-commit.md     # 日志前结余提交提示词
└── workflows/
    ├── product.md           # 面向消费者/玩家/用户；默认提交、打 tag、push
    ├── tech.md              # 面向技术人员；默认提交、打 tag、push
    └── work.md              # 面向公司内部；默认提交并 push，不打 tag
```

可用命令来自 workflow 文件：

```text
/blog             # 弹出带描述菜单选择 workflows/*.md，并询问可选核心标准
/blog product     # 运行 workflows/product.md；未附加文字时询问可选核心标准
/blog tech        # 运行 workflows/tech.md；未附加文字时询问可选核心标准
/blog work        # 运行 workflows/work.md；未附加文字时询问可选核心标准
/blog tech 重点写架构调整  # 直接把后面的文字作为核心标准
```

新增日志类型时只需添加新的 `workflows/<name>.md`，不需要改 TypeScript。

## 子 Agent 配置

### Agent 定义格式

子 agent 定义集中放在 `.pi/extensions/subagent/agents/`，使用 Markdown frontmatter 格式：

```markdown
---
name: General
description: 一个用于研究复杂问题和执行多步骤任务的通用代理
tools: read, grep, find, ls, bash, edit, write
# plan mode 策略：auto = plan 下可主动调用；explicit = 用户点名才允许；deny = plan 下禁用
# 不写时：纯只读工具推断为 auto，未声明工具或含写工具推断为 explicit
planMode: explicit
# 可选；不写则使用当前默认模型
# model: provider/model
---

Agent 的系统提示词内容...
```

### 模型配置

默认不在 agent 定义里固定模型，让子 agent 使用当前 Pi 默认模型。

如需为某个子 agent 固定模型，可添加 `model: provider/model`：

```yaml
model: wanwu/gpt-5.5
```

不要使用分开的字段：

```yaml
# ❌ 错误方式
provider: wanwu
model: gpt-5.5
```

### 使用入口

```text
/agents                         # 选择 Agent 并输入任务
/agents General <任务>          # 运行通用可写代理
/agents Explore <任务>          # 运行代码库只读探索代理
/agents Scout <任务>            # 运行外部依赖/文档研究代理
```

### 可用的 Agent

#### General

用于研究复杂问题和执行多步骤任务的通用代理。拥有完整工具访问权限，可以在需要时修改文件，也可用于并行运行多个工作单元。

#### Explore

用于探索代码库的快速只读代理。无法修改文件。适合按模式快速查找文件、搜索代码关键字、回答代码库问题。

#### Scout

用于外部文档和依赖研究的只读代理。适合克隆依赖仓库到托管缓存、检查库源码，或在不修改工作区的情况下与 upstream 实现交叉对照。

### Plan mode 策略

子 agent 可通过 frontmatter 声明在 plan mode 下的行为：

```yaml
planMode: auto      # 主模型可在 plan mode 下主动调用
planMode: explicit  # 只有用户明确点名该 agent 时才允许
planMode: deny      # plan mode 下完全禁用
```

当前默认：`Explore`、`Scout` 为 `auto`；`General` 为 `explicit`。因此 plan mode 仍限制主对话只读，但用户可以明确要求 `General` 子进程执行提交等有副作用任务。

### Worktree 隔离

当前版本不启用 Git worktree 隔离。`General` 会直接在当前工作区操作；并行运行多个可写 `General` agent 时请谨慎。

## 常见问题

### Q: Subagent 启动失败，提示 "No API key found"

**原因**：Subagent 进程不会自动加载 extensions，只会读取 `models.json`。

**解决方案**：
1. 确保 `.pi/models.json` 或 `~/.pi/agent/models.json` 存在
2. 如果 agent 定义里写了 `model:`，确保使用 `provider/model` 格式且模型存在
3. 重启 pi 或执行 `/reload` 让配置生效

### Q: 如何在多个项目间共享配置？

将配置放在用户级别：`~/.pi/agent/models.json`

### Q: 如何为不同项目使用不同的 API key？

在项目的 `.pi/models.json` 中配置，它会覆盖全局配置。

### Q: 如何避免将 API key 提交到 git？

**方式 1**：将 `.pi/models.json` 加入 `.gitignore`

**方式 2**：使用环境变量或 shell 命令方式配置 API key

**方式 3**：提交模板文件 `.pi/models.json.example`，实际的 `models.json` 不提交

## 参考文档

- [Pi 官方文档](https://github.com/earendil-works/pi-mono)
- [自定义模型配置](https://github.com/earendil-works/pi-mono/blob/main/docs/models.md)
- [Provider 配置](https://github.com/earendil-works/pi-mono/blob/main/docs/providers.md)
- [扩展开发](https://github.com/earendil-works/pi-mono/blob/main/docs/extensions.md)

## 更新日志

### 2026-05-14
- 初始化项目 pi 配置
- 配置 yunyi-claude 自定义 provider
- 创建子 agent 配置，当前收敛为 `General`、`Explore`、`Scout`
- 子 agent 定义集中到 `.pi/extensions/subagent/agents/`，默认使用当前模型

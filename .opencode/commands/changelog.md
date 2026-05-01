---
description: 生成面向玩家的更改日志
agent: general
---

生成更改日志（docs/CHANGELOG.md）

## 目标

从上次 Git tag 到当前 HEAD，分析所有 commits，生成面向玩家的更改日志。

## 核心要求

1. **面向玩家**：使用玩家能理解的语言，不要技术术语
2. **关注体验**：说明改动对玩家的好处和影响
3. **自动完成**：不需要用户手动编辑
4. **中文输出**：所有内容使用中文
5. **自动版本号**：根据改动类型自动判断和递增版本号

## 流程

### 0. 前置提交检查

生成更改日志前必须先检查工作区，确保 changelog 只基于已经提交的改动生成。

1. **检查未提交内容**：
   ```bash
   git status --short
   ```

2. **如果存在未提交内容，先提交业务改动**：
   - 不要直接调用 `/commit`，当前流程固定手动执行 `/commit` 等价操作。
   - 业务提交阶段不要包含 `docs/CHANGELOG.md`。
   - 先提交功能、修复、资源、场景、配置等真实改动；提交完成后再进入 changelog 生成。

3. **手动执行 `/commit` 等价流程**：
   ```bash
   git status --short
   git diff
   git diff --cached
   git log --oneline -10
   ```
   - 分析暂存和未暂存改动，确认提交范围。
   - 不提交密钥、`.env`、凭据等敏感文件。
   - 根据改动生成准确的 commit message。
   - 执行：
     ```bash
     git add <相关文件>
     git commit -m "<commit message>"
     ```
   - 提交后再次运行 `git status --short --branch` 验证。

4. **如果涉及 Git 子模块**：
   - 先进入子模块检查状态并提交子模块内改动。
   - 再回到父仓库提交子模块指针和父仓库相关改动。
   - 不要把子模块未提交工作区直接留给父仓库 changelog 流程处理。

5. **如果没有未提交内容**：
   - 直接进入下一步，从上次 tag 到当前 HEAD 分析 commits。

### 1. 获取 commits

运行命令获取自上次 tag 以来的所有 commits。此时当前 HEAD 必须已经包含本次业务改动提交。

### 2. 分析每个 commit

对于每个 commit：

1. **获取详细信息**：
   ```bash
   git show <commit-hash> --stat
   ```

2. **判断是否包含**：
   - 跳过纯文档更新（只修改 .md 文件）
   - 跳过纯代码重构（无用户可见改动）
   - 跳过 chore、docs 类型的 commit

3. **AI 转换为玩家语言**：
   
   使用以下提示词让 AI 总结每个 commit：
   
   ```
   你是一个游戏更新日志撰写专家。
   
   任务：将技术性的 commit message 转换为玩家能理解的更新说明。
   
   要求：
   1. 使用玩家的语言，不要用技术术语（如"组件"、"系统"、"重构"等）
   2. 关注玩家的体验和感受
   3. 说明这个改动对玩家有什么好处
   4. 简洁明了，1-2 句话
   5. 使用中文
   6. 如果这个改动对玩家完全不可见（纯技术改动、代码重构、内部优化），输出"SKIP"
   
   示例转换：
   
   技术：feat: 新增 ScaleLoop 组件，支持循环缩放动画
   玩家：按钮现在会有呼吸动画效果，更容易吸引注意
   
   技术：fix: 修复 Tween repeatForever 不循环的问题
   玩家：修复了动画卡顿的问题，界面操作更流畅
   
   技术：feat: 实现关卡解锁系统，基于前置关卡通关状态
   玩家：关卡需要按顺序解锁，通关前一关才能挑战下一关
   
   技术：feat: 新增战斗金币飞行动画
   玩家：击杀敌人时金币会飞向金币框，更有打击感
   
   技术：refactor: 重构 Tween 循环逻辑，使用手动循环替代 repeatForever
   玩家：SKIP
   
   技术：chore: 更新 sumeru 子模块
   玩家：SKIP
   
   现在，请将以下 commit 转换为玩家视角的更新说明：
   
   Commit Message: [commit message]
   Changed Files: [files changed]
   
   只输出转换后的说明，不要其他内容。
   如果这个改动对玩家不可见，只输出"SKIP"。
   ```

4. **自动分类**：
   根据 commit 类型和内容分类：
   - `feat:` → 新增内容
   - `fix:` → 问题修复
   - `perf:`, `style:`, `ui:`, `improve:`, `optimize:` → 优化改进

### 3. 确定版本号

根据改动内容自动判断版本号：

1. **获取最新版本号**：
   - 运行 `git describe --tags --abbrev=0 2>/dev/null` 获取最新 tag
   - 如果没有 tag，从 `v0.0.1` 开始

2. **解析版本号**：
   - 格式：`vMAJOR.MINOR.PATCH`（如 `v0.1.0`）
   - 提取 MAJOR、MINOR、PATCH 三个数字

3. **判断递增规则**（语义化版本）：
   - **MINOR 版本递增**（0.X.0）：如果有"新增内容"分类且包含至少 1 项改动
   - **PATCH 版本递增**（0.0.X）：如果只有"优化改进"或"问题修复"
   - **MAJOR 版本递增**（X.0.0）：0.x.x 阶段不递增 MAJOR

4. **生成新版本号**：
   - MINOR 递增：`v0.1.0` → `v0.2.0`（PATCH 归零）
   - PATCH 递增：`v0.1.0` → `v0.1.1`

5. **生成日期**：
   - 格式：`YYYY-MM-DD`
   - 使用当前日期

### 4. 生成 docs/CHANGELOG.md

1. **检查 docs 目录是否存在**：
   - 如果不存在，创建 `docs/` 目录

2. **检查 CHANGELOG.md 是否存在**：
   - 如果不存在，创建新文件，包含标题和模板
   - 如果存在，读取现有内容

3. **生成新版本章节**：
   ```markdown
   ## [v0.1.0] - 2026-05-02
   
   > 自 <last-tag> 以来的改动（如果是首次生成，则为"自项目开始以来的改动"）
   
   ### 新增内容
   
   - [AI 生成的玩家语言描述]
   - [AI 生成的玩家语言描述]
   
   ### 优化改进
   
   - [AI 生成的玩家语言描述]
   
   ### 问题修复
   
   - [AI 生成的玩家语言描述]
   ```

4. **插入到文件中**：
   - 如果文件是新创建的，直接写入
   - 如果文件已存在：
     - 查找是否已有 `[未发布]` 章节，如果有则替换为新版本号
     - 如果没有 `[未发布]` 章节，在 `# 更改日志` 标题后插入新版本章节
   - 保留所有历史版本（`[v0.1.0]` 等）

5. **保存文件**

6. **单独提交 changelog 文件**：
   ```bash
   git add docs/CHANGELOG.md
   git commit -m "chore: 发布 v0.1.0 版本更新日志"
   ```
   - 这个提交只应包含 `docs/CHANGELOG.md`。
   - 不要把业务改动和 changelog 放在同一个提交里。

### 5. 创建 Git Tag

1. **创建 tag**（在刚才包含 changelog 的 commit 上）：
   ```bash
   git tag v0.1.0
   ```

2. **推送规则**：
   - 默认不要自动推送 commit 或 tag。
   - 只有用户明确要求推送时，才执行：
     ```bash
     git push
     git push origin v0.1.0
     ```

### 6. 输出结果

- 显示生成的更改日志内容
- 显示版本号和日期
- 告知用户文件已更新并提交：`docs/CHANGELOG.md`
- 告知用户已创建 Git tag：`v0.1.0`
- 如果用户要求推送，告知用户已推送 commit 和 tag；否则说明未推送

## 注意事项

### 1. 玩家语言转换原则

**好的示例**：
- ✅ "按钮现在会有呼吸动画效果"
- ✅ "关卡需要按顺序解锁"
- ✅ "击杀敌人时金币会飞向金币框"
- ✅ "修复了动画卡顿的问题"

**不好的示例**：
- ❌ "新增 ScaleLoop 组件"
- ❌ "实现关卡解锁系统"
- ❌ "重构 Tween 循环逻辑"
- ❌ "修复 repeatForever 不工作的 bug"

### 2. 跳过的内容

以下类型的 commit 应该输出 "SKIP"：
- 纯代码重构（refactor）
- 文档更新（docs）
- 构建配置（build、ci）
- 测试代码（test）
- 内部工具（chore）
- 子模块更新（除非有明确的功能说明）
- 只修改 .md、.gitignore、package.json 等配置文件

### 3. 分类原则

- **新增内容**：玩家能看到的新功能、新玩法、新内容
- **优化改进**：体验提升、性能优化、界面改进、操作优化
- **问题修复**：Bug 修复、问题解决、异常修复

### 4. 特殊情况处理

- 如果没有找到任何 tag，从 `v0.0.1` 开始，并生成所有 commits 的更改日志
- 如果所有 commits 都被跳过（都是技术改动），提示用户：自上次 tag 以来没有用户可见的改动
- 如果某个分类下没有任何条目，不要显示该分类的标题
- 如果只有"问题修复"和"优化改进"，没有"新增内容"，则递增 PATCH 版本
- 如果有"新增内容"，则递增 MINOR 版本

### 5. 版本号示例

**首次生成**（无 tag）：
- 版本号：`v0.0.1`

**有新功能**（从 `v0.0.1` 开始）：
- `v0.0.1` → `v0.1.0`（有新增内容）
- `v0.1.0` → `v0.2.0`（有新增内容）

**只有修复和优化**：
- `v0.1.0` → `v0.1.1`（只有修复/优化）
- `v0.1.1` → `v0.1.2`（只有修复/优化）

## GIT TAGS

!`git tag -l --sort=-version:refname | head -5`

## LATEST TAG

!`git describe --tags --abbrev=0 2>/dev/null || echo "No tags found"`

## COMMITS SINCE LAST TAG

!`git log $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD --oneline --no-merges`

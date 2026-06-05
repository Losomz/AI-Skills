# Unity AgentBridge Skill

AI Agent 与 Unity Editor 之间的 HTTP 通信桥梁，实现实时远程控制 Unity 场景。

## 架构概览

```
AI Agent → HTTP POST → AgentBridge Server (8081)
                            ↓
                    Main Thread Queue
                            ↓
                    CommandExecutor (switch-case)
                            ↓
                    独立命令类 (CreateCubeCommand 等)
                            ↓
                    Unity API 执行
                            ↓
                    JSON Response → AI Agent
```

## 核心组件

### 1. AgentBridgeServer.cs
HTTP Server 核心，负责：
- 监听 `http://127.0.0.1:8081`
- 主线程调度 (Queue + EditorApplication.update)
- 请求/响应处理

### 2. CommandExecutor.cs
命令路由器，负责：
- JSON 规范化（处理 curl 无引号格式）
- switch-case 路由到具体命令
- 统一错误处理

### 3. 独立命令类
每个命令一个文件：
- `CreateCubeCommand.cs` - 创建立方体
- 未来扩展...

### 4. CommandParams.cs
强类型参数定义：
- `CreateCubeParams` - 立方体参数 (x, y, z)
- `CommandResult` - 统一返回格式

## 使用方法

### 部署到 Unity 项目

```powershell
Copy-Item -Path ".agent/skills/AI-Unity-Skill/assets/templates/*" `
  -Destination "YourUnityProject" -Recurse -Force
```

### 发送命令

```powershell
# 创建立方体
curl.exe -X POST http://127.0.0.1:8081/execute `
  -d '{"command":"CreateCube","x":0,"y":1,"z":0}'

# 引用资产（SetReference）
curl.exe -X POST http://127.0.0.1:8081/execute `
  -d '{
    "command":"SetReference",
    "targetObjectId":-1234, 
    "componentType":"YourScript",
    "fieldName":"prefabField",
    "assetPath":"Assets/Prefabs/Enemy.prefab"
  }'

# 健康检查
curl.exe http://127.0.0.1:8081
```

## 添加新命令

### 1. 创建参数类 (CommandParams.cs)
```csharp
namespace Editor.AgentBridge.Commands {
    [Serializable]
    public class YourCommandParams : CommandParams
    {
        public int yourParam;
    }
}
```

### 2. 创建命令类 (YourCommand.cs)
```csharp
namespace Editor.AgentBridge.Commands.Impl {
    public class YourCommand
    {
        public string Execute(string json)
        {
            var param = JsonUtility.FromJson<YourCommandParams>(json);
            // 实现逻辑
            return CommandResult.Success().ToJson();
        }
    }
}
```

### 3. 注册到 Executor (CommandExecutor.cs)
```csharp
switch (baseParams.command)
{
    case "CreateCube":
        return ExecuteCreateCube(json);
    
    case "YourCommand":  // 添加这里
        return ExecuteYourCommand(json);
}

private static string ExecuteYourCommand(string json)
{
    var command = new YourCommand();
    return command.Execute(json);
}
```

## 技术细节

### JSON 解析
- 使用 Unity 内置 `JsonUtility`（零依赖）
- 自动规范化 curl 的无引号格式
- 强类型参数类确保类型安全

### 主线程安全
- 所有 Unity API 调用在主线程执行
- Queue + ManualResetEventSlim 同步机制
- 5秒执行超时保护

### 错误处理
- 三层错误捕获（HTTP、CommandExecutor、具体命令）
- 统一 JSON 错误格式
- Console 详细日志

## 目录结构

```
Assets/Editor/AgentBridge/
├── AgentBridgeServer.cs      # HTTP Server
└── Commands/
    ├── CommandParams.cs      # 参数定义
    ├── CommandExecutor.cs    # 路由器
    └── Impl/
        └── CreateCubeCommand.cs  # 命令实现
```

## 未来扩展

- [ ] 反射自动发现命令类
- [ ] JSON Schema 参数验证
- [ ] 命令权限控制
- [ ] 异步命令支持

## 许可证

MIT License
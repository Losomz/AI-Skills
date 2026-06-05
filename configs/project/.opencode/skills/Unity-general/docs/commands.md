# Unity Bridge 命令清单

## CreateCube - 创建立方体

### 功能
在 Unity 场景中创建一个立方体

### 请求格式
```json
{
  "command": "CreateCube",
  "x": 0,
  "y": 1,
  "z": 0
}
```

### 参数说明
- `command`: 固定值 "CreateCube"
- `x`: X 轴坐标（数字）
- `y`: Y 轴坐标（数字）
- `z`: Z 轴坐标（数字）

### 返回格式
```json
{
  "status": "success",
  "id": 12345,
  "name": "Cube"
}
```

### 返回说明
- `status`: 执行状态（"success" 或 "error"）
- `id`: 创建的物体实例 ID
- `name`: 物体名称

### 调用示例

**PowerShell**:
```powershell
curl.exe -X POST http://127.0.0.1:8081/execute -d '{"command":"CreateCube","x":0,"y":1,"z":0}'
```

**预期返回**:
```json
{"status":"success","id":12345,"name":"Cube"}
```

---

## 验证步骤

1. 确保 Unity 编辑器已启动
2. 确认 Console 显示：`[AI Bridge] Server started on http://127.0.0.1:8081`
3. 在终端执行上述命令
4. 检查 Unity Scene 视图，应出现一个立方体
5. 检查 Unity Console，应显示收到的请求日志

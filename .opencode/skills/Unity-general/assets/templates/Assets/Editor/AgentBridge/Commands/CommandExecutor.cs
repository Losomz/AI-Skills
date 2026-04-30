using System;
using Editor.AgentBridge.Commands.Impl;
using UnityEditor;
using UnityEngine;

namespace Editor.AgentBridge.Commands
{
    /// <summary>
    /// 命令执行器 - 负责路由和执行所有命令
    /// Phase 1: 使用 switch-case（简单直接）
    /// Phase 2: 迁移到独立命令类
    /// </summary>
    public static class CommandExecutor
    {
        /// <summary>
        /// 执行命令（主入口）
        /// </summary>
        /// <param name="json">完整的 JSON 请求</param>
        /// <returns>JSON 响应</returns>
        public static string Execute(string json)
        {
            try
            {
                // 规范化 JSON（处理 curl 的无引号格式）
                json = NormalizeJson(json);
                
                // 先解析 command 字段确定命令类型
                var baseParams = JsonUtility.FromJson<CommandParams>(json);
                
                if (string.IsNullOrEmpty(baseParams.command))
                {
                    return CommandResult.Error("Missing 'command' field").ToJson();
                }

                // 根据命令类型执行
                switch (baseParams.command)
                {
                    case "CreateCube":
                        return new CreateCubeCommand().Execute(json);
                    
                    case "SetReference":
                        return new SetReferenceCommand().Execute(json);
                    
                    default:
                        return CommandResult.Error($"Unknown command: {baseParams.command}").ToJson();
                }
            }
            catch (Exception ex)
            {
                Debug.LogError($"[CommandExecutor] Error: {ex.Message}\n{ex.StackTrace}");
                return CommandResult.Error(ex.Message).ToJson();
            }
        }

        /// <summary>
        /// 规范化 JSON：处理 curl 在 Windows 上产生的无引号格式
        /// 例如：{command:CreateCube,x:1} → {"command":"CreateCube","x":1}
        /// </summary>
        private static string NormalizeJson(string json)
        {
            Debug.Log($"[JSON] Original: {json}");
            
            // 快速检测：如果已经是标准格式，直接返回
            if (json.Contains("\"command\":"))
            {
                Debug.Log("[JSON] Already normalized");
                return json;
            }

            // 通用正则：为所有无引号的键添加引号
            // 匹配 {key: 或 ,key: 形式，将 key 加上引号
            json = System.Text.RegularExpressions.Regex.Replace(
                json,
                @"([{,])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:",
                "$1\"$2\":"
            );
            
            // 为无引号的字符串值添加引号（只匹配纯字母的值，如命令名）
            // 匹配 :"value" 或 :value 形式（value 是纯字母）
            json = System.Text.RegularExpressions.Regex.Replace(
                json,
                @":([a-zA-Z_][a-zA-Z0-9_]*)([,}])",
                ":\"$1\"$2"
            );
            
            Debug.Log($"[JSON] Normalized: {json}");
            return json;
        }

        /// <summary>
        /// 列出所有可用命令
        /// </summary>
        public static string GetCommandList()
        {
            return "{\"commands\":[\"CreateCube\", \"SetReference\"]}";
        }
    }
}

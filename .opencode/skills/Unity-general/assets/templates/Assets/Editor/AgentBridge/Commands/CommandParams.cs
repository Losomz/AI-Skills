using System;
using UnityEngine;

namespace Editor.AgentBridge.Commands
{
    // 命令参数基类
    [Serializable]
    public class CommandParams
    {
        public string command;
    }


    // 通用返回结果
    [Serializable]
    public class CommandResult
    {
        public string status;
        public string message;
        public int id;
        public string name;

        public static CommandResult Success(int id = 0, string name = "")
        {
            return new CommandResult { status = "success", id = id, name = name };
        }

        public static CommandResult Error(string message)
        {
            return new CommandResult { status = "error", message = message };
        }

        public string ToJson()
        {
            return JsonUtility.ToJson(this);
        }
    }
}

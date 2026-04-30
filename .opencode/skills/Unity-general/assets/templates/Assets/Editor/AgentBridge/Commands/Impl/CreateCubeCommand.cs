using System;
using UnityEngine;

namespace Editor.AgentBridge.Commands.Impl
{
    // CreateCube 参数
    [Serializable]
    public class CreateCubeParams : CommandParams
    {
        public float x;
        public float y;
        public float z;
    }

    /// <summary>
    /// CreateCube 命令 - 在指定位置创建立方体
    /// </summary>
    public class CreateCubeCommand
    {
        public string Execute(string json)
        {
            var param = JsonUtility.FromJson<CreateCubeParams>(json);
            
            var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube.transform.position = new Vector3(param.x, param.y, param.z);
            cube.name = "AI_Created_Cube";

            int id = cube.GetInstanceID();
            
            Debug.Log($"[CreateCube] Created at ({param.x}, {param.y}, {param.z}), ID: {id}");
            
            return CommandResult.Success(id, cube.name).ToJson();
        }
    }
}

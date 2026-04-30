using System;
using System.Reflection;
using UnityEditor;
using UnityEngine;

namespace Editor.AgentBridge.Commands.Impl
{
    // SetReference 参数
    [Serializable]
    public class SetReferenceParams : CommandParams
    {
        public int targetObjectId;      // 目标对象的 InstanceID
        public string componentType;    // 组件类型名
        public string fieldName;        // 字段名
        
        // 引用来源（二选一）
        public string assetPath;        // 资产路径（当前实现）
        public int sceneObjectId;       // 场景对象 ID（预留，未实现）
    }

    /// <summary>
    /// SetReference 命令 - 给组件字段赋值引用
    /// </summary>
    public class SetReferenceCommand
    {
        public string Execute(string json)
        {
            try
            {
                var param = JsonUtility.FromJson<SetReferenceParams>(json);
                
                // 1. 找到目标对象
                var targetObj = EditorUtility.InstanceIDToObject(param.targetObjectId) as GameObject;
                if (targetObj == null)
                {
                    return CommandResult.Error($"Target object with ID {param.targetObjectId} not found").ToJson();
                }
                
                // 2. 获取组件类型
                var componentType = FindComponentType(param.componentType);
                if (componentType == null)
                {
                    return CommandResult.Error($"Component type '{param.componentType}' not found").ToJson();
                }
                
                // 3. 获取组件实例
                var component = targetObj.GetComponent(componentType);
                if (component == null)
                {
                    return CommandResult.Error($"Component '{param.componentType}' not found on object").ToJson();
                }
                
                // 4. 获取字段
                var field = componentType.GetField(param.fieldName, BindingFlags.Public | BindingFlags.Instance);
                if (field == null)
                {
                    return CommandResult.Error($"Field '{param.fieldName}' not found in component '{param.componentType}'").ToJson();
                }
                
                // 5. 获取引用对象
                UnityEngine.Object reference = null;
                
                if (!string.IsNullOrEmpty(param.assetPath))
                {
                    // 从项目资产加载
                    reference = AssetDatabase.LoadAssetAtPath(param.assetPath, field.FieldType);
                    if (reference == null)
                    {
                        return CommandResult.Error($"Asset not found at path: {param.assetPath}").ToJson();
                    }
                }
                else if (param.sceneObjectId != 0)
                {
                    // TODO: 场景对象引用（未实现）
                    return CommandResult.Error("Scene object reference not yet implemented").ToJson();
                }
                else
                {
                    return CommandResult.Error("Must specify either assetPath or sceneObjectId").ToJson();
                }
                
                // 6. 设置字段值（支持 Undo）
                Undo.RecordObject(component, "Set Reference");
                field.SetValue(component, reference);
                EditorUtility.SetDirty(component);
                
                Debug.Log($"[SetReference] Set {param.componentType}.{param.fieldName} = {reference.name}");
                
                return CommandResult.Success().ToJson();
            }
            catch (Exception ex)
            {
                Debug.LogError($"[SetReference] Error: {ex.Message}\n{ex.StackTrace}");
                return CommandResult.Error(ex.Message).ToJson();
            }
        }
        
        /// <summary>
        /// 查找组件类型（支持简写和全名）
        /// </summary>
        private Type FindComponentType(string typeName)
        {
            // 先尝试直接查找
            var type = Type.GetType(typeName);
            if (type != null) return type;
            
            // 尝试添加 UnityEngine 命名空间
            type = Type.GetType($"UnityEngine.{typeName}, UnityEngine");
            if (type != null) return type;
            
            // 在所有程序集中查找
            foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                type = assembly.GetType(typeName);
                if (type != null) return type;
            }
            
            return null;
        }
    }
}

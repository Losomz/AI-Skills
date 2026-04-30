using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using UnityEditor;
using UnityEngine;

namespace Editor.AgentBridge
{
    [InitializeOnLoad]
    public class AgentBridgeServer
    {
        private static HttpListener listener;
        private static Thread listenerThread;
        private static bool isRunning = false;
        private const int PORT = 8081;
        
        // 主线程任务队列
        private static Queue<Action> mainThreadQueue = new Queue<Action>();
        private static object queueLock = new object();

        static AgentBridgeServer()
        {
            // Unity 启动时自动初始化
            EditorApplication.update += Initialize;
        }

        private static void Initialize()
        {
            EditorApplication.update -= Initialize;
            EditorApplication.update += ProcessMainThreadQueue;  // 注册主线程处理器
            StartServer();
        }
        
        // 主线程队列处理器（每帧调用）
        private static void ProcessMainThreadQueue()
        {
            lock (queueLock)
            {
                while (mainThreadQueue.Count > 0)
                {
                    var action = mainThreadQueue.Dequeue();
                    try
                    {
                        action?.Invoke();
                    }
                    catch (Exception e)
                    {
                        Debug.LogError($"[AI Bridge] Main thread error: {e.Message}");
                    }
                }
            }
        }

        [MenuItem("AI/Start Server")]
        public static void StartServer()
        {
            if (isRunning)
            {
                Debug.LogWarning("[AI Bridge] Server already running");
                return;
            }

            try
            {
                listener = new HttpListener();
                listener.Prefixes.Add($"http://127.0.0.1:{PORT}/");
                listener.Start();
                isRunning = true;

                listenerThread = new Thread(ListenLoop);
                listenerThread.IsBackground = true;
                listenerThread.Start();

                Debug.Log($"[AI Bridge] Server started on http://127.0.0.1:{PORT}");
            }
            catch (Exception e)
            {
                Debug.LogError($"[AI Bridge] Failed: {e.Message}");
            }
        }

        [MenuItem("AI/Stop Server")]
        public static void StopServer()
        {
            if (!isRunning) return;

            isRunning = false;
            listener?.Stop();
            listener?.Close();

            Debug.Log("[AI Bridge] Server stopped");
        }

        private static void ListenLoop()
        {
            while (isRunning)
            {
                try
                {
                    var context = listener.GetContext();
                    ThreadPool.QueueUserWorkItem(_ => HandleRequest(context));
                }
                catch (ThreadAbortException)
                {
                    // Unity 重新编译时会终止线程，这是正常行为，静默处理
                }
                catch (Exception e)
                {
                    if (isRunning) Debug.LogError($"[AgentBridge] Error: {e.Message}");
                }
            }
        }

        private static void HandleRequest(HttpListenerContext context)
        {
            var request = context.Request;
            var response = context.Response;

            try
            {
                string responseText = "";

                if (request.HttpMethod == "GET")
                {
                    // 健康检查
                    responseText = "{\"status\":\"ok\",\"service\":\"Unity AI Bridge\"}";
                }
                else if (request.HttpMethod == "POST")
                {
                    // 读取请求体
                    using (var reader = new StreamReader(request.InputStream, request.ContentEncoding))
                    {
                        string requestBody = reader.ReadToEnd();
                        Debug.Log($"[AI Bridge] Received: {requestBody}");
                        
                        // 解析并执行命令
                        responseText = ExecuteCommand(requestBody);
                    }
                }

                // 返回响应
                byte[] buffer = Encoding.UTF8.GetBytes(responseText);
                response.ContentLength64 = buffer.Length;
                response.ContentType = "application/json";
                response.OutputStream.Write(buffer, 0, buffer.Length);
            }
            catch (Exception e)
            {
                response.StatusCode = 500;
                byte[] buffer = Encoding.UTF8.GetBytes($"{{\"error\":\"{e.Message}\"}}");
                response.OutputStream.Write(buffer, 0, buffer.Length);
            }
            finally
            {
                response.OutputStream.Close();
            }
        }

        private static string ExecuteCommand(string json)
        {
            try
            {
                Debug.Log($"[AI Bridge] Received: {json}");
                
                // 在主线程执行命令
                string result = null;
                Exception error = null;
                var resetEvent = new ManualResetEventSlim(false);
                
                lock (queueLock)
                {
                    mainThreadQueue.Enqueue(() =>
                    {
                        try
                        {
                            // 委托给 CommandExecutor
                            result = Commands.CommandExecutor.Execute(json);
                        }
                        catch (Exception ex)
                        {
                            error = ex;
                        }
                        finally
                        {
                            resetEvent.Set();
                        }
                    });
                }
                
                // 等待主线程执行完成（最多5秒）
                if (resetEvent.Wait(5000))
                {
                    if (error != null)
                    {
                        Debug.LogError($"[AI Bridge] Command error: {error.Message}");
                        return $"{{\"status\":\"error\",\"message\":\"{error.Message}\"}}";
                    }
                    return result;
                }
                else
                {
                    return "{\"status\":\"error\",\"message\":\"Execution timeout\"}";
                }
            }
            catch (Exception e)
            {
                Debug.LogError($"[AI Bridge] Unexpected error: {e.Message}");
                return $"{{\"status\":\"error\",\"message\":\"{e.Message}\"}}";
            }
        }

        // 已移除：ParseField, ParseFloat
        // 现在使用 JsonUtility 在 CommandExecutor 中解析
    }
}

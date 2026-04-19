/**
 * 服务器日志查看页面
 * 显示向 IAMS 上报的心跳数据
 */
'use client';

import { useEffect, useState, useCallback } from 'react';

export default function LogsPage() {
  // 心跳数据
  const [heartbeat, setHeartbeat] = useState<object | null>(null);
  const [heartbeatTime, setHeartbeatTime] = useState<string>('');

  // 加载心跳数据
  const fetchHeartbeat = useCallback(async () => {
    try {
      const res = await fetch('/api/logs/heartbeat');
      const data = await res.json();
      if (data.success) {
        setHeartbeat(data.data);
        setHeartbeatTime(new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }));
      } else {
        setHeartbeat(null);
      }
    } catch {
      setHeartbeat(null);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    fetchHeartbeat();
  }, [fetchHeartbeat]);

  // 心跳数据自动刷新（每10秒）
  useEffect(() => {
    const timer = setInterval(fetchHeartbeat, 10000);
    return () => clearInterval(timer);
  }, [fetchHeartbeat]);

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-full mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <a
                href="/"
                className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 hover:border-gray-400 rounded-lg transition-all duration-200 group shadow-sm"
              >
                <svg className="w-5 h-5 text-gray-500 group-hover:text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span className="text-gray-600 group-hover:text-gray-800 font-medium">返回</span>
              </a>
              <h1 className="text-2xl font-bold text-gray-900">服务器日志</h1>
            </div>
            <nav className="flex space-x-4">
              <a href="/dashboard/devices" className="text-gray-600 hover:text-gray-900">设备管理</a>
              <a href="/dashboard/credentials" className="text-gray-600 hover:text-gray-900">凭证管理</a>
              <a href="/dashboard/mqtt-events" className="text-gray-600 hover:text-gray-900">MQTT指令</a>
              <a href="/dashboard/pass-logs" className="text-gray-600 hover:text-gray-900">通行记录</a>
              <a href="/dashboard/settings" className="text-gray-600 hover:text-gray-900">系统设置</a>
              <a href="/dashboard/logs" className="text-blue-600 font-medium">服务器日志</a>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-full mx-auto px-4 py-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">向 IAMS 上报的心跳数据</h2>
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-500">
                更新时间：{heartbeatTime || '暂无'}
              </span>
              <button
                onClick={fetchHeartbeat}
                className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded"
              >
                刷新
              </button>
            </div>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            每10秒向 IAMS 发送一次，显示最近一次上报的完整内容。用于排查设备ID是否冲突。
          </p>
          <div className="bg-gray-900 rounded-lg p-4 overflow-auto max-h-[calc(100vh-280px)]">
            <pre className="text-green-400 text-sm font-mono whitespace-pre-wrap">
              {heartbeat ? JSON.stringify(heartbeat, null, 2) : '暂无心跳数据（MQTT 未连接或尚未上报）'}
            </pre>
          </div>
        </div>
      </main>
    </div>
  );
}

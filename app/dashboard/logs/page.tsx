/**
 * 服务器日志查看页面
 * 支持实时自动刷新，可查看服务端 Next.js 日志
 */
'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

export default function LogsPage() {
  const [activeTab, setActiveTab] = useState<'logs' | 'heartbeat'>('heartbeat');
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logPath, setLogPath] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [followMode, setFollowMode] = useState(true); // SSE 实时模式
  const [followError, setFollowError] = useState<string | null>(null);
  const [totalLines, setTotalLines] = useState(0);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

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

  // 普通轮询模式加载
  const fetchLogs = useCallback(async () => {
    if (followMode) return; // SSE 模式下不用轮询
    try {
      const res = await fetch('/api/logs?lines=500');
      const data = await res.json();

      if (data.success) {
        setLines(data.lines);
        setLogPath(data.path);
        setTotalLines(data.totalLines);
        setError(null);
      } else {
        setError(data.error || '未知错误');
        setLogPath(data.path);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [followMode]);

  // 初始加载
  useEffect(() => {
    if (!followMode) {
      fetchLogs();
    }
    fetchHeartbeat();
  }, [fetchLogs, followMode, fetchHeartbeat]);

  // 轮询模式定时器
  useEffect(() => {
    if (followMode || !autoRefresh) return;
    const timer = setInterval(() => {
      fetchLogs();
      fetchHeartbeat();
    }, 3000);
    return () => clearInterval(timer);
  }, [fetchLogs, autoRefresh, followMode, fetchHeartbeat]);

  // SSE 实时模式
  useEffect(() => {
    if (!followMode) return;

    setLoading(true);
    setFollowError(null);

    const controller = new AbortController();
    let eventSource: EventSource | null = null;
    let receivedAny = false;

    // 使用 EventSource 或 fetch
    try {
      eventSource = new EventSource('/api/logs?follow=true&lines=500');

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLines(prev => {
            const newLines = [...prev, data.line];
            // 最多保留 2000 行
            return newLines.slice(-2000);
          });
          receivedAny = true;
          setLoading(false);
          setError(null);
        } catch {
          // 忽略解析错误
        }
      };

      eventSource.onerror = () => {
        if (!receivedAny) {
          setFollowError('无法连接到日志流');
          setLoading(false);
        }
        // 连接断开时 EventSource 会自动重连
      };
    } catch (e: any) {
      setFollowError(e.message);
      setLoading(false);
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
      controller.abort();
    };
  }, [followMode]);

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  // 心跳数据自动刷新（每10秒，独立于日志模式）
  useEffect(() => {
    const timer = setInterval(fetchHeartbeat, 10000);
    return () => clearInterval(timer);
  }, [fetchHeartbeat]);

  // 手动刷新
  const handleManualRefresh = () => {
    if (followMode) {
      // 在 SSE 模式下，切换到轮询模式再切回来以重置连接
      setLines([]);
      setFollowMode(false);
      setTimeout(() => setFollowMode(true), 100);
    } else {
      fetchLogs();
    }
  };

  // 清空日志
  const handleClear = async () => {
    if (!confirm('确定要清空日志文件吗？')) return;
    try {
      const res = await fetch('/api/logs?clear=true', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setLines([]);
      }
    } catch (e: any) {
      console.error('清空日志失败:', e);
    }
  };

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
        {/* Tab 切换 */}
        <div className="flex space-x-4 mb-4">
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${activeTab === 'logs' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
          >
            服务器日志
          </button>
          <button
            onClick={() => setActiveTab('heartbeat')}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${activeTab === 'heartbeat' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
          >
            心跳数据
          </button>
        </div>

        {activeTab === 'logs' && (
          <>
            {/* 工具栏 */}
            <div className="bg-white shadow rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center space-x-4">
                  {/* 模式切换 */}
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600">模式：</span>
                    <button
                      onClick={() => setFollowMode(true)}
                      className={`px-3 py-1 text-sm rounded ${followMode ? 'bg-green-600 text-white' : 'bg-gray-200'}`}
                    >
                      实时
                    </button>
                    <button
                      onClick={() => setFollowMode(false)}
                      className={`px-3 py-1 text-sm rounded ${!followMode ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
                    >
                      轮询
                    </button>
                  </div>

                  {/* 自动刷新（仅轮询模式） */}
                  {!followMode && (
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={autoRefresh}
                        onChange={(e) => setAutoRefresh(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm text-gray-600">自动刷新（3秒）</span>
                    </label>
                  )}

                  {/* 自动滚动 */}
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={autoScroll}
                      onChange={(e) => setAutoScroll(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-600">自动滚动到底部</span>
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <span className="text-xs text-gray-500">
                    {logPath && `日志：${logPath}`}
                  </span>
                  <span className="text-xs text-gray-500">
                    {lines.length} 行 / 共 {totalLines} 行
                  </span>
                  <button
                    onClick={handleManualRefresh}
                    className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded"
                  >
                    刷新
                  </button>
                  <button
                    onClick={handleClear}
                    className="px-3 py-1 text-sm bg-red-100 text-red-600 hover:bg-red-200 rounded"
                  >
                    清空
                  </button>
                </div>
              </div>

              {followError && (
                <div className="mt-2 text-sm text-red-600 bg-red-50 p-2 rounded">
                  {followError}
                </div>
              )}
            </div>

        {/* 日志内容 */}
        <div
          ref={logContainerRef}
          className="bg-black rounded-lg shadow overflow-auto"
          style={{ height: 'calc(100vh - 280px)', minHeight: '400px' }}
        >
          {loading && lines.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-400 text-lg">加载日志中...</div>
            </div>
          ) : error && lines.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-red-400 text-lg mb-2">无法加载日志</div>
              <div className="text-gray-500 text-sm">{error}</div>
              <div className="text-gray-600 text-xs mt-2">日志路径：{logPath}</div>
            </div>
          ) : (
            <div className="p-4 font-mono text-sm leading-relaxed">
              {lines.map((line, index) => {
                // 根据日志内容着色
                let colorClass = 'text-gray-300';
                if (line.includes('ERROR') || line.includes('error') || line.includes('失败') || line.includes('❌')) {
                  colorClass = 'text-red-400';
                } else if (line.includes('WARN') || line.includes('warn') || line.includes('⚠️')) {
                  colorClass = 'text-yellow-400';
                } else if (line.includes('✅') || line.includes('成功')) {
                  colorClass = 'text-green-400';
                } else if (line.includes('[MQTT]')) {
                  colorClass = 'text-cyan-300';
                } else if (line.includes('[PalmDevice]') || line.includes('[DeviceSync]')) {
                  colorClass = 'text-purple-300';
                } else if (line.includes('[Auth]')) {
                  colorClass = 'text-orange-300';
                } else if (line.includes('[Next.js]')) {
                  colorClass = 'text-gray-400';
                }

                return (
                  <div key={index} className={`${colorClass} hover:bg-gray-800 px-1 whitespace-pre`}>
                    {line}
                  </div>
                );
              })}
            </div>
          )}
        </div>
          </>
        )}

        {activeTab === 'heartbeat' && (
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
        )}
      </main>
    </div>
  );
}

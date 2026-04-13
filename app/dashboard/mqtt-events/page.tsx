/**
 * MQTT指令记录页面
 * 显示IAMS发送的MQTT消息记录
 */
'use client';

import { useEffect, useState, useCallback } from 'react';
import Toast, { ToastMessage } from '@/components/Toast';

// 指令记录接口
interface MqttEvent {
  id: string;
  time: string;
  op: string;
  deviceId: string;
  personId: string;
  credentialId: number;
  credentialType: number;  // 凭证类型：5=密码, 7=虹膜, 8=掌纹, 9=胁迫码
  authModel: number;
  authTypeList: string;
  boxList: string;
  showInfo: string;
  tags: string;
  enable: number;
  action: string; // 添加/删除/更新
}

// 凭证类型映射
const credentialTypeMap: Record<number, { label: string; color: string }> = {
  1: { label: '人脸', color: 'bg-blue-100 text-blue-800' },
  5: { label: '密码', color: 'bg-yellow-100 text-yellow-800' },
  7: { label: '虹膜', color: 'bg-purple-100 text-purple-800' },
  8: { label: '掌纹', color: 'bg-green-100 text-green-800' },
  9: { label: '胁迫码', color: 'bg-red-100 text-red-800' },
};

// 从 authTypeList 解析凭证类型（用于旧数据）
function parseCredentialTypeFromAuthType(authTypeList: string): number {
  if (!authTypeList) return 0;
  const types = authTypeList.split(',').map(Number).filter(t => [7, 8, 5, 9].includes(t));
  // 优先返回虹膜或掌纹
  if (types.includes(7)) return 7;
  if (types.includes(8)) return 8;
  if (types.includes(5)) return 5;
  if (types.includes(9)) return 9;
  return types[0] || 0;
}

// 分页响应接口
interface PaginatedResponse {
  success: boolean;
  events: MqttEvent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export default function MqttEventsPage() {
  const [events, setEvents] = useState<MqttEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [dateFilter, setDateFilter] = useState('');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pageSize = 15;

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // 获取指令记录
  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
      });
      if (dateFilter) {
        params.append('date', dateFilter);
      }

      const response = await fetch(`/api/mqtt-events?${params.toString()}`);
      const data: PaginatedResponse = await response.json();

      if (data.success) {
        setEvents(data.events || []);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      }
    } catch (error) {
      console.error('获取MQTT指令记录失败:', error);
    } finally {
      setLoading(false);
    }
  }, [page, dateFilter]);

  // 清空记录
  const handleClearEvents = useCallback(async () => {
    try {
      const response = await fetch('/api/mqtt-events', {
        method: 'DELETE',
      });
      const data = await response.json();

      if (data.success) {
        addToast({
          type: 'success',
          title: '已清空记录',
        });
        setEvents([]);
        setTotal(0);
        setTotalPages(1);
        setPage(1);
      } else {
        addToast({
          type: 'error',
          title: '清空失败',
          message: data.error,
        });
      }
    } catch (error) {
      addToast({
        type: 'error',
        title: '清空异常',
        message: (error as Error).message,
      });
    }
  }, [addToast]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // 日期变化处理
  const handleDateChange = (value: string) => {
    setDateFilter(value);
    setPage(1); // 重置页码
  };

  // 清除日期过滤
  const clearDateFilter = () => {
    setDateFilter('');
    setPage(1);
  };

  // 操作类型映射
  const opMap: Record<string, string> = {
    'passport-add': '添加',
    'passport-update': '更新',
    'passport-del': '删除',
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <Toast toasts={toasts} removeToast={removeToast} />

      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
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
              <h1 className="text-2xl font-bold text-gray-900">MQTT指令记录</h1>
            </div>
            <nav className="flex space-x-4">
              <a href="/dashboard/devices" className="text-gray-600 hover:text-gray-900">设备管理</a>
              <a href="/dashboard/credentials" className="text-gray-600 hover:text-gray-900">凭证管理</a>
              <a href="/dashboard/mqtt-events" className="text-blue-600 font-medium">MQTT指令</a>
              <a href="/dashboard/pass-logs" className="text-gray-600 hover:text-gray-900">通行记录</a>
              <a href="/dashboard/settings" className="text-gray-600 hover:text-gray-900">系统设置</a>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {/* Toolbar */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <span className="text-gray-600">共 {total} 条记录</span>
            <div className="flex items-center space-x-2">
              <label className="text-gray-600 text-sm">日期筛选：</label>
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => handleDateChange(e.target.value)}
                className="px-3 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {dateFilter && (
                <button
                  onClick={clearDateFilter}
                  className="text-sm text-red-600 hover:text-red-800"
                >
                  清除
                </button>
              )}
            </div>
          </div>
          <button
            onClick={handleClearEvents}
            className="px-3 py-1 text-sm text-red-600 border border-red-300 rounded hover:bg-red-50"
          >
            清空记录
          </button>
        </div>

        {/* Events Table */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">加载中...</div>
          ) : events.length === 0 ? (
            <div className="p-8 text-center text-gray-500">暂无MQTT指令记录</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">时间</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">凭证类型</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">用户编码</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">凭证ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">认证模式</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">认证类型</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">箱号</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">显示信息</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {events.map((event) => {
                    // 如果没有 credentialType，尝试从 authTypeList 解析
                    const credType = event.credentialType || parseCredentialTypeFromAuthType(event.authTypeList);
                    const credTypeInfo = credentialTypeMap[credType] || { label: '-', color: 'bg-gray-100 text-gray-600' };
                    return (
                    <tr key={event.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                        {event.time}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 text-xs rounded ${
                          event.op === 'passport-add' ? 'bg-green-100 text-green-800' :
                          event.op === 'passport-del' ? 'bg-red-100 text-red-800' :
                          event.op === 'passport-update' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {opMap[event.op] || event.op}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 text-xs rounded ${credTypeInfo.color}`}>
                          {credTypeInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                        {event.personId || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 font-mono font-bold">
                        {event.credentialId || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {event.authModel === 1 ? '单凭证' : event.authModel === 2 ? '组合' : event.authModel}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {event.authTypeList || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {event.boxList || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 truncate max-w-xs" title={event.showInfo}>
                        {event.showInfo || '-'}
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-600">
                第 {page} 页，共 {totalPages} 页
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  上一页
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
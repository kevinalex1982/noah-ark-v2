/**
 * 通行记录页面
 * 显示认证成功的通行记录
 */
'use client';

import { useEffect, useState, useCallback } from 'react';
import Toast, { ToastMessage } from '@/components/Toast';

// 认证类型映射
const AUTH_TYPE_NAMES: Record<string, string> = {
  '5': '密码',
  '7': '虹膜',
  '8': '掌纹',
  '9': '胁迫码',
};

// 通行记录接口
interface PassLog {
  id: number;
  person_id: string;
  credential_id: number;
  auth_type: string;
  auth_result: number;
  device_id: string;
  iams_response: number;
  iams_code?: number;
  iams_msg?: string;
  created_at: string;
}

// 分页响应接口
interface PaginatedResponse {
  success: boolean;
  logs: PassLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export default function PassLogsPage() {
  const [logs, setLogs] = useState<PassLog[]>([]);
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

  // 获取通行记录
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
      });
      if (dateFilter) {
        params.append('date', dateFilter);
      }

      const response = await fetch(`/api/pass-logs?${params.toString()}`);
      const data: PaginatedResponse = await response.json();

      if (data.success) {
        setLogs(data.logs || []);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      }
    } catch (error) {
      console.error('获取通行记录失败:', error);
    } finally {
      setLoading(false);
    }
  }, [page, dateFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // 认证类型转中文
  const formatAuthType = (authType: string): string => {
    const types = authType.split(',');
    const names = types.map(t => AUTH_TYPE_NAMES[t.trim()] || t);
    return names.join('、');
  };

  // IAMS响应状态
  const getIamsStatus = (response: number): { text: string; color: string } => {
    switch (response) {
      case 1:
        return { text: '成功', color: 'text-green-600' };
      case 2:
        return { text: '失败', color: 'text-red-600' };
      default:
        return { text: '未响应', color: 'text-gray-400' };
    }
  };

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
              <h1 className="text-2xl font-bold text-gray-900">通行记录</h1>
            </div>
            <nav className="flex space-x-4">
              <a href="/dashboard/devices" className="text-gray-600 hover:text-gray-900">设备管理</a>
              <a href="/dashboard/credentials" className="text-gray-600 hover:text-gray-900">凭证管理</a>
              <a href="/dashboard/mqtt-events" className="text-gray-600 hover:text-gray-900">MQTT指令</a>
              <a href="/dashboard/pass-logs" className="text-blue-600 font-medium">通行记录</a>
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
        </div>

        {/* Logs Table */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">加载中...</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-gray-500">暂无通行记录</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">用户编码</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">凭证ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">认证类型</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">设备ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">IAMS响应</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">时间</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {logs.map((log) => {
                    const iamsStatus = getIamsStatus(log.iams_response);
                    return (
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                          {log.id}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                          {log.person_id}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                          {log.credential_id}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-medium">
                            {formatAuthType(log.auth_type)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                          {log.device_id}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`font-medium ${iamsStatus.color}`}>
                            {iamsStatus.text}
                          </span>
                          {log.iams_code && log.iams_code !== 200 && (
                            <span className="text-gray-400 text-xs ml-1">({log.iams_code})</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString('zh-CN')}
                        </td>
                      </tr>
                    );
                  })}
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
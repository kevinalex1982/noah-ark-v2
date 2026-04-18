/**
 * 凭证管理页面
 */
'use client';

import { useEffect, useState, useCallback } from 'react';
import Toast, { ToastMessage } from '@/components/Toast';

// 凭证类型映射
const CREDENTIAL_TYPES: Record<number, string> = {
  1: '人脸',
  5: '密码',
  7: '虹膜',
  8: '掌纹',
  9: '胁迫码',
};

// 凭证接口
interface Credential {
  id: number;
  person_id: string;
  person_name: string;
  person_type: string;
  credential_id: number;
  type: number;
  content: string | null;
  iris_left_image: string | null;
  iris_right_image: string | null;
  palm_feature: string | null;
  show_info: string | null;
  tags: string | null;
  auth_model: number;
  auth_type_list: string | null;
  box_list: string | null;
  enable: number;
  created_at: string;
  updated_at: string;
}

// 详情模态框的 props
interface DetailModalProps {
  isOpen: boolean;
  credential: Credential | null;
  onClose: () => void;
}

// 详情模态框组件
function DetailModal({ isOpen, credential, onClose }: DetailModalProps) {
  if (!isOpen || !credential) return null;

  const typeName = CREDENTIAL_TYPES[credential.type] || '未知';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">凭证详情</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          {/* 基本信息 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-500 mb-1">凭证ID</label>
              <div className="text-sm font-mono bg-gray-50 p-2 rounded">{credential.credential_id}</div>
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">类型</label>
              <div className="text-sm bg-gray-50 p-2 rounded">
                <span className={`px-2 py-1 text-xs rounded ${
                  credential.type === 7 ? 'bg-purple-100 text-purple-800' :
                  credential.type === 8 ? 'bg-green-100 text-green-800' :
                  credential.type === 5 ? 'bg-blue-100 text-blue-800' :
                  credential.type === 9 ? 'bg-red-100 text-red-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {typeName}
                </span>
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">姓名</label>
              <div className="text-sm bg-gray-50 p-2 rounded">{credential.person_name}</div>
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">用户编码</label>
              <div className="text-sm font-mono bg-gray-50 p-2 rounded">{credential.person_id}</div>
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">人员类型</label>
              <div className="text-sm bg-gray-50 p-2 rounded">
                {credential.person_type === 'n' ? '普通人员' : credential.person_type === 'v' ? '访客' : credential.person_type}
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">状态</label>
              <div className="text-sm bg-gray-50 p-2 rounded">
                <span className={credential.enable === 1 ? 'text-green-600' : 'text-red-600'}>
                  {credential.enable === 1 ? '启用' : '禁用'}
                </span>
              </div>
            </div>
          </div>

          {/* 认证配置 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-500 mb-1">识别模式</label>
              <div className="text-sm bg-gray-50 p-2 rounded">
                {credential.auth_model === 1 ? '单凭证识别' : credential.auth_model === 2 ? '多凭证组合识别' : credential.auth_model}
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">识别类型列表</label>
              <div className="text-sm bg-gray-50 p-2 rounded">{credential.auth_type_list || '-'}</div>
            </div>
          </div>

          {/* 显示信息和标签 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-500 mb-1">显示信息</label>
              <div className="text-sm bg-gray-50 p-2 rounded">{credential.show_info || '-'}</div>
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">标签</label>
              <div className="text-sm bg-gray-50 p-2 rounded">{credential.tags || '-'}</div>
            </div>
          </div>

          {/* 箱号列表 */}
          <div>
            <label className="block text-sm text-gray-500 mb-1">箱号列表</label>
            <div className="text-sm bg-gray-50 p-2 rounded">{credential.box_list || '-'}</div>
          </div>

          {/* 凭证内容 - 根据类型显示不同内容 */}
          {credential.type === 5 && (
            <div>
              <label className="block text-sm text-gray-500 mb-1">密码</label>
              <div className="text-sm bg-gray-50 p-2 rounded font-mono">{credential.content || '-'}</div>
            </div>
          )}

          {credential.type === 9 && (
            <div>
              <label className="block text-sm text-gray-500 mb-1">胁迫码</label>
              <div className="text-sm bg-gray-50 p-2 rounded font-mono">{credential.content || '-'}</div>
            </div>
          )}

          {/* 虹膜 - 不显示图片字符串，只显示是否有数据 */}
          {credential.type === 7 && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-500 mb-1">左眼虹膜</label>
                <div className="text-sm bg-gray-50 p-2 rounded">
                  <span className={credential.iris_left_image ? 'text-green-600' : 'text-gray-400'}>
                    {credential.iris_left_image ? '已录入' : '未录入'}
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">右眼虹膜</label>
                <div className="text-sm bg-gray-50 p-2 rounded">
                  <span className={credential.iris_right_image ? 'text-green-600' : 'text-gray-400'}>
                    {credential.iris_right_image ? '已录入' : '未录入'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 掌纹 - 不显示特征，只显示是否有数据 */}
          {credential.type === 8 && (
            <div>
              <label className="block text-sm text-gray-500 mb-1">掌纹特征</label>
              <div className="text-sm bg-gray-50 p-2 rounded">
                <span className={credential.palm_feature ? 'text-green-600' : 'text-gray-400'}>
                  {credential.palm_feature ? '已录入' : '未录入'}
                </span>
              </div>
            </div>
          )}

          {/* 时间信息 */}
          <div className="grid grid-cols-2 gap-4 pt-4 border-t">
            <div>
              <label className="block text-sm text-gray-500 mb-1">创建时间</label>
              <div className="text-sm bg-gray-50 p-2 rounded">{new Date(credential.created_at).toLocaleString('zh-CN')}</div>
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">更新时间</label>
              <div className="text-sm bg-gray-50 p-2 rounded">{new Date(credential.updated_at).toLocaleString('zh-CN')}</div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

// 删除模态框的 props
interface DeleteModalProps {
  isOpen: boolean;
  credential: Credential | null;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}

// 删除模态框组件
function DeleteModal({ isOpen, credential, onClose, onConfirm, loading }: DeleteModalProps) {
  if (!isOpen || !credential) return null;

  const typeName = credential.type === 7 ? '虹膜' : credential.type === 8 ? '掌纹' : '其他';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
        <h3 className="text-lg font-semibold mb-4 text-red-600">确认删除</h3>
        <div className="mb-4">
          <p className="text-gray-700">
            确定要删除该 <span className="font-semibold">{typeName}</span> 凭证吗？
          </p>
          <div className="mt-3 p-3 bg-gray-50 rounded text-sm">
            <p><span className="text-gray-500">凭证ID：</span>{credential.credential_id}</p>
            <p><span className="text-gray-500">人员ID：</span>{credential.person_id}</p>
            <p><span className="text-gray-500">姓名：</span>{credential.person_name}</p>
          </div>
          <p className="mt-3 text-sm text-gray-500">
            这将模拟MQTT删除指令发送到设备。
          </p>
        </div>
        <div className="flex justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:text-gray-800"
            disabled={loading}
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-gray-400"
            disabled={loading}
          >
            {loading ? '删除中...' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  );
}

// 解密模态框的 props
interface DecryptModalProps {
  isOpen: boolean;
  ciphertext: string | null;
  plaintext: string | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

// 解密模态框组件
function DecryptModal({ isOpen, ciphertext, plaintext, loading, error, onClose }: DecryptModalProps) {
  if (!isOpen || !ciphertext) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">解密用户编码</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-500 mb-1">密文（数据库中存储的值）</label>
            <div className="text-xs font-mono bg-gray-50 p-2 rounded break-all">{ciphertext}</div>
          </div>

          {loading && (
            <div className="text-center text-gray-500 py-4">解密中...</div>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</div>
          )}

          {plaintext && !loading && (
            <div>
              <label className="block text-sm text-gray-500 mb-1">明文（解密后的身份编码）</label>
              <div className="text-lg font-mono bg-green-50 p-3 rounded text-green-800 font-semibold">{plaintext}</div>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CredentialsPage() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filterType, setFilterType] = useState<number | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [detailModal, setDetailModal] = useState<{
    isOpen: boolean;
    credential: Credential | null;
  }>({
    isOpen: false,
    credential: null,
  });
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    credential: Credential | null;
    loading: boolean;
  }>({
    isOpen: false,
    credential: null,
    loading: false,
  });
  const [decryptModal, setDecryptModal] = useState<{
    isOpen: boolean;
    ciphertext: string | null;
    plaintext: string | null;
    loading: boolean;
    error: string | null;
  }>({
    isOpen: false,
    ciphertext: null,
    plaintext: null,
    loading: false,
    error: null,
  });

  const pageSize = 15;

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // 获取凭证列表
  const fetchCredentials = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
      });
      if (filterType) {
        params.append('type', filterType.toString());
      }

      const response = await fetch(`/api/credentials?${params.toString()}`);
      const data = await response.json();

      if (data.success) {
        setCredentials(data.credentials);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      }
    } catch (error) {
      console.error('获取凭证列表失败:', error);
    } finally {
      setLoading(false);
    }
  }, [page, filterType]);

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  // 打开详情模态框
  const handleOpenDetailModal = useCallback((credential: Credential) => {
    setDetailModal({
      isOpen: true,
      credential,
    });
  }, []);

  // 打开删除确认弹窗
  const handleSimulateDelete = useCallback((cred: Credential) => {
    setDeleteModal({ isOpen: true, credential: cred, loading: false });
  }, []);

  // 双击用户编码解密
  const handleDoubleClickDecrypt = useCallback(async (personId: string) => {
    setDecryptModal({
      isOpen: true,
      ciphertext: personId,
      plaintext: null,
      loading: true,
      error: null,
    });

    try {
      const response = await fetch('/api/auth/decrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ciphertext: personId }),
      });

      const data = await response.json();

      if (data.success) {
        setDecryptModal(prev => ({
          ...prev,
          plaintext: data.plaintext,
          loading: false,
        }));
      } else {
        setDecryptModal(prev => ({
          ...prev,
          error: data.message,
          loading: false,
        }));
      }
    } catch (error: any) {
      setDecryptModal(prev => ({
        ...prev,
        error: error.message,
        loading: false,
      }));
    }
  }, []);

  // 确认删除
  const handleConfirmDelete = useCallback(async () => {
    if (!deleteModal.credential) return;

    setDeleteModal(prev => ({ ...prev, loading: true }));

    try {
      const response = await fetch('/api/credentials/simulate-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential_id: deleteModal.credential.credential_id }),
      });

      const data = await response.json();

      if (data.success) {
        addToast({
          type: 'success',
          title: '删除成功',
          message: data.message,
        });
        setDeleteModal({ isOpen: false, credential: null, loading: false });
        fetchCredentials();
      } else {
        addToast({
          type: 'error',
          title: '删除失败',
          message: data.error,
        });
        setDeleteModal(prev => ({ ...prev, loading: false }));
      }
    } catch (error: any) {
      addToast({
        type: 'error',
        title: '删除异常',
        message: error.message,
      });
      setDeleteModal(prev => ({ ...prev, loading: false }));
    }
  }, [deleteModal.credential, fetchCredentials, addToast]);

  return (
    <div className="min-h-screen bg-gray-100">
      <Toast toasts={toasts} removeToast={removeToast} />
      <DetailModal
        isOpen={detailModal.isOpen}
        credential={detailModal.credential}
        onClose={() => setDetailModal({ isOpen: false, credential: null })}
      />
      <DeleteModal
        isOpen={deleteModal.isOpen}
        credential={deleteModal.credential}
        onClose={() => setDeleteModal({ isOpen: false, credential: null, loading: false })}
        onConfirm={handleConfirmDelete}
        loading={deleteModal.loading}
      />
      <DecryptModal
        isOpen={decryptModal.isOpen}
        ciphertext={decryptModal.ciphertext}
        plaintext={decryptModal.plaintext}
        loading={decryptModal.loading}
        error={decryptModal.error}
        onClose={() => setDecryptModal({ isOpen: false, ciphertext: null, plaintext: null, loading: false, error: null })}
      />

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
              <h1 className="text-2xl font-bold text-gray-900">凭证管理</h1>
            </div>
            <nav className="flex space-x-4">
              <a href="/dashboard/devices" className="text-gray-600 hover:text-gray-900">设备管理</a>
              <a href="/dashboard/credentials" className="text-blue-600 font-medium">凭证管理</a>
              <a href="/dashboard/mqtt-events" className="text-gray-600 hover:text-gray-900">MQTT指令</a>
              <a href="/dashboard/pass-logs" className="text-gray-600 hover:text-gray-900">通行记录</a>
              <a href="/dashboard/logs" className="text-gray-600 hover:text-gray-900">服务器日志</a>
              <a href="/dashboard/settings" className="text-gray-600 hover:text-gray-900">系统设置</a>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {/* Filter */}
        <div className="mb-4 flex items-center space-x-4">
          <span className="text-gray-600">筛选类型：</span>
          <button
            onClick={() => {
              setFilterType(null);
              setPage(1);
            }}
            className={`px-3 py-1 rounded ${filterType === null ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
          >
            全部 ({total})
          </button>
          {[7, 8, 5, 9].map((type) => (
            <button
              key={type}
              onClick={() => {
                setFilterType(type);
                setPage(1);
              }}
              className={`px-3 py-1 rounded ${filterType === type ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
            >
              {CREDENTIAL_TYPES[type]}
            </button>
          ))}
        </div>

        {/* Credentials Table */}
        <div className="bg-white shadow rounded-lg overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center text-gray-500">加载中...</div>
          ) : credentials.length === 0 ? (
            <div className="p-8 text-center text-gray-500">暂无凭证数据</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    用户编码
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    凭证ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    类型
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    认证类型
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    认证列表
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    创建时间
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {credentials.map((cred) => (
                  <tr key={cred.id} className="hover:bg-gray-50">
                    <td
                      className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 cursor-pointer select-all hover:text-blue-600"
                      onDoubleClick={() => handleDoubleClickDecrypt(cred.person_id)}
                      title="双击可解密查看明文"
                    >
                      {cred.person_id}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {cred.credential_id}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs rounded ${
                        cred.type === 7 ? 'bg-purple-100 text-purple-800' :
                        cred.type === 8 ? 'bg-green-100 text-green-800' :
                        cred.type === 5 ? 'bg-blue-100 text-blue-800' :
                        cred.type === 9 ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {CREDENTIAL_TYPES[cred.type]}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {cred.auth_model === 1 ? '单凭证识别' : cred.auth_model === 2 ? '多凭证组合识别' : cred.auth_model}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {cred.auth_type_list || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(cred.created_at).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button
                        onClick={() => handleOpenDetailModal(cred)}
                        className="text-blue-600 hover:text-blue-900"
                      >
                        查看详细
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
// 设备管理页面 - 诺亚宝库
'use client';

import { useEffect, useState, useCallback } from 'react';
import Toast, { ToastMessage } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';

// 设备接口
interface Device {
  id: string;
  name: string;
  type: 'iris' | 'palm';
  ip: string;
  port: number;
  endpoint: string;
  status: 'online' | 'offline';
  lastSync: string | null;
  credential_count: number | null;
}

// 同步日志接口
interface SyncLog {
  id: number;
  queue_id: number;
  credential_id?: number;
  device_id: string;
  device_type: string;
  action: string;
  status: 'pending' | 'processing' | 'success' | 'failed' | 'retrying' | 'stopped' | 'offline';
  response?: string;
  error_message?: string;
  duration_ms: number;
  created_at: string;
}

// IAMS 状态接口
interface IamsStatus {
  status: 'online' | 'offline';
  lastSyncTime: string;
}

// 模拟下发结果接口
interface SimulateResult {
  personName: string;
  credentialType: number;
  targetDevice: string;
  status: 'queued' | 'skipped';
  message: string;
}

export default function DevicesPage() {
  // 状态管理
  const [devices, setDevices] = useState<Device[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [iamsStatus, setIamsStatus] = useState<IamsStatus>({
    status: 'offline',
    lastSyncTime: '',
  });
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [addSimulating, setAddSimulating] = useState(false);
  const [deleteIrisSimulating, setDeleteIrisSimulating] = useState(false);
  const [testAddLoading, setTestAddLoading] = useState(false);
  const [testDeleteLoading, setTestDeleteLoading] = useState(false);
  const [irisUploadLoading, setIrisUploadLoading] = useState(false);
  const [irisUploadResult, setIrisUploadResult] = useState<{ success: boolean; message: string; data?: any; logs?: string[] } | null>(null);
  const [selectedCredentialId, setSelectedCredentialId] = useState<number | null>(null);
  const [irisCredentials, setIrisCredentials] = useState<{credential_id: number; person_id: string; person_name: string}[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    variant: 'danger' | 'warning' | 'info';
    onConfirm: () => void;
  } | null>(null);

  // 添加 toast 通知
  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  // 移除 toast 通知
  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // 获取设备列表
  const fetchDevices = useCallback(async (type?: 'palm' | 'iris') => {
    try {
      const url = type ? `/api/devices?type=${type}` : '/api/devices';
      const response = await fetch(url);
      const data = await response.json();

      if (data.success) {
        if (type) {
          // 合并单个设备到状态中
          setDevices(prev => {
            const updated = [...prev];
            for (const dev of data.devices) {
              const idx = updated.findIndex(d => d.id === dev.id);
              if (idx >= 0) {
                updated[idx] = dev;
              } else {
                updated.push(dev);
              }
            }
            return updated;
          });
        } else {
          setDevices(data.devices);
        }
      }
    } catch (error) {
      console.error('获取设备列表失败:', error);
    }
  }, []);

  // 获取同步日志
  const fetchSyncLogs = useCallback(async () => {
    try {
      const response = await fetch('/api/devices/sync?action=logs&limit=10');
      const data = await response.json();

      if (data.success) {
        // 过滤掉更新记录（passport-update 只更新数据库，不算下发记录）
        const filteredLogs = data.logs.filter((log: SyncLog) =>
          !log.action.includes('update')
        );
        setSyncLogs(filteredLogs);
      }
    } catch (error) {
      console.error('获取同步日志失败:', error);
    }
  }, []);

  // 获取 IAMS 状态
  const fetchIamsStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/iams/status');
      const data = await response.json();
      
      // 明确检查 connected 字段，并提供默认值
      if (data.success === true) {
        const isConnected = data.connected === true;
        setIamsStatus({
          status: isConnected ? 'online' : 'offline',
          lastSyncTime: new Date().toLocaleString('zh-CN'),
        });
      } else {
        // 即使失败也更新状态为离线
        setIamsStatus({
          status: 'offline',
          lastSyncTime: new Date().toLocaleString('zh-CN'),
        });
      }
    } catch (error) {
      // 异常时也更新状态为离线
      setIamsStatus({
        status: 'offline',
        lastSyncTime: new Date().toLocaleString('zh-CN'),
      });
    }
  }, []);

  // 获取虹膜凭证列表（用于测试）
  const fetchIrisCredentials = useCallback(async () => {
    try {
      const response = await fetch('/api/credentials?type=7');
      const data = await response.json();

      if (data.success && data.credentials.length > 0) {
        setIrisCredentials(data.credentials.map((c: any) => ({
          credential_id: c.credential_id,
          person_id: c.person_id,
          person_name: c.person_name,
        })));
        // 默认选中第一个
        if (!selectedCredentialId) {
          setSelectedCredentialId(data.credentials[0].credential_id);
        }
      } else {
        setIrisCredentials([]);
      }
    } catch (error) {
      console.error('获取虹膜凭证失败:', error);
    }
  }, [selectedCredentialId]);

  // 初始加载
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchDevices(), fetchSyncLogs(), fetchIamsStatus(), fetchIrisCredentials()]);
      setLoading(false);
    };

    loadData();

    // 掌纹设备：每 15 秒查一次（记录日志向厂家反映）
    const palmTimer = setInterval(() => {
      fetchDevices('palm');
    }, 15000);

    // 虹膜设备：每 30 秒查一次
    const irisTimer = setInterval(() => {
      fetchDevices('iris');
    }, 30000);

    // IAMS 状态：每 10 秒查一次（读数据库缓存）
    const iamsTimer = setInterval(() => {
      fetchIamsStatus();
    }, 10000);

    // 下发记录：每 10 秒查一次（读数据库）
    const logsTimer = setInterval(() => {
      fetchSyncLogs();
    }, 10000);

    // 注意：同步队列由后端 sync-scheduler 处理，间隔 5 分钟
    // 前端不再主动触发重试，避免频繁锁定设备

    return () => {
      clearInterval(palmTimer);
      clearInterval(irisTimer);
      clearInterval(iamsTimer);
      clearInterval(logsTimer);
    };
  }, [fetchDevices, fetchIamsStatus, fetchSyncLogs]);

  // 模拟 IAMS 下发凭证
  const handleSimulateIams = useCallback(async () => {
    setSimulating(true);
    try {
      const response = await fetch('/api/devices/simulate-iams', {
        method: 'POST',
      });
      const data = await response.json();
      
      if (data.success) {
        addToast({
          type: 'success',
          title: '模拟 IAMS 下发完成',
          message: `总计：${data.summary.total} 个凭证\n虹膜：${data.summary.iris}，掌纹：${data.summary.palm}\n密码：${data.summary.password}，胁迫码：${data.summary.duress}`,
        });
        await fetchSyncLogs();
        // 刷新设备列表以更新凭证数量
        await fetchDevices();
      } else {
        addToast({
          type: 'error',
          title: '模拟下发失败',
          message: data.error,
        });
      }
    } catch (error) {
      console.error('模拟 IAMS 下发失败:', error);
      addToast({
        type: 'error',
        title: '模拟下发异常',
        message: (error as Error).message,
      });
    } finally {
      setSimulating(false);
    }
  }, [fetchSyncLogs, fetchDevices]);

  // 清空设备凭证（测试用）
  const handleClearCredentials = useCallback(() => {
    setConfirmModal({
      isOpen: true,
      title: '清空设备凭证',
      message: '此操作将清空所有在线设备上的凭证数据！\n离线设备将被跳过。',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const response = await fetch('/api/devices/clear-credentials', {
            method: 'POST',
          });
          const data = await response.json();

          if (data.success) {
            addToast({
              type: 'success',
              title: '清空完成',
              message: `总计：${data.summary.total} 台\n成功：${data.summary.success}，失败：${data.summary.failed}，跳过：${data.summary.skipped}`,
            });
            await fetchSyncLogs();
            await fetchDevices();
          } else {
            addToast({
              type: 'error',
              title: '清空失败',
              message: data.error,
            });
          }
        } catch (error) {
          console.error('清空凭证失败:', error);
          addToast({
            type: 'error',
            title: '清空异常',
            message: (error as Error).message,
          });
        }
      },
    });
  }, [fetchSyncLogs, fetchDevices, addToast]);

  // 锁定虹膜设备
  const handleIrisLock = useCallback(async () => {
    try {
      const response = await fetch('/api/devices/iris-lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 1 }),
      });
      const data = await response.json();

      if (data.success) {
        addToast({
          type: 'success',
          title: '虹膜设备已锁定',
          message: '现在可以用 Postman 测试 memberSave 接口',
        });
      } else {
        addToast({
          type: 'error',
          title: '锁定失败',
          message: data.error,
        });
      }
    } catch (error) {
      console.error('锁定失败:', error);
      addToast({
        type: 'error',
        title: '锁定异常',
        message: (error as Error).message,
      });
    }
  }, [addToast]);

  // 解锁虹膜设备
  const handleIrisUnlock = useCallback(async () => {
    try {
      const response = await fetch('/api/devices/iris-lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 0 }),
      });
      const data = await response.json();

      if (data.success) {
        addToast({
          type: 'success',
          title: '虹膜设备已解锁',
        });
      } else {
        addToast({
          type: 'error',
          title: '解锁失败',
          message: data.error,
        });
      }
    } catch (error) {
      console.error('解锁失败:', error);
      addToast({
        type: 'error',
        title: '解锁异常',
        message: (error as Error).message,
      });
    }
  }, [addToast]);

  // 获取虹膜设备参数
  const handleGetIrisSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/devices/iris-settings');
      const data = await response.json();

      if (data.success) {
        const thresh = data.settings.thresh;
        const message = `虹膜注册质量阈值: ${thresh.irisQualityReg}
虹膜识别质量阈值: ${thresh.irisQualityMatch}
虹膜注册匹配阈值: ${thresh.irisReg}
虹膜比对匹配阈值: ${thresh.irisMatch}
人脸比对阈值: ${thresh.faceMatch}`;

        addToast({
          type: 'success',
          title: '虹膜设备参数',
          message,
        });

        console.log('[IrisSettings] 完整参数:', data.raw);
      } else {
        addToast({
          type: 'error',
          title: '获取参数失败',
          message: data.error,
        });
      }
    } catch (error) {
      console.error('获取参数失败:', error);
      addToast({
        type: 'error',
        title: '获取参数异常',
        message: (error as Error).message,
      });
    }
  }, [addToast]);

  // 设置虹膜阈值（降低阈值以便旧图片能通过）
  const handleSetIrisThreshold = useCallback(async () => {
    setConfirmModal({
      isOpen: true,
      title: '设置虹膜阈值',
      message: '将虹膜阈值设置为 0.6（较低值）\n这可以让之前拉取的虹膜图片能够通过验证。\n\n确定要设置吗？',
      variant: 'warning',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const response = await fetch('/api/devices/iris-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              thresh: {
                irisQualityReg: '0.6',
                irisQualityMatch: '0.6',
                irisReg: '0.6',
                irisMatch: '0.6',
              },
            }),
          });
          const data = await response.json();

          if (data.success) {
            addToast({
              type: 'success',
              title: '阈值设置成功',
              message: `新阈值：\n质量阈值: ${data.thresh.irisQualityReg}\n匹配阈值: ${data.thresh.irisMatch}`,
            });
          } else {
            addToast({
              type: 'error',
              title: '设置失败',
              message: data.error,
            });
          }
        } catch (error) {
          console.error('设置阈值失败:', error);
          addToast({
            type: 'error',
            title: '设置异常',
            message: (error as Error).message,
          });
        }
      },
    });
  }, [addToast]);

  // 模拟删除掌纹凭证
  const handleSimulateDeletePalm = useCallback(async () => {
    setConfirmModal({
      isOpen: true,
      title: '模拟删除掌纹凭证',
      message: '将从数据库中查找掌纹凭证并加入删除队列。\n确定要执行吗？',
      variant: 'warning',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          // 获取掌纹凭证列表
          const response = await fetch('/api/credentials?type=8');
          const data = await response.json();

          if (data.success && data.credentials.length > 0) {
            const cred = data.credentials[0];
            // 调用删除 API
            const deleteResponse = await fetch(`/api/credentials/${cred.credential_id}`, {
              method: 'DELETE',
            });
            const deleteData = await deleteResponse.json();

            if (deleteData.success) {
              addToast({
                type: 'success',
                title: '删除成功',
                message: `已删除 ${cred.person_name} 的掌纹凭证`,
              });
              await fetchSyncLogs();
            } else {
              addToast({
                type: 'error',
                title: '删除失败',
                message: deleteData.error,
              });
            }
          } else {
            addToast({
              type: 'info',
              title: '无掌纹凭证',
              message: '数据库中没有掌纹凭证可删除',
            });
          }
        } catch (error) {
          console.error('删除失败:', error);
          addToast({
            type: 'error',
            title: '删除异常',
            message: (error as Error).message,
          });
        }
      },
    });
  }, [addToast, fetchSyncLogs]);

  // 模拟添加虹膜凭证（使用选中的凭证）
  const handleSimulateAddIris = useCallback(async () => {
    if (!selectedCredentialId) {
      addToast({
        type: 'error',
        title: '请选择凭证',
        message: '请先选择要添加的虹膜凭证',
      });
      return;
    }

    setAddSimulating(true);
    try {
      const addResponse = await fetch('/api/credentials/simulate-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential_id: selectedCredentialId }),
      });
      const addData = await addResponse.json();

      if (addData.success) {
        const cred = irisCredentials.find(c => c.credential_id === selectedCredentialId);
        addToast({
          type: 'success',
          title: '添加成功',
          message: `已添加 ${cred?.person_name || ''}（person_id: ${cred?.person_id || ''})`,
        });
        await fetchSyncLogs();
      } else {
        addToast({
          type: 'error',
          title: '添加失败',
          message: addData.error,
        });
      }
    } catch (error) {
      console.error('添加失败:', error);
      addToast({
        type: 'error',
        title: '添加异常',
        message: (error as Error).message,
      });
    } finally {
      setAddSimulating(false);
    }
  }, [selectedCredentialId, irisCredentials, addToast, fetchSyncLogs]);

  // 测试虹膜添加（固定凭证ID）
  const handleTestIrisAdd = useCallback(async () => {
    setTestAddLoading(true);
    try {
      const response = await fetch('/api/test/iris-add', {
        method: 'POST',
      });
      const data = await response.json();

      if (data.success) {
        addToast({
          type: 'success',
          title: '虹膜添加成功',
          message: `${data.data?.personName} (credentialId: ${data.data?.credentialId})`,
        });
        await fetchSyncLogs();
      } else {
        addToast({
          type: 'error',
          title: '添加失败',
          message: data.error,
        });
      }
    } catch (error) {
      console.error('测试添加失败:', error);
      addToast({
        type: 'error',
        title: '添加异常',
        message: (error as Error).message,
      });
    } finally {
      setTestAddLoading(false);
    }
  }, [addToast, fetchSyncLogs]);

  // 测试虹膜删除（固定凭证ID，同时删设备和数据库）
  const handleTestIrisDelete = useCallback(async () => {
    setTestDeleteLoading(true);
    try {
      const response = await fetch('/api/test/iris-delete', {
        method: 'POST',
      });
      const data = await response.json();

      if (data.success) {
        addToast({
          type: 'success',
          title: '虹膜删除成功',
          message: `设备已删除，数据库已${data.data?.dbDeleted ? '删除' : '无记录'}`,
        });
        await fetchSyncLogs();
      } else {
        addToast({
          type: 'error',
          title: '删除失败',
          message: data.error,
        });
      }
    } catch (error) {
      console.error('测试删除失败:', error);
      addToast({
        type: 'error',
        title: '删除异常',
        message: (error as Error).message,
      });
    } finally {
      setTestDeleteLoading(false);
    }
  }, [addToast, fetchSyncLogs]);

  // 只删除设备上的虹膜数据（不删数据库）
  const handleDeleteIrisDeviceOnly = useCallback(async () => {
    if (!selectedCredentialId) {
      addToast({
        type: 'error',
        title: '请选择凭证',
        message: '请先选择要删除的虹膜凭证',
      });
      return;
    }

    const cred = irisCredentials.find(c => c.credential_id === selectedCredentialId);
    if (!cred) {
      addToast({
        type: 'error',
        title: '凭证不存在',
        message: '选中的凭证不在列表中',
      });
      return;
    }

    setDeleteIrisSimulating(true);
    try {
      const response = await fetch('/api/devices/delete-iris-device-only', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: cred.person_id }),
      });
      const data = await response.json();

      if (data.success) {
        addToast({
          type: 'success',
          title: '删除成功',
          message: `已从设备删除 ${cred.person_name}（person_id: ${cred.person_id}）`,
        });
        await fetchSyncLogs();
      } else {
        addToast({
          type: 'error',
          title: '删除失败',
          message: data.error,
        });
      }
    } catch (error) {
      console.error('删除失败:', error);
      addToast({
        type: 'error',
        title: '删除异常',
        message: (error as Error).message,
      });
    } finally {
      setDeleteIrisSimulating(false);
    }
  }, [selectedCredentialId, irisCredentials, addToast, fetchSyncLogs]);

  // 测试上传虹膜数据（从 data 目录读 JSON 文件直接上传）
  const handleIrisUploadTest = useCallback(async () => {
    setIrisUploadLoading(true);
    setIrisUploadResult(null);
    try {
      const response = await fetch('/api/test/iris-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'iris_test.json' }),
      });
      const data = await response.json();

      if (data.success) {
        setIrisUploadResult({
          success: true,
          message: `上传成功！总耗时 ${data.duration_ms}ms`,
          data: data.response,
          logs: data.logs || [],
        });
        await fetchSyncLogs();
      } else {
        setIrisUploadResult({
          success: false,
          message: data.error || '上传失败',
          logs: data.logs || [],
        });
      }
    } catch (error) {
      setIrisUploadResult({
        success: false,
        message: (error as Error).message,
      });
    } finally {
      setIrisUploadLoading(false);
    }
  }, [fetchSyncLogs]);

  // 模拟更新凭证显示信息
  const handleSimulateUpdateShowInfo = useCallback(async () => {
    try {
      // 获取凭证列表
      const response = await fetch('/api/credentials');
      const data = await response.json();

      if (data.success && data.credentials.length > 0) {
        const cred = data.credentials[0];
        const newShowInfo = `欢迎,${cred.person_name}`;

        const updateResponse = await fetch(`/api/credentials/${cred.credential_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ show_info: newShowInfo }),
        });
        const updateData = await updateResponse.json();

        if (updateData.success) {
          addToast({
            type: 'success',
            title: '更新成功',
            message: `已更新 ${cred.person_name} 的显示信息为: ${newShowInfo}`,
          });
        } else {
          addToast({
            type: 'error',
            title: '更新失败',
            message: updateData.error,
          });
        }
      } else {
        addToast({
          type: 'info',
          title: '无凭证',
          message: '数据库中没有凭证可更新',
        });
      }
    } catch (error) {
      console.error('更新失败:', error);
      addToast({
        type: 'error',
        title: '更新异常',
        message: (error as Error).message,
      });
    }
  }, [addToast]);

  // 停止下发
  const handleStopSync = useCallback((queueId: number) => {
    setConfirmModal({
      isOpen: true,
      title: '停止下发',
      message: '确定要停止下发吗？\n停止后将不再自动重试。',
      variant: 'warning',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const response = await fetch('/api/devices/sync/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queueId }),
          });
          const data = await response.json();

          if (data.success) {
            addToast({
              type: 'success',
              title: '已停止下发',
            });
            await fetchSyncLogs();
          } else {
            addToast({
              type: 'error',
              title: '停止失败',
              message: data.error,
            });
          }
        } catch (error) {
          console.error('停止下发失败:', error);
          addToast({
            type: 'error',
            title: '停止异常',
            message: (error as Error).message,
          });
        }
      },
    });
  }, [fetchSyncLogs, addToast]);

  // 清空下发记录
  const handleClearSyncLogs = useCallback(() => {
    setConfirmModal({
      isOpen: true,
      title: '清空下发记录',
      message: '确定要清空所有下发记录吗？\n这将同时停止所有正在重试的下发任务。',
      variant: 'warning',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const response = await fetch('/api/devices/sync/clear-logs', {
            method: 'POST',
          });
          const data = await response.json();

          if (data.success) {
            addToast({
              type: 'success',
              title: '已清空下发记录',
            });
            await fetchSyncLogs();
          } else {
            addToast({
              type: 'error',
              title: '清空失败',
              message: data.error,
            });
          }
        } catch (error) {
          console.error('清空记录失败:', error);
          addToast({
            type: 'error',
            title: '清空异常',
            message: (error as Error).message,
          });
        }
      },
    });
  }, [fetchSyncLogs, addToast]);

  const allDevicesOffline = devices.length > 0 && devices.every(d => d.status === 'offline');
  const iamsOffline = iamsStatus.status === 'offline';

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toast Notifications */}
      <Toast toasts={toasts} removeToast={removeToast} />

      {/* Confirm Modal */}
      {confirmModal && (
        <ConfirmModal
          isOpen={confirmModal.isOpen}
          title={confirmModal.title}
          message={confirmModal.message}
          variant={confirmModal.variant}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
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
              <h1 className="text-2xl font-bold text-gray-900">设备管理</h1>
            </div>
            <nav className="flex space-x-4">
              <a href="/dashboard/devices" className="text-blue-600 font-medium">设备管理</a>
              <a href="/dashboard/credentials" className="text-gray-600 hover:text-gray-900">凭证管理</a>
              <a href="/dashboard/mqtt-events" className="text-gray-600 hover:text-gray-900">MQTT指令</a>
              <a href="/dashboard/pass-logs" className="text-gray-600 hover:text-gray-900">通行记录</a>
              <a href="/dashboard/logs" className="text-gray-600 hover:text-gray-900">服务器日志</a>
              <a href="/dashboard/settings" className="text-gray-600 hover:text-gray-900">系统设置</a>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* IAMS 平台状态 */}
          <div className="bg-white rounded-2xl shadow-xl border-2 border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-black text-gray-900">IAMS 平台</h2>
              <div className="flex items-center space-x-2">
                <span className={`w-3 h-3 rounded-full ${iamsOffline ? 'bg-red-500' : 'bg-green-500'}`}></span>
                <span className={`text-sm font-bold ${iamsOffline ? 'text-red-600' : 'text-green-600'}`}>
                  {iamsOffline ? '离线' : '在线'}
                </span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-600">通信状态</span>
                <span className={`text-sm font-bold ${iamsStatus.status === 'online' ? 'text-green-600' : 'text-red-600'}`}>
                  {iamsStatus.status === 'online' ? '正常' : '断开'}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-600">MQTT 连接</span>
                <span className={`text-sm font-bold ${iamsStatus.status === 'online' ? 'text-green-600' : 'text-red-600'}`}>
                  {iamsStatus.status === 'online' ? '已连接' : '未连接'}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-600">最后同步</span>
                <span className="text-sm text-gray-900">{iamsStatus.lastSyncTime}</span>
              </div>
            </div>
          </div>

          {/* 识别设备状态 */}
          <div className="bg-white rounded-2xl shadow-xl border-2 border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-black text-gray-900">识别设备</h2>
              <div className="flex items-center space-x-2">
                <span className={`w-3 h-3 rounded-full ${allDevicesOffline ? 'bg-red-500' : 'bg-green-500'}`}></span>
                <span className={`text-sm font-bold ${allDevicesOffline ? 'text-red-600' : 'text-green-600'}`}>
                  {allDevicesOffline ? '离线' : '在线'}
                </span>
              </div>
            </div>
            <div className="space-y-3">
              {devices.length === 0 ? (
                <div className="p-4 text-center text-gray-500">暂无设备</div>
              ) : (
                devices.map((device) => (
                  <div key={device.id} className="p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">{device.name}</span>
                      <span className={`text-xs px-2 py-1 rounded-full ${device.status === 'online' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {device.status === 'online' ? '在线' : '离线'}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {device.type === 'iris' ? '虹膜' : '掌纹'}设备 · {device.ip}:{device.port}
                      {device.status === 'online' && device.credential_count !== null && (
                        <span className="ml-2 text-blue-600 font-medium">
                          · {device.credential_count} 条凭证
                        </span>
                      )}
                      {device.status === 'offline' && (
                        <span className="ml-2 text-red-500 font-medium">
                          · 离线
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Sync Logs Table */}
        <div className="bg-white rounded-2xl shadow-xl border-2 border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-black text-gray-900">下发记录</h2>
            <div className="flex items-center space-x-4">
              <button
                onClick={handleClearSyncLogs}
                className="px-3 py-1 text-sm text-red-600 border border-red-300 rounded-lg hover:bg-red-50"
              >
                清空记录
              </button>
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600">自动刷新</span>
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-40">时间</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">凭证ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-40">方向</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-32">类型</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-24">状态</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">消息</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-20">操作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {syncLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">暂无下发记录</td>
                  </tr>
                ) : (
                  syncLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">{new Date(log.created_at).toLocaleString('zh-CN')}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 font-mono">{log.credential_id || '-'}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs ${log.action.includes('delete') ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}>
                          {log.action.includes('delete') ? '↓ 删除' : '↓ 下发'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          log.device_type === 'palm' ? 'bg-green-100 text-green-800' :
                          log.device_type === 'iris' ? 'bg-purple-100 text-purple-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {log.device_type === 'palm' ? '掌纹' :
                           log.device_type === 'iris' ? '虹膜' :
                           log.device_type || '未知'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          log.status === 'success' ? 'bg-green-100 text-green-800' :
                          log.status === 'retrying' ? 'bg-orange-100 text-orange-800' :
                          log.status === 'offline' ? 'bg-gray-100 text-gray-600' :
                          log.status === 'failed' ? 'bg-red-100 text-red-800' :
                          log.status === 'stopped' ? 'bg-gray-100 text-gray-600' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {log.status === 'success' ? '成功' :
                           log.status === 'retrying' ? '持续尝试' :
                           log.status === 'offline' ? '设备离线' :
                           log.status === 'failed' ? '失败' :
                           log.status === 'stopped' ? '已停止' : '进行中'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 truncate max-w-xs" title={log.error_message || log.response || ''}>{log.error_message || log.response || '-'}</td>
                      <td className="px-4 py-3 text-sm">
                        {(log.status === 'retrying' || log.status === 'offline') && (
                          <button
                            onClick={() => handleStopSync(log.queue_id)}
                            className="px-2 py-1 text-xs text-red-600 border border-red-300 rounded hover:bg-red-50"
                          >
                            停止下发
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 测试区域 */}
        <div className="bg-white rounded-2xl shadow-xl border-2 border-gray-200 p-6 mt-6">
          <h2 className="text-xl font-black text-gray-900 mb-4">测试区域</h2>

          {/* 虹膜数据上传测试 - 从 iris_test.json 读取 */}
          <div className="border border-gray-200 rounded-lg p-4 mb-4">
            <h3 className="font-bold text-gray-800 mb-2">虹膜数据上传测试</h3>
            <p className="text-sm text-gray-500 mb-3">
              完整流程：锁定设备 → 等待8秒 → 上传(memberSave) → 等待500ms → 解锁设备。
              请将保存的 JSON 文件放到 data 目录并命名为 <code className="bg-gray-100 px-1 rounded">iris_test.json</code>。
            </p>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleIrisUploadTest}
                disabled={irisUploadLoading}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  irisUploadLoading
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
                }`}
              >
                {irisUploadLoading ? '上传中...' : '上传虹膜数据'}
              </button>
            </div>
            {irisUploadResult && (
              <div className={`mt-3 rounded-lg text-sm ${
                irisUploadResult.success
                  ? 'bg-green-50 border border-green-200 text-green-800'
                  : 'bg-red-50 border border-red-200 text-red-800'
              }`}>
                <div className="p-3">
                  <div className="font-bold">{irisUploadResult.success ? '成功' : '失败'}</div>
                  <div>{irisUploadResult.message}</div>
                </div>
                {irisUploadResult.logs && irisUploadResult.logs.length > 0 && (
                  <div className="border-t border-green-200 bg-white rounded-b-lg">
                    <div className="px-3 py-2 text-xs font-bold text-gray-500">执行日志：</div>
                    <pre className="px-3 pb-3 text-xs bg-gray-900 text-green-300 p-3 rounded-b-lg overflow-x-auto max-h-60 whitespace-pre-wrap">
                      {irisUploadResult.logs.join('\n')}
                    </pre>
                  </div>
                )}
                {irisUploadResult.data && (
                  <div className="border-t border-green-200 p-3">
                    <div className="text-xs font-bold text-gray-500 mb-1">设备响应：</div>
                    <pre className="text-xs bg-white p-2 rounded overflow-x-auto max-h-40">
                      {JSON.stringify(irisUploadResult.data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 虹膜模拟测试（固定凭证ID: 999999） */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="font-bold text-gray-800 mb-2">虹膜模拟测试</h3>
            <p className="text-sm text-gray-500 mb-3">
              从 <code className="bg-gray-100 px-1 rounded">data/iris_user_*.json</code> 读取数据，通过完整流程（锁定→上传→解锁）添加到虹膜设备。
            </p>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleTestIrisAdd}
                disabled={testAddLoading}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  testAddLoading
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-green-600 text-white hover:bg-green-700 shadow-sm'
                }`}
              >
                {testAddLoading ? '添加中...' : '虹膜模拟添加'}
              </button>
              <button
                onClick={handleTestIrisDelete}
                disabled={testDeleteLoading}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  testDeleteLoading
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-red-600 text-white hover:bg-red-700 shadow-sm'
                }`}
              >
                {testDeleteLoading ? '删除中...' : '虹膜模拟删除'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

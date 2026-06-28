/**
 * 系统设置页面
 */
'use client';

import { useEffect, useState, useCallback } from 'react';
import Toast, { ToastMessage } from '@/components/Toast';

interface SystemSettings {
  authTimeout: number;
  successReturnTime: number;
  irisEndpoint: string;
  palmEndpoint: string;
  deviceId: string;
  maxPassLogs: number;
  mqttBroker: string;
  mqttUsername: string;
  mqttPassword: string;
  aesEnabled: boolean;
  adminPassword: string;
}

interface ClientConfig {
  serverUrl: string;
}

// 模拟 IAMS 下发结果接口
interface SimulateResult {
  personName: string;
  credentialType: number;
  targetDevice: string;
  status: 'queued' | 'skipped';
  message: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SystemSettings>({
    authTimeout: 60,
    successReturnTime: 10,
    irisEndpoint: 'http://192.168.3.202:9003',
    palmEndpoint: 'http://127.0.0.1:8080',
    deviceId: 'nuoyadev1',
    maxPassLogs: 1000,
    mqttBroker: 'mqtt://58.33.106.19:3881',
    mqttUsername: 'yq-device',
    mqttPassword: 'yqyq123!@#',
    aesEnabled: true,
    adminPassword: '12345',
  });
  const [clientConfig, setClientConfig] = useState<ClientConfig>({
    serverUrl: 'http://localhost:3001',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showClientConfigDialog, setShowClientConfigDialog] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [unlockingIris, setUnlockingIris] = useState(false);
  const [lockingIris, setLockingIris] = useState(false);
  const [testingIrisUpload, setTestingIrisUpload] = useState(false);
  const [irisTestResult, setIrisTestResult] = useState<{ success: boolean; message: string; logs?: string[] } | null>(null);
  const [fetchingIrisMembers, setFetchingIrisMembers] = useState(false);
  const [irisMembersResult, setIrisMembersResult] = useState<{ success: boolean; message: string; count?: number; logs?: string[] } | null>(null);
  const [testingIrisProvision, setTestingIrisProvision] = useState(false);
  const [irisProvisionResult, setIrisProvisionResult] = useState<{ success: boolean; message: string; logs?: string[] } | null>(null);
  const [irisDiagInterval, setIrisDiagInterval] = useState(1500);
  const [testingIrisDiagGuard, setTestingIrisDiagGuard] = useState(false);
  const [testingIrisDiagQueue, setTestingIrisDiagQueue] = useState(false);
  const [irisDiagResult, setIrisDiagResult] = useState<{ success: boolean; message: string; mode?: string; logFile?: string; logs?: string[] } | null>(null);
  const [restartingBackend, setRestartingBackend] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [version, setVersion] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordChangeError, setPasswordChangeError] = useState('');
  const [passwordFocusField, setPasswordFocusField] = useState<'new' | 'confirm' | null>(null); // 虚拟键盘焦点
  // 凭证批量测试状态
  const [addComboLoading, setAddComboLoading] = useState(false);
  const [addSingleLoading, setAddSingleLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [batchResult, setBatchResult] = useState<{ success: boolean; message: string; logs?: string[]; data?: any } | null>(null);

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // 加载设置
  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/settings');
      const data = await response.json();

      if (data.success) {
        setSettings(data.settings);
      } else {
        addToast({
          type: 'error',
          title: '加载失败',
          message: data.error,
        });
      }
    } catch (error: any) {
      addToast({
        type: 'error',
        title: '加载异常',
        message: error.message,
      });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  // 加载客户端配置
  const fetchClientConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/client-config');
      const data = await response.json();

      if (data.success) {
        setClientConfig(data.config);
      }
    } catch (error: any) {
      console.error('加载客户端配置失败:', error);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchClientConfig();
    fetch('/api/version').then(r => r.json()).then(d => { if (d.success) setVersion(d.version); }).catch(() => {});
  }, [fetchSettings, fetchClientConfig]);

  // 保存设置
  const handleSave = async () => {
    setSaving(true);

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      const data = await response.json();

      if (data.success) {
        addToast({
          type: 'success',
          title: '保存成功',
          message: data.message,
        });
        setSettings(data.settings);
      } else {
        addToast({
          type: 'error',
          title: '保存失败',
          message: data.error,
        });
      }
    } catch (error: any) {
      addToast({
        type: 'error',
        title: '保存异常',
        message: error.message,
      });
    } finally {
      setSaving(false);
    }
  };

  // 保存客户端配置并重启
  const handleSaveClientConfig = async () => {
    try {
      const response = await fetch('/api/client-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clientConfig),
      });

      const data = await response.json();

      if (data.success) {
        setShowClientConfigDialog(false);
        addToast({
          type: 'success',
          title: '配置已保存',
          message: '正在重启客户端...',
        });

        // 延迟后重启 Electron
        setTimeout(() => {
          if (window.electronAPI?.restartApp) {
            window.electronAPI.restartApp();
          } else {
            addToast({
              type: 'info',
              title: '请手动重启',
              message: '配置已保存，请重启客户端生效',
            });
          }
        }, 1000);
      } else {
        addToast({
          type: 'error',
          title: '保存失败',
          message: data.error,
        });
      }
    } catch (error: any) {
      addToast({
        type: 'error',
        title: '保存异常',
        message: error.message,
      });
    }
  };

  // 数字输入变化处理
  const handleNumberChange = (field: 'authTimeout' | 'successReturnTime' | 'maxPassLogs', value: string) => {
    const numValue = parseInt(value, 10);
    if (!isNaN(numValue) && numValue > 0) {
      setSettings((prev) => ({
        ...prev,
        [field]: numValue,
      }));
    }
  };

  // 文本输入变化处理
  const handleTextChange = (field: 'irisEndpoint' | 'palmEndpoint' | 'deviceId' | 'mqttBroker' | 'mqttUsername' | 'mqttPassword', value: string) => {
    setSettings((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // AES开关变化处理
  const handleAesToggle = (checked: boolean) => {
    setSettings((prev) => ({
      ...prev,
      aesEnabled: checked,
    }));
  };

  // 虹膜设备解锁
  const handleUnlockIris = async () => {
    setUnlockingIris(true);
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
          title: '解锁成功',
          message: '虹膜设备已解锁',
        });
      } else {
        addToast({
          type: 'error',
          title: '解锁失败',
          message: data.error,
        });
      }
    } catch (error: any) {
      addToast({
        type: 'error',
        title: '解锁异常',
        message: error.message,
      });
    } finally {
      setUnlockingIris(false);
    }
  };

  // 虹膜设备锁定
  const handleLockIris = async () => {
    setLockingIris(true);
    try {
      const response = await fetch('/api/devices/iris-lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 1 }),
      });
      const data = await response.json();
      if (data.success) {
        addToast({ type: 'success', title: '锁定成功', message: '虹膜设备已锁定' });
      } else {
        addToast({ type: 'error', title: '锁定失败', message: data.error });
      }
    } catch (error: any) {
      addToast({ type: 'error', title: '锁定异常', message: error.message });
    } finally {
      setLockingIris(false);
    }
  };

  // 虹膜测试上传（读取 iris_last_request.json，锁定→500ms→上传→解锁）
  const handleTestIrisUpload = async () => {
    setTestingIrisUpload(true);
    setIrisTestResult(null);
    try {
      const response = await fetch('/api/devices/test-iris-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      setIrisTestResult({
        success: data.success,
        message: data.success ? '上传成功' : data.error || '上传失败',
        logs: data.logs,
      });
    } catch (error: any) {
      setIrisTestResult({ success: false, message: error.message });
    } finally {
      setTestingIrisUpload(false);
    }
  };

  // 虹膜完整下发测试（模拟 IAMS passport-add 完整流程）
  const handleTestIrisProvision = async () => {
    setTestingIrisProvision(true);
    setIrisProvisionResult(null);
    try {
      const response = await fetch('/api/device/iris/test-provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      setIrisProvisionResult({
        success: data.success,
        message: data.success
          ? `下发成功！credentialId=${data.credentialId}, 密码凭证=${data.passwordCredentialId}, ${data.personName}(${data.personId})`
          : data.error || '下发失败',
        logs: data.logs,
      });
      if (data.success) {
        addToast({ type: 'success', title: '虹膜下发测试成功', message: `人员: ${data.personName}` });
      }
    } catch (error: any) {
      setIrisProvisionResult({ success: false, message: error.message });
      addToast({ type: 'error', title: '虹膜下发测试异常', message: error.message });
    } finally {
      setTestingIrisProvision(false);
    }
  };

  // 虹膜并发诊断测试
  const handleIrisDiagnostics = async (mode: 'guard' | 'queue') => {
    if (mode === 'guard') {
      setTestingIrisDiagGuard(true);
    } else {
      setTestingIrisDiagQueue(true);
    }
    setIrisDiagResult(null);
    try {
      const response = await fetch('/api/device/iris/diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, intervalMs: irisDiagInterval }),
      });
      const data = await response.json();
      setIrisDiagResult({
        success: data.success,
        message: data.success
          ? `${mode === 'guard' ? 'Guard' : 'Queue'} 模式测试完成（日志: ${data.logFile || '无'}）`
          : data.error || '测试失败',
        mode,
        logFile: data.logFile,
        logs: data.logs,
      });
    } catch (error: any) {
      setIrisDiagResult({ success: false, message: error.message, mode });
    } finally {
      setTestingIrisDiagGuard(false);
      setTestingIrisDiagQueue(false);
    }
  };

  // 获取虹膜设备成员（保存到本地用于测试）
  const handleFetchIrisMembers = async () => {
    setFetchingIrisMembers(true);
    setIrisMembersResult(null);
    try {
      const response = await fetch('/api/device/iris/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 100, needImages: true }),
      });
      const data = await response.json();
      setIrisMembersResult({
        success: data.success,
        message: data.success
          ? `获取到 ${data.count} 个成员，图像格式: ${data.format}，已保存到 ${data.savePath || '本地'}`
          : data.error || '获取失败',
        count: data.count,
        logs: data.logs,
      });
    } catch (error: any) {
      setIrisMembersResult({ success: false, message: error.message });
    } finally {
      setFetchingIrisMembers(false);
    }
  };

  // 重启后台服务
  const handleRestartBackend = async () => {
    setRestartingBackend(true);
    try {
      const result = await window.electronAPI?.restartBackend();
      if (result?.success) {
        addToast({
          type: 'success',
          title: '重启成功',
          message: '后台服务已重启，页面已刷新',
        });
      } else {
        addToast({
          type: 'error',
          title: '重启失败',
          message: result?.message || '未知错误',
        });
      }
    } catch (error: any) {
      addToast({
        type: 'error',
        title: '重启异常',
        message: error.message,
      });
    } finally {
      setRestartingBackend(false);
    }
  };

  // 清理缓存
  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      const result = await window.electronAPI?.clearCache();
      if (result?.success) {
        addToast({
          type: 'success',
          title: '清理完成',
          message: result.message || '缓存已清理',
        });
      } else {
        addToast({
          type: 'error',
          title: '清理失败',
          message: '未知错误',
        });
      }
    } catch (error: any) {
      addToast({
        type: 'error',
        title: '清理异常',
        message: error.message,
      });
    } finally {
      setClearingCache(false);
    }
  };

  // 刷新页面
  const handleReloadPage = async () => {
    window.electronAPI?.reload();
  };

  // 修改管理员密码
  const handleChangePassword = async () => {
    if (newPassword.length < 5) {
      setPasswordChangeError('密码至少5位');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordChangeError('两次输入的密码不一致');
      return;
    }
    setChangingPassword(true);
    setPasswordChangeError('');
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, adminPassword: newPassword }),
      });
      const data = await response.json();
      if (data.success) {
        setSettings((prev) => ({ ...prev, adminPassword: newPassword }));
        setShowPasswordDialog(false);
        setNewPassword('');
        setConfirmPassword('');
        addToast({
          type: 'success',
          title: '密码已修改',
          message: '管理员密码已更新',
        });
      } else {
        setPasswordChangeError('修改失败：' + (data.error || '未知错误'));
      }
    } catch (error: any) {
      setPasswordChangeError('修改异常：' + error.message);
    } finally {
      setChangingPassword(false);
    }
  };


  return (
    <div className="min-h-screen bg-gray-100">
      <Toast toasts={toasts} removeToast={removeToast} />

      {/* 退出程序按钮 */}
      <div className="bg-red-50 border-b border-red-100">
        <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span className="text-sm text-red-800 font-medium">退出后将完全关闭程序，需通过托盘图标重新打开</span>
          </div>
          <button
            onClick={() => {
              if (window.electronAPI?.quitApp) {
                window.electronAPI.quitApp();
              }
            }}
            className="px-5 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-all duration-200 flex items-center space-x-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>退出程序</span>
          </button>
        </div>
      </div>

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
              <h1 className="text-2xl font-bold text-gray-900">系统设置</h1>
              {version && (
                <span className="px-2 py-1 bg-gray-100 text-gray-500 rounded text-xs font-mono">v{version}</span>
              )}
            </div>
            <nav className="flex space-x-4">
              <a href="/dashboard/devices" className="text-gray-600 hover:text-gray-900">设备管理</a>
              <a href="/dashboard/credentials" className="text-gray-600 hover:text-gray-900">凭证管理</a>
              <a href="/dashboard/mqtt-events" className="text-gray-600 hover:text-gray-900">MQTT指令</a>
              <a href="/dashboard/pass-logs" className="text-gray-600 hover:text-gray-900">通行记录</a>
              <a href="/dashboard/logs" className="text-gray-600 hover:text-gray-900">服务器日志</a>
              <a href="/dashboard/settings" className="text-blue-600 font-medium">系统设置</a>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {loading ? (
          <div className="p-8 text-center text-gray-500">加载中...</div>
        ) : (
          <div className="space-y-6">
            {/* 客户端配置 */}
            <div className="bg-gradient-to-r from-gray-900 to-gray-800 shadow rounded-lg p-6 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold flex items-center space-x-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <span>客户端配置</span>
                  </h2>
                  <p className="mt-2 text-gray-300 text-sm">
                    当前服务器: <span className="font-mono bg-gray-700 px-2 py-1 rounded">{clientConfig.serverUrl.replace('http://', '')}</span>
                  </p>
                </div>
                <button
                  onClick={() => setShowClientConfigDialog(true)}
                  className="px-4 py-2 bg-white text-gray-900 rounded-lg font-medium hover:bg-gray-100 transition-all duration-200 flex items-center space-x-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>修改配置</span>
                </button>
              </div>
              <p className="mt-4 text-xs text-gray-400">
                ⚠️ 修改后客户端将自动重启。一体化部署请保持 localhost:3001
              </p>
            </div>

            {/* 认证参数设置 */}
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-6">认证参数设置</h2>

              <div className="space-y-6">
                {/* 认证超时时间 */}
                <div className="flex items-center justify-between py-4 border-b">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      认证超时时间
                    </label>
                    <p className="mt-1 text-sm text-gray-500">
                      虹膜/掌纹验证的总超时时间，超过此时间将返回凭证选择页
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="5"
                      max="300"
                      value={settings.authTimeout}
                      onChange={(e) => handleNumberChange('authTimeout', e.target.value)}
                      className="w-24 px-3 py-2 border border-gray-300 rounded-md text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-gray-500">秒</span>
                  </div>
                </div>

                {/* 认证成功返回时间 */}
                <div className="flex items-center justify-between py-4 border-b">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      认证成功返回时间
                    </label>
                    <p className="mt-1 text-sm text-gray-500">
                      认证成功后显示结果页的时间，之后自动返回待机页
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={settings.successReturnTime}
                      onChange={(e) => handleNumberChange('successReturnTime', e.target.value)}
                      className="w-24 px-3 py-2 border border-gray-300 rounded-md text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-gray-500">秒</span>
                  </div>
                </div>

                {/* AES加密开关 */}
                <div className="flex items-center justify-between py-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      启用 AES 加密
                    </label>
                    <p className="mt-1 text-sm text-gray-500">
                      IAMS 下发的用户编码为 AES 加密密文时请启用。启用后用户输入将自动加密后查询
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.aesEnabled}
                      onChange={(e) => handleAesToggle(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-100 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              </div>
            </div>

            {/* 设备地址设置 */}
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-6">设备地址设置</h2>

              <div className="space-y-6">
                {/* 虹膜设备地址 */}
                <div className="py-4 border-b">
                  <label className="block text-sm font-medium text-gray-700">
                    虹膜设备地址
                  </label>
                  <p className="mt-1 text-sm text-gray-500 mb-2">
                    虹膜识别设备的 HTTP 接口地址，用于查询识别记录
                  </p>
                  <input
                    type="text"
                    value={settings.irisEndpoint}
                    onChange={(e) => handleTextChange('irisEndpoint', e.target.value)}
                    placeholder="http://192.168.3.202:9003"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* 掌纹设备地址 */}
                <div className="py-4">
                  <label className="block text-sm font-medium text-gray-700">
                    掌纹设备地址
                  </label>
                  <p className="mt-1 text-sm text-gray-500 mb-2">
                    掌纹识别设备的 HTTP 接口地址，用于查询识别结果
                  </p>
                  <input
                    type="text"
                    value={settings.palmEndpoint}
                    onChange={(e) => handleTextChange('palmEndpoint', e.target.value)}
                    placeholder="http://127.0.0.1:8080"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* 设备工具 */}
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-6">设备工具</h2>

              <div className="space-y-6">
                {/* 虹膜设备解锁 */}
                <div className="py-4 border-b">
                  <label className="block text-sm font-medium text-gray-700">
                    虹膜设备解锁
                  </label>
                  <p className="mt-1 text-sm text-gray-500 mb-4">
                    服务异常退出时可能未解锁虹膜设备，点击发送解锁指令恢复设备可用状态
                  </p>
                  <button
                    onClick={handleUnlockIris}
                    disabled={unlockingIris}
                    className="px-6 py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-black disabled:bg-gray-400 disabled:cursor-not-allowed transition-all duration-200 flex items-center space-x-2"
                  >
                    {unlockingIris ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>解锁中...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                        </svg>
                        <span>解锁虹膜设备</span>
                      </>
                    )}
                  </button>
                </div>

                {/* 虹膜设备锁定 */}
                <div className="py-4 border-b">
                  <label className="block text-sm font-medium text-gray-700">
                    虹膜设备锁定
                  </label>
                  <p className="mt-1 text-sm text-gray-500 mb-4">
                    手动锁定虹膜设备，为后续上传做准备
                  </p>
                  <button
                    onClick={handleLockIris}
                    disabled={lockingIris}
                    className="px-6 py-3 bg-gray-600 text-white rounded-lg font-medium hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all duration-200 flex items-center space-x-2"
                  >
                    {lockingIris ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>锁定中...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        <span>锁定虹膜设备</span>
                      </>
                    )}
                  </button>
                </div>

                {/* 虹膜测试上传 */}
                <div className="py-4 border-b">
                  <label className="block text-sm font-medium text-gray-700">
                    虹膜测试上传
                  </label>
                  <p className="mt-1 text-sm text-gray-500 mb-4">
                    使用 data/iris_last_request.json 中的 BMP 数据，按 锁定→300ms→上传→解锁 流程发送到虹膜设备。使用独立 TCP 连接（与 Postman 效果一致）。需先点击"模拟添加凭证"生成数据文件
                  </p>
                  <button
                    onClick={handleTestIrisUpload}
                    disabled={testingIrisUpload}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all duration-200 flex items-center space-x-2"
                  >
                    {testingIrisUpload ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>上传中...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m0 0l4 4" />
                        </svg>
                        <span>虹膜测试上传</span>
                      </>
                    )}
                  </button>
                  {irisTestResult && (
                    <div className={`mt-4 rounded-lg text-sm ${irisTestResult.success ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                      <div className="p-3">
                        <div className="font-bold">{irisTestResult.success ? '✅ 上传成功' : '❌ 上传失败'}</div>
                        <div>{irisTestResult.message}</div>
                      </div>
                      {irisTestResult.logs && irisTestResult.logs.length > 0 && (
                        <div className="border-t border-green-200 bg-white rounded-b-lg">
                          <div className="px-3 py-2 text-xs font-bold text-gray-500">执行日志：</div>
                          <pre className="px-3 pb-3 text-xs bg-gray-900 text-green-300 rounded-b-lg overflow-x-auto max-h-60 whitespace-pre-wrap">
                            {irisTestResult.logs.join('\n')}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 虹膜完整下发测试 */}
                <div className="py-4 border-b">
                  <label className="block text-sm font-medium text-gray-700">
                    虹膜完整下发测试
                  </label>
                  <p className="mt-1 text-sm text-gray-500 mb-4">
                    模拟 IAMS 下发 passport-add 完整流程：上传到设备 → 加密保存到本地 → 从设备删除。用于生成正式版的虹膜数据文件
                  </p>
                  <button
                    onClick={handleTestIrisProvision}
                    disabled={testingIrisProvision}
                    className="px-6 py-3 bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all duration-200 flex items-center space-x-2"
                  >
                    {testingIrisProvision ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>下发中...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                        </svg>
                        <span>虹膜完整下发测试</span>
                      </>
                    )}
                  </button>
                  {irisProvisionResult && (
                    <div className={`mt-4 rounded-lg text-sm ${irisProvisionResult.success ? 'bg-violet-50 border border-violet-200 text-violet-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                      <div className="p-3">
                        <div className="font-bold">{irisProvisionResult.success ? '✅ 下发成功' : '❌ 下发失败'}</div>
                        <div>{irisProvisionResult.message}</div>
                      </div>
                      {irisProvisionResult.logs && irisProvisionResult.logs.length > 0 && (
                        <div className="border-t border-violet-200 bg-white rounded-b-lg">
                          <div className="px-3 py-2 text-xs font-bold text-gray-500">执行日志：</div>
                          <pre className="px-3 pb-3 text-xs bg-gray-900 text-green-300 rounded-b-lg overflow-x-auto max-h-60 whitespace-pre-wrap">
                            {irisProvisionResult.logs.join('\n')}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 虹膜设备并发诊断测试 */}
                <div className="py-4 border-b">
                  <label className="block text-sm font-medium text-gray-700">
                    虹膜设备并发诊断测试
                  </label>
                  <p className="mt-1 text-sm text-gray-500 mb-4">
                    检测并发请求是否会导致虹膜设备崩溃。<b>Guard 模式</b>：用 Promise.all 同时发起查询+锁定，观察设备反应。<b>Queue 模式</b>：所有请求通过队列串行执行。可调整指令间隔（默认 1500ms）
                  </p>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-600">指令间隔：</label>
                      <input
                        type="number"
                        min="0"
                        max="5000"
                        step="100"
                        value={irisDiagInterval}
                        onChange={(e) => setIrisDiagInterval(parseInt(e.target.value) || 0)}
                        className="w-20 px-2 py-1 border border-gray-300 rounded text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-500">ms</span>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <button
                      onClick={() => handleIrisDiagnostics('guard')}
                      disabled={testingIrisDiagGuard}
                      className="px-6 py-3 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all duration-200 flex items-center space-x-2"
                    >
                      {testingIrisDiagGuard ? (
                        <>
                          <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>测试中...</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          <span>Guard 并发测试</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => handleIrisDiagnostics('queue')}
                      disabled={testingIrisDiagQueue}
                      className="px-6 py-3 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all duration-200 flex items-center space-x-2"
                    >
                      {testingIrisDiagQueue ? (
                        <>
                          <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>测试中...</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                          </svg>
                          <span>Queue 并发测试</span>
                        </>
                      )}
                    </button>
                  </div>
                  {irisDiagResult && (
                    <div className={`mt-4 rounded-lg text-sm ${irisDiagResult.success ? 'bg-teal-50 border border-teal-200 text-teal-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                      <div className="p-3">
                        <div className="font-bold">{irisDiagResult.success ? '✅ 测试完成' : '❌ 测试失败'}</div>
                        <div>{irisDiagResult.message}</div>
                      </div>
                      {irisDiagResult.logs && irisDiagResult.logs.length > 0 && (
                        <div className="border-t border-teal-200 bg-white rounded-b-lg">
                          <div className="px-3 py-2 text-xs font-bold text-gray-500">执行日志：</div>
                          <pre className="px-3 pb-3 text-xs bg-gray-900 text-green-300 rounded-b-lg overflow-x-auto max-h-60 whitespace-pre-wrap">
                            {irisDiagResult.logs.join('\n')}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 获取虹膜设备成员 */}
                <div className="py-4 border-b">
                  <label className="block text-sm font-medium text-gray-700">
                    获取虹膜设备成员
                  </label>
                  <p className="mt-1 text-sm text-gray-500 mb-4">
                    从虹膜设备读取当前成员列表（包含虹膜图像），自动保存到 <code className="bg-gray-100 px-1 rounded">data/iris_test_members/</code> 目录。用于本地测试虹膜下发流程
                  </p>
                  <button
                    onClick={handleFetchIrisMembers}
                    disabled={fetchingIrisMembers}
                    className="px-6 py-3 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all duration-200 flex items-center space-x-2"
                  >
                    {fetchingIrisMembers ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>获取中...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        <span>获取虹膜设备成员</span>
                      </>
                    )}
                  </button>
                  {irisMembersResult && (
                    <div className={`mt-4 rounded-lg text-sm ${irisMembersResult.success ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                      <div className="p-3">
                        <div className="font-bold">{irisMembersResult.success ? '获取成功' : '获取失败'}</div>
                        <div>{irisMembersResult.message}</div>
                      </div>
                      {irisMembersResult.logs && irisMembersResult.logs.length > 0 && (
                        <div className="border-t border-emerald-200 bg-white rounded-b-lg">
                          <div className="px-3 py-2 text-xs font-bold text-gray-500">执行日志：</div>
                          <pre className="px-3 pb-3 text-xs bg-gray-900 text-green-300 rounded-b-lg overflow-x-auto max-h-60 whitespace-pre-wrap">
                            {irisMembersResult.logs.join('\n')}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 重启后台服务 */}
                <div className="py-4">
                  <label className="block text-sm font-medium text-gray-700">
                    重启后台服务
                  </label>
                  <p className="mt-1 text-sm text-gray-500 mb-4">
                    重启 Next.js 后台服务（不关闭客户端），适用于服务异常或配置更改后刷新
                  </p>
                  <button
                    onClick={handleRestartBackend}
                    disabled={restartingBackend}
                    className="px-6 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all duration-200 flex items-center space-x-2"
                  >
                    {restartingBackend ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>重启中...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <span>重启后台服务</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* 缓存清理 */}
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-6">缓存清理</h2>

              <div className="space-y-6">
                {/* 清理缓存 */}
                <div className="py-4 border-b">
                  <label className="block text-sm font-medium text-gray-700">
                    清理系统缓存
                  </label>
                  <p className="mt-1 text-sm text-gray-500 mb-4">
                    清理 Next.js 编译缓存和浏览器缓存。适用于页面显示异常、凭证管理列表缺少列等问题
                  </p>
                  <button
                    onClick={handleClearCache}
                    disabled={clearingCache}
                    className="px-6 py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-black disabled:bg-gray-400 disabled:cursor-not-allowed transition-all duration-200 flex items-center space-x-2"
                  >
                    {clearingCache ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>清理中...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        <span>清理缓存</span>
                      </>
                    )}
                  </button>
                </div>

                {/* 刷新页面 */}
                <div className="py-4">
                  <label className="block text-sm font-medium text-gray-700">
                    刷新页面
                  </label>
                  <p className="mt-1 text-sm text-gray-500 mb-4">
                    重新加载当前页面，获取最新的页面代码。建议先清理缓存再刷新
                  </p>
                  <button
                    onClick={handleReloadPage}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-all duration-200 flex items-center space-x-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>刷新页面</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 管理员密码设置 */}
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-6">管理员密码</h2>
              <div className="py-4">
                <label className="block text-sm font-medium text-gray-700">
                  修改管理员密码
                </label>
                <p className="mt-1 text-sm text-gray-500 mb-4">
                  用于访问底部菜单栏的管理员功能，当前密码用于登录验证
                </p>
                <button
                  onClick={() => setShowPasswordDialog(true)}
                  className="px-6 py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-black transition-all duration-200 flex items-center space-x-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/>
                  </svg>
                  <span>修改密码</span>
                </button>
              </div>
            </div>

            {/* IAMS上报设置 */}
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-6">IAMS上报设置</h2>

              <div className="space-y-6">
                {/* 设备ID */}
                <div className="py-4 border-b">
                  <label className="block text-sm font-medium text-gray-700">
                    认证终端设备ID
                  </label>
                  <p className="mt-1 text-sm text-gray-500 mb-2">
                    用于向IAMS平台上报通行记录的设备标识
                  </p>
                  <input
                    type="text"
                    value={settings.deviceId}
                    onChange={(e) => handleTextChange('deviceId', e.target.value)}
                    placeholder="nuoyadev1"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* 通行记录最大条数 */}
                <div className="flex items-center justify-between py-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      通行记录最大保存条数
                    </label>
                    <p className="mt-1 text-sm text-gray-500">
                      超过此数量将自动删除最旧的记录
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="100"
                      max="10000"
                      value={settings.maxPassLogs}
                      onChange={(e) => handleNumberChange('maxPassLogs', e.target.value)}
                      className="w-28 px-3 py-2 border border-gray-300 rounded-md text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-gray-500">条</span>
                  </div>
                </div>
              </div>
            </div>

            {/* MQTT连接设置 */}
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-6">MQTT连接设置</h2>

              <div className="space-y-6">
                {/* MQTT Broker地址 */}
                <div className="py-4 border-b">
                  <label className="block text-sm font-medium text-gray-700">
                    MQTT Broker地址
                  </label>
                  <p className="mt-1 text-sm text-gray-500 mb-2">
                    IAMS平台的MQTT服务器地址，用于接收凭证下发和上报通行记录
                  </p>
                  <input
                    type="text"
                    value={settings.mqttBroker}
                    onChange={(e) => handleTextChange('mqttBroker', e.target.value)}
                    placeholder="mqtt://58.33.106.19:3881"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* MQTT用户名 */}
                <div className="py-4 border-b">
                  <label className="block text-sm font-medium text-gray-700">
                    MQTT用户名
                  </label>
                  <p className="mt-1 text-sm text-gray-500 mb-2">
                    连接IAMS MQTT服务器的用户名认证
                  </p>
                  <input
                    type="text"
                    value={settings.mqttUsername}
                    onChange={(e) => handleTextChange('mqttUsername', e.target.value)}
                    placeholder="yq-device"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* MQTT密码 */}
                <div className="py-4">
                  <label className="block text-sm font-medium text-gray-700">
                    MQTT密码
                  </label>
                  <p className="mt-1 text-sm text-gray-500 mb-2">
                    连接IAMS MQTT服务器的密码认证
                  </p>
                  <input
                    type="text"
                    value={settings.mqttPassword}
                    onChange={(e) => handleTextChange('mqttPassword', e.target.value)}
                    placeholder="yqyq123!@#"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* 测试区域 */}
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-6">测试区域</h2>
              <p className="text-sm text-gray-500 mb-4">
                每次添加4条凭证（密码、胁迫码、虹膜、掌纹），auth_type_list = "5,7,8,9"。
                同时同步到虹膜和掌纹设备。
              </p>
              <div className="flex flex-wrap items-center gap-4 mb-4">
                <div className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <span className="text-gray-500">人员编码：</span>
                  <code className="font-mono font-bold text-gray-900">112233</code>
                  <span className="text-gray-400 mx-2">|</span>
                  <span className="text-gray-500">密码：</span>
                  <code className="font-mono font-bold text-gray-900">123456</code>
                  <span className="text-gray-400 mx-2">|</span>
                  <span className="text-gray-500">胁迫码：</span>
                  <code className="font-mono font-bold text-gray-900">123457</code>
                </div>
                <button
                  onClick={async () => {
                    setAddComboLoading(true);
                    setBatchResult(null);
                    try {
                      const res = await fetch('/api/test/credentials-batch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mode: 'add-combo' }),
                      });
                      const data = await res.json();
                      setBatchResult(data);
                    } catch (e) {
                      setBatchResult({ success: false, message: (e as Error).message });
                    } finally {
                      setAddComboLoading(false);
                    }
                  }}
                  disabled={addComboLoading}
                  className={`px-5 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                    addComboLoading ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                  }`}
                >
                  {addComboLoading ? '添加中...' : '模拟添加凭证（组合认证）'}
                </button>
                <button
                  onClick={async () => {
                    setAddSingleLoading(true);
                    setBatchResult(null);
                    try {
                      const res = await fetch('/api/test/credentials-batch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mode: 'add-single' }),
                      });
                      const data = await res.json();
                      setBatchResult(data);
                    } catch (e) {
                      setBatchResult({ success: false, message: (e as Error).message });
                    } finally {
                      setAddSingleLoading(false);
                    }
                  }}
                  disabled={addSingleLoading}
                  className={`px-5 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                    addSingleLoading ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700 shadow-sm'
                  }`}
                >
                  {addSingleLoading ? '添加中...' : '模拟添加凭证（单独认证）'}
                </button>
                <button
                  onClick={async () => {
                    setDeleteLoading(true);
                    setBatchResult(null);
                    try {
                      const res = await fetch('/api/test/credentials-batch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mode: 'delete' }),
                      });
                      const data = await res.json();
                      setBatchResult(data);
                    } catch (e) {
                      setBatchResult({ success: false, message: (e as Error).message });
                    } finally {
                      setDeleteLoading(false);
                    }
                  }}
                  disabled={deleteLoading}
                  className={`px-5 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                    deleteLoading ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-700 shadow-sm'
                  }`}
                >
                  {deleteLoading ? '删除中...' : '模拟删除所有凭证'}
                </button>
              </div>

              {/* 执行结果 */}
              {batchResult && (
                <div className={`rounded-lg text-sm ${batchResult.success ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                  <div className="p-3">
                    <div className="font-bold">{batchResult.success ? '✅ 成功' : '❌ 失败'}</div>
                    <div>{batchResult.message || ''}</div>
                    {batchResult.data && (
                      <pre className="mt-2 text-xs bg-white p-2 rounded overflow-x-auto max-h-40">
                        {JSON.stringify(batchResult.data, null, 2)}
                      </pre>
                    )}
                  </div>
                  {batchResult.logs && batchResult.logs.length > 0 && (
                    <div className="border-t border-green-200 bg-white rounded-b-lg">
                      <div className="px-3 py-2 text-xs font-bold text-gray-500">执行日志：</div>
                      <pre className="px-3 pb-3 text-xs bg-gray-900 text-green-300 rounded-b-lg overflow-x-auto max-h-60 whitespace-pre-wrap">
                        {batchResult.logs.join('\n')}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 提示信息 */}
            <div className="bg-amber-50 p-4 rounded-md">
              <p className="text-sm text-amber-700">
                ⚠️ 设备地址修改后立即生效；MQTT配置保存后需要重启应用才能生效
              </p>
            </div>

            {/* 保存按钮 */}
            <div className="flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-black disabled:bg-gray-400 disabled:cursor-not-allowed transition-all duration-200"
              >
                {saving ? '保存中...' : '保存设置'}
              </button>
            </div>
          </div>
        )}
      </main>

      {/* 客户端配置对话框 */}
      {showClientConfigDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-4">修改客户端配置</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                后端服务器地址
              </label>
              <input
                type="text"
                value={clientConfig.serverUrl}
                onChange={(e) => setClientConfig({ serverUrl: e.target.value })}
                placeholder="http://localhost:3001"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg"
              />
              <p className="mt-2 text-xs text-gray-500">
                一体化部署使用 localhost:3001，分离部署使用实际服务器IP
              </p>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-amber-800">
                ⚠️ 保存后客户端将自动重启以应用新配置
              </p>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={() => setShowClientConfigDialog(false)}
                className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-all"
              >
                取消
              </button>
              <button
                onClick={handleSaveClientConfig}
                className="flex-1 px-4 py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-black transition-all"
              >
                保存并重启
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 修改管理员密码对话框 */}
      {showPasswordDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => { setShowPasswordDialog(false); setNewPassword(''); setConfirmPassword(''); setPasswordChangeError(''); setPasswordFocusField(null); }}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-4 text-center">修改管理员密码</h3>

            {/* 新密码显示 */}
            <div
              onClick={() => setPasswordFocusField('new')}
              className={`mb-3 cursor-pointer rounded-lg border-2 px-4 py-3 text-lg text-center transition-colors
                ${passwordFocusField === 'new' ? 'border-gray-900 bg-white' : 'border-gray-200 bg-gray-50'}`}
            >
              <span className="text-xs text-gray-400 block mb-1">新密码</span>
              <span className="text-2xl tracking-[0.5em] text-gray-900">
                {'●'.repeat(newPassword.length)}
              </span>
              {newPassword.length === 0 && (
                <span className="text-gray-400 text-sm"> 点击输入</span>
              )}
            </div>

            {/* 确认密码显示 */}
            <div
              onClick={() => setPasswordFocusField('confirm')}
              className={`mb-3 cursor-pointer rounded-lg border-2 px-4 py-3 text-lg text-center transition-colors
                ${passwordFocusField === 'confirm' ? 'border-gray-900 bg-white' : 'border-gray-200 bg-gray-50'}`}
            >
              <span className="text-xs text-gray-400 block mb-1">确认密码</span>
              <span className="text-2xl tracking-[0.5em] text-gray-900">
                {'●'.repeat(confirmPassword.length)}
              </span>
              {confirmPassword.length === 0 && (
                <span className="text-gray-400 text-sm"> 点击输入</span>
              )}
            </div>

            {passwordChangeError && (
              <p className="text-sm text-red-600 mb-3 text-center">{passwordChangeError}</p>
            )}

            {/* 数字键盘 */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((key, i) => (
                key === '' ? (
                  <div key={i} />
                ) : (
                  <button
                    key={i}
                    onClick={() => {
                      if (!passwordFocusField) return;
                      if (key === '⌫') {
                        if (passwordFocusField === 'new') {
                          setNewPassword(prev => prev.slice(0, -1));
                        } else {
                          setConfirmPassword(prev => prev.slice(0, -1));
                        }
                      } else {
                        if (passwordFocusField === 'new') {
                          setNewPassword(prev => prev + key);
                        } else {
                          setConfirmPassword(prev => prev + key);
                        }
                      }
                      setPasswordChangeError('');
                    }}
                    className={`h-11 rounded-xl font-bold text-lg transition-all active:scale-95
                      ${key === '⌫'
                        ? 'bg-red-100 text-red-600 hover:bg-red-200'
                        : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}`}
                  >
                    {key}
                  </button>
                )
              ))}
            </div>

            <div className="flex space-x-3">
              <button
                onClick={() => { setShowPasswordDialog(false); setNewPassword(''); setConfirmPassword(''); setPasswordChangeError(''); setPasswordFocusField(null); }}
                className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-all"
              >
                取消
              </button>
              <button
                onClick={handleChangePassword}
                disabled={changingPassword}
                className="flex-1 px-4 py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-black disabled:bg-gray-400 disabled:cursor-not-allowed transition-all"
              >
                {changingPassword ? '修改中...' : '确认修改'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
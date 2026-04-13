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
}

interface ClientConfig {
  serverUrl: string;
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
  });
  const [clientConfig, setClientConfig] = useState<ClientConfig>({
    serverUrl: 'http://localhost:3001',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showClientConfigDialog, setShowClientConfigDialog] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

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
              <h1 className="text-2xl font-bold text-gray-900">系统设置</h1>
            </div>
            <nav className="flex space-x-4">
              <a href="/dashboard/devices" className="text-gray-600 hover:text-gray-900">设备管理</a>
              <a href="/dashboard/credentials" className="text-gray-600 hover:text-gray-900">凭证管理</a>
              <a href="/dashboard/mqtt-events" className="text-gray-600 hover:text-gray-900">MQTT指令</a>
              <a href="/dashboard/pass-logs" className="text-gray-600 hover:text-gray-900">通行记录</a>
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

            {/* 提示信息 */}
            <div className="bg-amber-50 p-4 rounded-md">
              <p className="text-sm text-amber-700">
                ⚠️ MQTT配置保存后需要重启应用才能生效
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
    </div>
  );
}
// 虹膜认证页面 - 通过后端代理轮询设备
'use client';

import { useState, useEffect, useRef, Suspense, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Footer from '@/components/kiosk/Footer';
import IdleTimer from '@/components/kiosk/IdleTimer';

interface UserInfo {
  personName: string;
  boxList: string;
  credentialId: number;
}

function IrisContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const identityId = searchParams.get('identityId') || '';
  const [status, setStatus] = useState<'waiting' | 'scanning' | 'success' | 'timeout'>('waiting');
  const [countdown, setCountdown] = useState(60);
  const [message, setMessage] = useState('请注视虹膜摄像头');
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [mismatchHint, setMismatchHint] = useState(false);
  const pollingRef = useRef(true);

  const POLL_INTERVAL = 3000; // 3秒

  const stopPolling = useCallback(() => {
    pollingRef.current = false;
  }, []);

  // 获取用户信息
  const fetchUserInfo = useCallback(async () => {
    try {
      const response = await fetch(`/api/credentials?personId=${encodeURIComponent(identityId)}`);
      const data = await response.json();
      if (data.success && data.credentials && data.credentials.length > 0) {
        const cred = data.credentials[0];
        setUserInfo({
          personName: cred.person_name || '',
          boxList: cred.box_list || '',
          credentialId: cred.credential_id,
        });
      }
    } catch (err) {
      console.error('获取用户信息失败:', err);
    }
  }, [identityId]);

  // 获取设备设置
  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/settings');
      const data = await response.json();
      if (data.success) {
        setCountdown(data.settings.authTimeout);
      }
    } catch (err) {
      console.error('获取设置失败:', err);
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  const startPolling = useCallback(async () => {
    console.log('[虹膜] 开始轮询');
    pollingRef.current = true;

    const startTime = Date.now();
    const timeoutMs = countdown * 1000;
    let lastCreateTime = 0; // 使用 lastCreateTime 来只查询新记录

    // 等待1秒后开始查询
    await new Promise(resolve => setTimeout(resolve, 1000));

    while (pollingRef.current && Date.now() - startTime < timeoutMs) {
      if (!pollingRef.current) break;

      try {
        // 通过后端代理查询虹膜设备
        // 使用 lastCreateTime 参数，只查询比上次更新的记录
        const response = await fetch('/api/device/iris/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startTime: Date.now() - 3000, // 3秒的时间窗口
            endTime: Date.now(),
            count: 10,
            lastCreateTime: lastCreateTime, // 关键：只返回比这个时间更新的记录
          }),
        });

        const result = await response.json();
        console.log('[虹膜] 查询结果:', result.success, 'lastCreateTime:', lastCreateTime);

        if (result.success && result.data) {
          const data = result.data;
          if (data.errorCode === 0 && data.body && data.body.length > 0) {
            console.log('[虹膜] 收到记录:', data.body.length, '条');

            // 更新 lastCreateTime 为最后一条记录的时间
            // 记录按时间排序，最后一条是最新的
            const lastRecord = data.body[data.body.length - 1];
            if (lastRecord && lastRecord.createTime) {
              lastCreateTime = lastRecord.createTime;
              console.log('[虹膜] 更新 lastCreateTime:', lastCreateTime);
            }

            // 检查是否有匹配的识别记录
            let foundOther = false;
            for (const record of data.body) {
              console.log('[虹膜] 记录:', record.staffNum, 'success:', record.success, 'type:', record.type);
              // 匹配条件：staffNum = identityId, success = true, type = 1（虹膜）
              if (record.success && record.type === 1) {
                if (record.staffNum === identityId) {
                  console.log('[虹膜] 识别到用户:', identityId);
                  setStatus('success');
                  setMessage('认证成功');
                  setMismatchHint(false);
                  stopPolling();

                  // 上传通行记录到IAMS
                  try {
                    const uploadResponse = await fetch('/api/pass-log/upload', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        personId: identityId,
                        credentialId: userInfo?.credentialId || 0,
                        authTypes: ['iris'],
                      }),
                    });
                    const uploadResult = await uploadResponse.json();
                    if (!uploadResult.success) {
                      console.log('[虹膜] 上传通行记录失败:', uploadResult.message);
                      // TODO: 可以在成功页显示提示
                    }
                  } catch (err) {
                    console.error('[虹膜] 上传通行记录异常:', err);
                  }

                  // 跳转到成功页面
                  setTimeout(() => {
                    const params = new URLSearchParams({
                      result: 'success',
                      name: userInfo?.personName || '',
                      boxes: userInfo?.boxList || '',
                    });
                    router.push(`/kiosk/success?${params.toString()}`);
                  }, 1500);
                  return;
                } else {
                  // 识别到其他人
                  foundOther = true;
                  console.log('[虹膜] 识别到其他人:', record.staffNum);
                }
              }
            }
            if (foundOther) {
              setMismatchHint(true);
              setTimeout(() => setMismatchHint(false), 3000);
            }
          } else if (data.errorCode === 0) {
            console.log('[虹膜] 无新记录');
          } else {
            console.log('[虹膜] 设备返回错误:', data.errorCode);
          }
        }

      } catch (error: any) {
        console.log('[虹膜] 查询失败:', error.message);
      }

      // 等待轮询间隔
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }

    // 超时
    if (pollingRef.current) {
      setStatus('timeout');
      setMessage('验证超时，请重试');
    }
  }, [identityId, router, stopPolling, countdown, userInfo]);

  useEffect(() => {
    // 先加载设置
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (!settingsLoaded) return;

    if (status === 'waiting') {
      const timer = setTimeout(() => {
        setStatus('scanning');
        setMessage('正在扫描...');
        // 预先获取用户信息
        fetchUserInfo();
      }, 1500);
      return () => clearTimeout(timer);
    } else if (status === 'scanning') {
      startPolling();
      return () => stopPolling();
    }
  }, [status, startPolling, stopPolling, fetchUserInfo, settingsLoaded, countdown]);

  // 倒计时
  useEffect(() => {
    if (status !== 'scanning') return;

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          stopPolling();
          setStatus('timeout');
          setMessage('验证超时');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [status, stopPolling]);

  const handleRetry = () => {
    stopPolling();
    setStatus('waiting');
    setMessage('请注视虹膜摄像头');
    setCountdown(60);
  };

  const handleBack = () => {
    stopPolling();
    router.push(`/kiosk/select?identityId=${encodeURIComponent(identityId)}`);
  };

  return (
    <main className="min-h-screen gradient-subtle flex flex-col">
      {/* 顶部导航区 */}
      <header className="w-full py-4 px-8 bg-white/50 backdrop-blur-sm border-b border-gray-200">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
              </svg>
            </div>
            <h1 className="text-2xl font-black text-gray-900" style={{ fontFamily: 'Satoshi, sans-serif' }}>
              诺亚保管库
            </h1>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">© 2026 诺亚 · 安全可靠</p>
          </div>
        </div>
      </header>

      {/* 主内容区 */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          {/* 主卡片 */}
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-10 md:p-12">
            {/* 倒计时 */}
            <div className="mb-6">
              <IdleTimer />
            </div>

            {/* 标题 */}
            <h2 className="text-2xl md:text-3xl font-black text-gray-900 text-center mb-6"
                style={{ fontFamily: 'Satoshi, sans-serif' }}>
              虹膜认证
            </h2>

            {/* 虹膜图标/动画 */}
            <div className="w-32 h-32 mx-auto mb-8 relative">
              <div className={`absolute inset-0 border-4 border-gray-200 rounded-full
                            ${status === 'scanning' ? 'animate-spin' : ''}`}
                   style={{ animationDuration: '3s' }}>
              </div>
              <div className={`absolute inset-2 border-4 border-gray-300 rounded-full
                            ${status === 'scanning' ? 'animate-spin' : ''}`}
                   style={{ animationDirection: 'reverse', animationDuration: '2s' }}>
              </div>
              <div className="absolute inset-4 bg-gradient-to-br from-gray-50 to-gray-100 rounded-full flex items-center justify-center">
                <svg className="w-12 h-12 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                </svg>
              </div>
              {status === 'scanning' && (
                <div className="absolute inset-0 border-t-2 border-blue-500 rounded-full animate-ping"></div>
              )}
              {status === 'success' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg className="w-16 h-16 text-green-500 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/>
                  </svg>
                </div>
              )}
              {status === 'timeout' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg className="w-16 h-16 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                </div>
              )}
            </div>

            {/* 状态文字 */}
            <div className="text-center mb-4">
              {status === 'waiting' && (
                <p className="text-gray-600 text-base">{message}</p>
              )}
              {status === 'scanning' && (
                <p className="text-blue-600 text-base font-bold animate-pulse">{message} ({countdown}秒)</p>
              )}
              {status === 'success' && (
                <p className="text-green-600 text-base font-bold">{message}</p>
              )}
              {status === 'timeout' && (
                <p className="text-red-600 text-base font-bold">{message}</p>
              )}
            </div>

            {/* 提示信息 */}
            <div className="bg-gray-50 rounded-xl p-4 mb-6">
              <p className="text-sm text-gray-600 text-center">
                {status === 'waiting' && '请保持眼睛与摄像头平视，不要眨眼'}
                {status === 'scanning' && '扫描中，请保持头部稳定'}
                {status === 'success' && '正在跳转...'}
                {status === 'timeout' && '验证超时，请重试'}
              </p>
              {mismatchHint && (
                <p className="text-sm text-yellow-600 text-center mt-2 animate-pulse">
                  识别到其他人，请等待您本人识别
                </p>
              )}
            </div>

            {/* 按钮 */}
            <div className="flex space-x-4">
              <button
                onClick={handleBack}
                className="flex-1 px-4 py-4 bg-gray-100 text-gray-900 rounded-xl font-bold text-base
                         hover:bg-gray-200 transition-all active:scale-95 transform"
              >
                返回
              </button>
              <button
                onClick={handleRetry}
                disabled={status === 'scanning'}
                className="flex-1 px-4 py-4 bg-gray-900 text-white rounded-xl font-bold text-base
                         hover:bg-black transition-all disabled:opacity-50 active:scale-95 transform"
              >
                重试
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* 底部状态栏 */}
      <Footer />
    </main>
  );
}

export default function IrisPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen gradient-subtle flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">加载中...</p>
        </div>
      </main>
    }>
      <IrisContent />
    </Suspense>
  );
}
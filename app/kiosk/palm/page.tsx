// 掌纹认证页面 - 通过后端代理轮询设备
'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Footer from '@/components/kiosk/Footer';
import IdleTimer from '@/components/kiosk/IdleTimer';

interface VerifyResult {
  match: boolean;
  personName?: string;
  boxList?: string;
  credentialId?: number;
}

function PalmContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const identityId = searchParams.get('identityId') || '';
  const [status, setStatus] = useState<'waiting' | 'scanning' | 'success' | 'timeout'>('waiting');
  const [countdown, setCountdown] = useState(60);
  const [message, setMessage] = useState('请将手掌放置于扫描仪');
  const [userInfo, setUserInfo] = useState<VerifyResult | null>(null);
  const [mismatchHint, setMismatchHint] = useState(false);
  const pollingRef = useRef(true);

  const POLL_INTERVAL = 2000; // 2秒

  // 发送指令到掌纹设备（通过后端代理）
  const sendPalmCommand = async (requestCode: string) => {
    try {
      const response = await fetch('/api/device/palm/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: requestCode }),
      });
      const result = await response.json();
      console.log(`[掌纹] 发送指令 ${requestCode}:`, result.data);
      return result;
    } catch (error: any) {
      console.log(`[掌纹] 发送指令 ${requestCode} 失败:`, error.message);
      return null;
    }
  };

  const stopPolling = useCallback(() => {
    pollingRef.current = false;
  }, []);

  // 获取设置
  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/settings');
      const data = await response.json();
      if (data.success) {
        setCountdown(data.settings.authTimeout);
      }
    } catch (err) {
      console.error('[掌纹] 获取设置失败:', err);
    }
  }, []);

  const startPolling = useCallback(async () => {
    console.log('[掌纹] 开始轮询，发送开始识别指令103');
    pollingRef.current = true;

    // 先发送开始识别指令
    await sendPalmCommand('103');

    const startTime = Date.now();
    const timeoutMs = countdown * 1000;

    while (pollingRef.current && Date.now() - startTime < timeoutMs) {
      if (!pollingRef.current) break;

      try {
        // 查询掌纹设备状态
        const result = await sendPalmCommand('103');

        if (result && result.success && result.data) {
          const data = result.data;
          const code = String(data.code);

          if (code === '200') {
            // 识别成功，暂停轮询
            console.log('[掌纹] 识别成功，暂停轮询');
            const userId = data.des;
            console.log('[掌纹] 识别到用户:', userId);

            // 发送停止指令
            await sendPalmCommand('102');

            // 验证是否匹配当前用户
            const verifyResponse = await fetch(`/api/auth/verify-palm?userId=${encodeURIComponent(userId)}&identityId=${encodeURIComponent(identityId)}`);
            const verifyData = await verifyResponse.json();

            if (verifyData.success && verifyData.match) {
              // 匹配成功
              setUserInfo(verifyData);
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
                    credentialId: verifyData.credentialId || 0,
                    authTypes: ['palm'],
                  }),
                });
                const uploadResult = await uploadResponse.json();
                if (!uploadResult.success) {
                  console.log('[掌纹] 上传通行记录失败:', uploadResult.message);
                }
              } catch (err) {
                console.error('[掌纹] 上传通行记录异常:', err);
              }

              setTimeout(() => {
                const params = new URLSearchParams({
                  result: 'success',
                  name: verifyData.personName || '',
                  boxes: verifyData.boxList || '',
                });
                router.push(`/kiosk/success?${params.toString()}`);
              }, 1500);
              return;
            } else {
              // 不匹配，显示提示并发送开始识别指令，继续轮询
              console.log('[掌纹] 识别到其他用户:', userId, '，重新开始识别');
              setMismatchHint(true);
              setTimeout(() => setMismatchHint(false), 3000);
              await sendPalmCommand('103');
            }
          } else if (code === '100') {
            // 未识别状态，继续轮询
            console.log('[掌纹] 未识别状态，继续轮询');
          } else if (code === '404') {
            // 识别失败，继续轮询
            console.log('[掌纹] 识别失败，继续轮询');
          }
        }

      } catch (error: any) {
        console.log('[掌纹] 查询失败:', error.message);
      }

      // 等待轮询间隔
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }

    // 超时，发送停止指令
    if (pollingRef.current) {
      console.log('[掌纹] 超时，发送停止指令102');
      await sendPalmCommand('102');
      setStatus('timeout');
      setMessage('验证超时，请重试');
    }
  }, [identityId, router, stopPolling, countdown]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (status === 'waiting') {
      const timer = setTimeout(() => {
        setStatus('scanning');
        setMessage('正在扫描...');
      }, 1500);
      return () => clearTimeout(timer);
    } else if (status === 'scanning') {
      startPolling();
      return () => stopPolling();
    }
  }, [status, startPolling, stopPolling]);

  // 倒计时
  useEffect(() => {
    if (status !== 'scanning') return;

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          stopPolling();
          sendPalmCommand('102'); // 发送停止指令
          setStatus('timeout');
          setMessage('验证超时');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [status, stopPolling]);

  const handleRetry = async () => {
    // 发送停止指令
    await sendPalmCommand('102');
    stopPolling();
    setStatus('waiting');
    setMessage('请将手掌放置于扫描仪');
    setCountdown(60);
  };

  const handleBack = async () => {
    // 发送停止指令
    await sendPalmCommand('102');
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
              掌纹认证
            </h2>

            {/* 掌纹图标/动画 */}
            <div className="w-32 h-32 mx-auto mb-8 relative">
              <div className={`absolute inset-0 border-4 border-gray-200 rounded-3xl
                            ${status === 'scanning' ? 'animate-pulse' : ''}`}>
              </div>
              <div className="absolute inset-4 bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl
                            flex items-center justify-center">
                <svg className="w-16 h-16 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11"/>
                </svg>
              </div>
              {status === 'scanning' && (
                <div className="absolute inset-4 border-t-2 border-blue-500 rounded-2xl animate-ping"></div>
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
                {status === 'waiting' && '请手掌平放，手指自然张开'}
                {status === 'scanning' && '扫描中，请保持手掌稳定'}
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

export default function PalmPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen gradient-subtle flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">加载中...</p>
        </div>
      </main>
    }>
      <PalmContent />
    </Suspense>
  );
}
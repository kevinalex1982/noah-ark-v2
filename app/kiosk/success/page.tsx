// 认证成功页面 - 带倒计时，返回待机页
'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, Suspense } from 'react';
import Footer from '@/components/kiosk/Footer';

function SuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const result = searchParams.get('result') || 'success';
  const personName = searchParams.get('name') || '';
  const boxList = searchParams.get('boxes') || '';
  const [countdown, setCountdown] = useState(10);
  const [shouldRedirect, setShouldRedirect] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // 获取系统设置的超时时间
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch('/api/settings');
        const data = await response.json();
        if (data.success) {
          setCountdown(data.settings.successReturnTime);
        }
      } catch (error) {
        console.error('获取设置失败:', error);
      } finally {
        setSettingsLoaded(true);
      }
    };
    fetchSettings();
  }, []);

  // 使用 useCallback 避免在渲染时更新状态
  const handleRedirect = useCallback(() => {
    router.push('/kiosk');  // 返回待机页
  }, [router]);

  useEffect(() => {
    if (!settingsLoaded) return;

    if (countdown > 0 && !shouldRedirect) {
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            setShouldRedirect(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [countdown, shouldRedirect, settingsLoaded]);

  // 单独的 useEffect 处理跳转
  useEffect(() => {
    if (shouldRedirect) {
      handleRedirect();
    }
  }, [shouldRedirect, handleRedirect]);

  const isSuccess = result === 'success';
  const isDuress = result === 'duress';

  return (
    <main className={`min-h-screen gradient-subtle flex flex-col ${
      isSuccess
        ? ''
        : ''
    }`}>
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
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-10 md:p-12 text-center">
            {/* 图标 */}
            <div className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center
                          bg-gradient-to-br from-green-100 to-green-200">
              {isSuccess ? (
                <svg className="w-12 h-12 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/>
                </svg>
              ) : (
                <svg className="w-12 h-12 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                </svg>
              )}
            </div>

            {/* 标题 */}
            <h2 className="text-3xl font-black text-gray-900 mb-3" style={{ fontFamily: 'Satoshi, sans-serif' }}>
              {isSuccess || isDuress ? '认证成功' : '认证失败'}
            </h2>

            {/* 副标题 */}
            <p className="text-gray-600 mb-8 text-lg">
              {isDuress
                ? '系统已记录本次认证'
                : isSuccess
                  ? '身份验证已通过，祝您使用愉快'
                  : '请重新尝试'}
            </p>

            {/* 倒计时 */}
            {settingsLoaded && countdown > 0 && (
              <p className="text-sm text-gray-400 mb-6">
                {countdown} 秒后返回待机页
              </p>
            )}

            {/* 按钮 */}
            <button
              onClick={handleRedirect}
              className="px-8 py-3 bg-gray-900 text-white rounded-xl font-bold text-base
                       hover:bg-black transition-all active:scale-95 transform"
            >
              返回待机
            </button>
          </div>
        </div>
      </main>

      {/* 底部状态栏 */}
      <Footer />
    </main>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen gradient-subtle flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">加载中...</p>
        </div>
      </main>
    }>
      <SuccessContent />
    </Suspense>
  );
}

// 选择认证方式页面 - 根据 authModel 决定显示逻辑
'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useState, useEffect, useCallback, Suspense } from 'react';
import Footer from '@/components/kiosk/Footer';
import IdleTimer from '@/components/kiosk/IdleTimer';

function SelectContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const identityId = searchParams.get('identityId') || '';

  const [authTypes, setAuthTypes] = useState<number[]>([]);
  const [authTypeList, setAuthTypeList] = useState<number[]>([]);
  const [authModel, setAuthModel] = useState<number | null>(null);
  const [personName, setPersonName] = useState('');
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const resetCountdown = useCallback(() => {}, []);

  useEffect(() => {
    const fetchAuthTypes = async () => {
      try {
        const response = await fetch(`/api/auth/types?identityId=${encodeURIComponent(identityId)}`);
        const data = await response.json();

        if (data.success && data.data) {
          setAuthTypes(data.data.authTypes || []);
          setAuthTypeList(data.data.authTypeList || []);
          setAuthModel(data.data.authModel ?? null);
          setPersonName(data.data.personName || '');
        } else {
          setAuthModel(null);
        }
      } catch (error) {
        console.error('获取认证方式失败:', error);
        setAuthModel(null);
      } finally {
        setLoading(false);
      }
    };

    if (identityId) {
      fetchAuthTypes();
    } else {
      setLoading(false);
    }
  }, [identityId]);

  // 组合认证模式：自动跳转到组合认证页
  useEffect(() => {
    if (!loading && authModel === 2 && authTypes.length > 0) {
      setRedirecting(true);
      router.push(`/kiosk/combined?identityId=${encodeURIComponent(identityId)}`);
    }
  }, [loading, authModel, authTypes, identityId, router]);

  // 无有效认证类型时的提示
  if (!loading && authTypes.length === 0) {
    if (authModel === null || (authModel !== 1 && authModel !== 2)) {
      // authModel 未配置或无效
      return (
        <main className="min-h-screen gradient-subtle flex flex-col">
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
            </div>
          </header>
          <main className="flex-1 flex items-center justify-center p-6">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-10 text-center">
              <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">未配置认证模式</h2>
              <p className="text-gray-600 mb-6">请联系管理员配置认证方式</p>
              <a href="/kiosk" className="text-gray-500 hover:text-gray-900 text-sm font-medium transition-colors">
                ← 返回首页
              </a>
            </div>
          </main>
          <Footer />
        </main>
      );
    }

    return (
      <main className="min-h-screen gradient-subtle flex flex-col">
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
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-10 text-center">
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">无可用认证方式</h2>
            <p className="text-gray-600 mb-6">该用户没有配置有效的认证凭证</p>
            <a href="/kiosk" className="text-gray-500 hover:text-gray-900 text-sm font-medium transition-colors">
              ← 返回首页
            </a>
          </div>
        </main>
        <Footer />
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen gradient-subtle flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">加载中...</p>
        </div>
      </main>
    );
  }

  // === 组合认证模式：显示加载中（useEffect 会自动跳转） ===
  if (authModel === 2) {
    return (
      <main className="min-h-screen gradient-subtle flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">进入组合认证...</p>
        </div>
      </main>
    );
  }

  // === 单独认证模式：显示独立认证按钮 ===
  const hasPassword = authTypes.includes(5);
  const hasIris = authTypes.includes(7);
  const hasPalm = authTypes.includes(8);
  const totalAuth = authTypes.filter(t => t !== 9).length; // 排除胁迫码，只计算显示的

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
        <div className="w-full max-w-4xl">
          {/* 主卡片 */}
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-12 md:p-16">
            {/* 倒计时 */}
            <div className="mb-8">
              <IdleTimer />
            </div>

            {/* 标题 */}
            <h2 className="text-4xl md:text-5xl font-black text-gray-900 text-center mb-4"
                style={{ fontFamily: 'Satoshi, sans-serif', letterSpacing: '-1px' }}>
              选择认证方式
            </h2>

            {/* 副标题 */}
            <p className="text-gray-600 text-center text-xl mb-12 leading-relaxed">
              请选择一种认证方式完成身份验证
            </p>

            {/* 认证方式网格 */}
            <div className="grid grid-cols-2 gap-6 mb-10 max-w-2xl mx-auto">
              {hasPassword && (
                <a
                  href={`/kiosk/password?identityId=${encodeURIComponent(identityId)}`}
                  onClick={resetCountdown}
                  className={`auth-card rounded-2xl p-6 text-center cursor-pointer block transform transition-all hover:scale-105 ${totalAuth === 1 ? 'col-start-1 col-end-3' : ''}`}
                >
                  <div className="w-20 h-20 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center mx-auto mb-4 animate-fade-in">
                    <svg className="w-10 h-10 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                    </svg>
                  </div>
                  <p className="text-lg font-bold text-gray-900">密码认证</p>
                </a>
              )}

              {hasIris && (
                <a
                  href={`/kiosk/iris?identityId=${encodeURIComponent(identityId)}`}
                  onClick={resetCountdown}
                  className={`auth-card rounded-2xl p-6 text-center cursor-pointer block transform transition-all hover:scale-105 ${totalAuth === 1 ? 'col-start-1 col-end-3' : ''}`}
                >
                  <div className="w-20 h-20 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center mx-auto mb-4 animate-fade-in" style={{ animationDelay: '0.1s' }}>
                    <svg className="w-10 h-10 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                    </svg>
                  </div>
                  <p className="text-lg font-bold text-gray-900">虹膜认证</p>
                </a>
              )}

              {hasPalm && (
                <a
                  href={`/kiosk/palm?identityId=${encodeURIComponent(identityId)}`}
                  onClick={resetCountdown}
                  className={`auth-card rounded-2xl p-6 text-center cursor-pointer block transform transition-all hover:scale-105 ${totalAuth === 1 ? 'col-start-1 col-end-3' : totalAuth === 3 ? 'col-start-2' : ''}`}
                >
                  <div className="w-20 h-20 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center mx-auto mb-4 animate-fade-in" style={{ animationDelay: '0.2s' }}>
                    <svg className="w-10 h-10 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11"/>
                    </svg>
                  </div>
                  <p className="text-lg font-bold text-gray-900">掌纹认证</p>
                </a>
              )}
            </div>

            {/* 返回按钮 */}
            <div className="flex justify-center">
              <a
                href="/kiosk"
                onClick={resetCountdown}
                className="text-gray-500 hover:text-gray-900 text-sm font-medium transition-colors"
              >
                ← 返回上一步
              </a>
            </div>
          </div>
        </div>
      </main>

      {/* 底部状态栏 */}
      <Footer />
    </main>
  );
}

export default function SelectAuthPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen gradient-subtle flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">加载中...</p>
        </div>
      </main>
    }>
      <SelectContent />
    </Suspense>
  );
}

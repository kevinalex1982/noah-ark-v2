// 选择认证方式页面 - 带倒计时
'use client';

import { useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback, Suspense } from 'react';
import Footer from '@/components/kiosk/Footer';
import IdleTimer from '@/components/kiosk/IdleTimer';

function SelectContent() {
  const searchParams = useSearchParams();
  const identityId = searchParams.get('identityId') || '';

  const [authTypes, setAuthTypes] = useState<number[]>([]);
  const [personName, setPersonName] = useState('');
  const [loading, setLoading] = useState(true);
  const resetCountdown = useCallback(() => {}, []);

  useEffect(() => {
    const fetchAuthTypes = async () => {
      try {
        const response = await fetch(`/api/auth/types?identityId=${encodeURIComponent(identityId)}`);
        const data = await response.json();

        if (data.success && data.data.authTypes) {
          // authTypes 已经是有效认证类型（authTypeList ∩ 实际凭证类型，排除胁迫码）
          setAuthTypes(data.data.authTypes);
          setPersonName(data.data.personName || '');
        } else {
          // 用户不存在，返回首页
          setAuthTypes([]);
        }
      } catch (error) {
        console.error('获取认证方式失败:', error);
        setAuthTypes([]);
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

  // 无有效认证类型时的提示
  if (!loading && authTypes.length === 0) {
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

  // authTypes 已经是有效认证类型（后端已处理：authTypeList ∩ 实际凭证类型，排除胁迫码）
  const hasPassword = authTypes.includes(5);
  const hasIris = authTypes.includes(7);
  const hasPalm = authTypes.includes(8);
  // 组合认证：有效认证类型数量 >= 2 才显示
  const hasCombined = authTypes.length >= 2;

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
            <div className={`grid ${hasCombined ? 'grid-cols-2' : 'grid-cols-1'} gap-8 mb-12`}>
              {hasPassword && (
                <a
                  href={`/kiosk/password?identityId=${encodeURIComponent(identityId)}`}
                  onClick={resetCountdown}
                  className="auth-card rounded-2xl p-10 text-center cursor-pointer block transform transition-all hover:scale-105"
                >
                  <div className="w-24 h-24 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center mx-auto mb-6 animate-fade-in">
                    <svg className="w-12 h-12 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                    </svg>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">密码认证</p>
                </a>
              )}

              {hasIris && (
                <a
                  href={`/kiosk/iris?identityId=${encodeURIComponent(identityId)}`}
                  onClick={resetCountdown}
                  className="auth-card rounded-2xl p-10 text-center cursor-pointer block transform transition-all hover:scale-105"
                >
                  <div className="w-24 h-24 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center mx-auto mb-6 animate-fade-in" style={{ animationDelay: '0.1s' }}>
                    <svg className="w-12 h-12 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                    </svg>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">虹膜认证</p>
                </a>
              )}

              {hasPalm && (
                <a
                  href={`/kiosk/palm?identityId=${encodeURIComponent(identityId)}`}
                  onClick={resetCountdown}
                  className="auth-card rounded-2xl p-10 text-center cursor-pointer block transform transition-all hover:scale-105"
                >
                  <div className="w-24 h-24 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center mx-auto mb-6 animate-fade-in" style={{ animationDelay: '0.2s' }}>
                    <svg className="w-12 h-12 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11"/>
                    </svg>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">掌纹认证</p>
                </a>
              )}

              {hasCombined && (
                <a
                  href={`/kiosk/combined?identityId=${encodeURIComponent(identityId)}`}
                  onClick={resetCountdown}
                  className="auth-card rounded-2xl p-10 text-center cursor-pointer block transform transition-all hover:scale-105"
                >
                  <div className="w-24 h-24 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center mx-auto mb-6 animate-fade-in" style={{ animationDelay: '0.3s' }}>
                    <svg className="w-12 h-12 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
                    </svg>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">组合认证</p>
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

// 认证终端首页 - 身份确认（带软键盘 + 倒计时）
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Footer from '@/components/kiosk/Footer';
import IdleTimer from '@/components/kiosk/IdleTimer';

export default function KioskPage() {
  const router = useRouter();
  const [identityId, setIdentityId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const resetCountdown = () => {};

  const handleNext = async () => {
    resetCountdown();
    setError('');

    if (!identityId.trim()) {
      setError('请输入身份编码');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`/api/auth/verify-identity?identityId=${encodeURIComponent(identityId)}`);
      const data = await response.json();

      if (data.success) {
        router.push(`/kiosk/select?identityId=${encodeURIComponent(identityId)}`);
      } else {
        setError(data.message || '库中无此用户编码信息');
      }
    } catch (error) {
      console.error('验证用户编码失败:', error);
      setError('验证失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    resetCountdown();
    setIdentityId('');
    setError('');
  };

  const handleNumberClick = (num: string) => {
    resetCountdown();
    if (identityId.length < 32) {
      setIdentityId(identityId + num);
    }
  };

  const handleBackspace = () => {
    resetCountdown();
    setIdentityId(identityId.slice(0, -1));
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
            <h2 className="text-3xl md:text-4xl font-black text-gray-900 text-center mb-3"
                style={{ fontFamily: 'Satoshi, sans-serif', letterSpacing: '-1px' }}>
              身份确认
            </h2>

            {/* 副标题 */}
            <p className="text-gray-600 text-center text-base mb-10 leading-relaxed">
              请输入您的身份编码进行认证
            </p>

            {/* 输入框 */}
            <div className="mb-6">
              <input
                type="text"
                value={identityId}
                readOnly
                className={`w-full px-6 py-4 border-2 rounded-xl text-lg font-medium text-center tracking-widest
                         focus:border-gray-900 focus:outline-none transition-colors
                         ${error ? 'border-red-500' : 'border-gray-200'}`}
                placeholder="请输入身份编码"
                autoFocus
                maxLength={32}
              />
              {error && (
                <p className="text-red-500 text-sm mt-2 text-center font-bold">
                  ⚠️ {error}
                </p>
              )}
              <p className="text-gray-500 text-sm mt-2 text-center">
                已输入 {identityId.length} 位
              </p>
            </div>

            {/* 软键盘 */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                <button
                  key={num}
                  onClick={() => handleNumberClick(num)}
                  className="py-4 text-xl font-bold border-2 border-gray-200 rounded-xl
                           hover:bg-gray-50 transition-all active:scale-95 transform text-gray-900"
                >
                  {num}
                </button>
              ))}
              <button
                onClick={handleClear}
                className="py-4 text-sm font-bold border-2 border-gray-200 rounded-xl
                         hover:bg-gray-50 transition-all active:scale-95 transform text-red-600"
              >
                清空
              </button>
              <button
                onClick={() => handleNumberClick('0')}
                className="py-4 text-xl font-bold border-2 border-gray-200 rounded-xl
                         hover:bg-gray-50 transition-all active:scale-95 transform text-gray-900"
              >
                0
              </button>
              <button
                onClick={handleBackspace}
                className="py-4 text-lg font-bold border-2 border-gray-200 rounded-xl
                         hover:bg-gray-50 transition-all active:scale-95 transform text-gray-900"
              >
                ⬅️
              </button>
            </div>

            {/* 按钮 */}
            <div className="flex space-x-4">
              <button
                onClick={handleClear}
                disabled={loading}
                className="flex-1 px-4 py-4 bg-gray-100 text-gray-900 rounded-xl font-bold text-base
                         hover:bg-gray-200 transition-all disabled:opacity-50 active:scale-95 transform"
              >
                清空
              </button>
              <button
                onClick={handleNext}
                disabled={!identityId || identityId.length === 0 || loading}
                className="flex-1 px-4 py-4 bg-gray-900 text-white rounded-xl font-bold text-base
                         hover:bg-black transition-all disabled:opacity-50 disabled:cursor-not-allowed
                         active:scale-95 transform"
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    验证中...
                  </span>
                ) : (
                  '下一步'
                )}
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

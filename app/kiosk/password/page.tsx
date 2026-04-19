// 密码认证页面 - 真实验证
'use client';

import { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Footer from '@/components/kiosk/Footer';
import IdleTimer from '@/components/kiosk/IdleTimer';

function PasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const identityId = searchParams.get('identityId') || '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const resetCountdown = () => {};

  const handleNumberClick = (num: string) => {
    resetCountdown();
    setError('');
    if (password.length < 10) {
      setPassword(password + num);
    }
  };

  const handleClear = () => {
    resetCountdown();
    setPassword('');
    setError('');
  };

  const handleBackspace = () => {
    resetCountdown();
    setError('');
    setPassword(password.slice(0, -1));
  };

  const handleBack = () => {
    resetCountdown();
    router.push(`/kiosk/select?identityId=${encodeURIComponent(identityId)}`);
  };

  const handleSubmit = async () => {
    if (password.length < 5) {
      setError('密码至少5位');
      return;
    }

    resetCountdown();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identityId, password }),
      });

      const data = await response.json();

      if (data.success) {
        // ⚠️ 胁迫码触发时，告警已在 API 中发送
        // 表面显示成功，不暴露给用户

        // 上传通行记录到IAMS
        try {
          const uploadResponse = await fetch('/api/pass-log/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              personId: identityId,
              credentialId: data.credentialId || 0,
              authTypes: ['password'],  // 胁迫码也显示为密码认证
            }),
          });
          const uploadResult = await uploadResponse.json();
          if (!uploadResult.success) {
            console.log('[密码] 上传通行记录失败:', uploadResult.message);
          }
        } catch (err) {
          console.error('[密码] 上传通行记录异常:', err);
        }

        // 验证成功，传递用户信息到成功页面
        // 胁迫码也显示为成功，不暴露
        const params = new URLSearchParams({
          result: 'success',
          name: data.personName || '',
          boxes: data.boxList || '',
        });
        router.push(`/kiosk/success?${params.toString()}`);
      } else {
        setError(data.message || '密码错误');
      }
    } catch (err) {
      console.error('验证失败:', err);
      setError('验证失败，请重试');
    } finally {
      setLoading(false);
    }
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
              输入密码
            </h2>

            {/* 密码显示框 */}
            <div className="mb-6">
              <input
                type="password"
                value={password}
                readOnly
                className={`w-full px-4 py-3 border-2 rounded-xl text-lg text-center tracking-widest
                           focus:outline-none transition-colors
                           ${error ? 'border-red-500' : 'border-gray-200 focus:border-gray-900'}`}
                placeholder="请输入密码"
              />
              <p className="text-center text-sm text-gray-500 mt-2">
                已输入 {password.length} 位 {password.length >= 5 ? '✓' : `(至少 5 位)`}
              </p>
              {error && (
                <p className="text-center text-sm text-red-500 mt-2 font-medium">
                  ⚠️ {error}
                </p>
              )}
            </div>

            {/* 数字键盘 */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  onClick={() => handleNumberClick(num.toString())}
                  disabled={loading}
                  className="py-4 text-xl font-bold border-2 border-gray-200 rounded-xl
                           hover:bg-gray-50 transition-all active:scale-95 transform text-gray-900
                           disabled:opacity-50"
                >
                  {num}
                </button>
              ))}
              <button
                onClick={handleClear}
                disabled={loading}
                className="py-4 text-sm font-bold border-2 border-gray-200 rounded-xl
                         hover:bg-gray-50 transition-all active:scale-95 transform text-red-600
                         disabled:opacity-50"
              >
                清空
              </button>
              <button
                onClick={() => handleNumberClick('0')}
                disabled={loading}
                className="py-4 text-xl font-bold border-2 border-gray-200 rounded-xl
                         hover:bg-gray-50 transition-all active:scale-95 transform text-gray-900
                         disabled:opacity-50"
              >
                0
              </button>
              <button
                onClick={handleBackspace}
                disabled={loading}
                className="py-4 text-lg font-bold border-2 border-gray-200 rounded-xl
                         hover:bg-gray-50 transition-all active:scale-95 transform text-gray-900
                         disabled:opacity-50"
              >
                ⬅️
              </button>
            </div>

            {/* 按钮 */}
            <div className="flex space-x-4">
              <button
                onClick={handleBack}
                disabled={loading}
                className="flex-1 px-4 py-4 bg-gray-100 text-gray-900 rounded-xl font-bold text-base
                         hover:bg-gray-200 transition-all active:scale-95 transform disabled:opacity-50"
              >
                返回
              </button>
              <button
                onClick={handleSubmit}
                disabled={password.length < 4 || loading}
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
                ) : '确认'}
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

export default function PasswordPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen gradient-subtle flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">加载中...</p>
        </div>
      </main>
    }>
      <PasswordContent />
    </Suspense>
  );
}
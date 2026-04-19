'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

// 管理员子菜单配置
const ADMIN_MENUS = [
  { label: '设备管理', icon: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/>
    </svg>
  ), path: '/dashboard/devices' },
  { label: '凭证管理', icon: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/>
    </svg>
  ), path: '/dashboard/credentials' },
  { label: 'MQTT指令', icon: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
    </svg>
  ), path: '/dashboard/mqtt-events' },
  { label: '通行记录', icon: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
    </svg>
  ), path: '/dashboard/pass-logs' },
  { label: '系统设置', icon: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
    </svg>
  ), path: '/dashboard/settings' },
];

export default function Footer() {
  const router = useRouter();
  const [currentTime, setCurrentTime] = useState('');
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }));
      setCurrentYear(now.getFullYear());
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  // 密码输入框自动聚焦
  useEffect(() => {
    if (showPasswordModal) {
      setAdminPassword('');
      setPasswordError('');
      setTimeout(() => passwordInputRef.current?.focus(), 100);
    }
  }, [showPasswordModal]);

  const handleAdminClick = () => {
    setShowMenu(false);
    setShowPasswordModal(true);
  };

  const handlePasswordSubmit = async () => {
    if (adminPassword.length < 5) {
      setPasswordError('密码至少5位');
      return;
    }

    try {
      const response = await fetch('/api/auth/admin-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword }),
      });
      const data = await response.json();

      if (data.success) {
        setShowPasswordModal(false);
        setShowMenu(true);
      } else {
        setPasswordError(data.message || '密码错误');
      }
    } catch (err) {
      setPasswordError('验证失败，请重试');
    }
  };

  const handleMenuClick = (path: string) => {
    setShowMenu(false);
    router.push(path);
  };

  return (
    <>
      <footer className="w-full py-3 px-8 bg-white/50 backdrop-blur-sm border-t border-gray-200">
        <div className="max-w-5xl mx-auto flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center space-x-4">
            <span className="flex items-center">
              <span className="w-2 h-2 bg-green-500 rounded-full mr-1.5"></span>
              系统正常
            </span>
          </div>
          <div className="flex items-center space-x-4">
            <span>© {currentYear} 诺亚 · 安全可靠</span>
            <span>{currentTime}</span>
            {/* 管理员按钮 */}
            <button
              onClick={handleAdminClick}
              className="flex items-center space-x-1 text-gray-600 hover:text-blue-600 transition-colors ml-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
              </svg>
              <span>管理员</span>
            </button>
          </div>
        </div>
      </footer>

      {/* 管理员菜单弹窗 */}
      {showMenu && (
        <div className="fixed bottom-12 right-8 z-50">
          <div ref={menuRef} className="bg-white rounded-xl shadow-2xl border border-gray-200 py-2 w-44">
            {ADMIN_MENUS.map((item) => (
              <button
                key={item.path}
                onClick={() => handleMenuClick(item.path)}
                className="w-full flex items-center space-x-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 管理员密码输入弹窗 */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowPasswordModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-80" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black text-gray-900 text-center mb-4">管理员验证</h3>

            {/* 密码显示区域 */}
            <div className={`w-full px-4 py-3 border-2 rounded-xl text-lg text-center tracking-widest mb-2 min-h-[52px] flex items-center justify-center
              ${adminPassword.length > 0 && adminPassword.length < 5 ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 bg-gray-50'}`}>
              <span className="text-gray-900 text-2xl tracking-[0.5em]">
                {'●'.repeat(adminPassword.length)}
              </span>
              {adminPassword.length === 0 && (
                <span className="text-gray-400 text-base">请输入密码</span>
              )}
            </div>
            {adminPassword.length > 0 && adminPassword.length < 5 && (
              <p className="text-sm text-yellow-600 text-center mb-2">密码不可少于5位（已输入 {adminPassword.length}/5 位）</p>
            )}
            {passwordError && (
              <p className="text-sm text-red-600 text-center mb-2">{passwordError}</p>
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
                      if (key === '⌫') {
                        setAdminPassword(prev => prev.slice(0, -1));
                      } else {
                        setAdminPassword(prev => prev + key);
                      }
                      setPasswordError('');
                    }}
                    className={`h-12 rounded-xl font-bold text-xl transition-all active:scale-95
                      ${key === '⌫'
                        ? 'bg-red-100 text-red-600 hover:bg-red-200'
                        : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}`}
                  >
                    {key}
                  </button>
                )
              ))}
            </div>

            {/* 取消 / 确认 */}
            <div className="flex space-x-3">
              <button
                onClick={() => setShowPasswordModal(false)}
                className="flex-1 px-4 py-3 bg-gray-100 text-gray-900 rounded-xl font-bold hover:bg-gray-200 transition-all"
              >
                取消
              </button>
              <button
                onClick={handlePasswordSubmit}
                className="flex-1 px-4 py-3 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition-all disabled:opacity-50"
                disabled={adminPassword.length < 1}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

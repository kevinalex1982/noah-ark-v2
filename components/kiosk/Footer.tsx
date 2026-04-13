'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Footer() {
  const router = useRouter();
  const [currentTime, setCurrentTime] = useState('');
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());

  useEffect(() => {
    // 只在客户端更新时间，避免 hydration 错误
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

  const handleDeviceClick = () => {
    router.push('/dashboard/devices');
  };

  const handleCredentialClick = () => {
    router.push('/dashboard/credentials');
  };

  return (
    <footer className="w-full py-3 px-8 bg-white/50 backdrop-blur-sm border-t border-gray-200">
      <div className="max-w-5xl mx-auto flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center space-x-4">
          <span className="flex items-center">
            <span className="w-2 h-2 bg-green-500 rounded-full mr-1.5"></span>
            系统正常
          </span>
          {/* 设备管理 */}
          <button
            onClick={handleDeviceClick}
            className="flex items-center space-x-1 text-gray-600 hover:text-blue-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/>
            </svg>
            <span>设备管理</span>
          </button>
          {/* 凭证管理 */}
          <button
            onClick={handleCredentialClick}
            className="flex items-center space-x-1 text-gray-600 hover:text-blue-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/>
            </svg>
            <span>凭证管理</span>
          </button>
          {/* MQTT指令记录 */}
          <button
            onClick={() => router.push('/dashboard/mqtt-events')}
            className="flex items-center space-x-1 text-gray-600 hover:text-blue-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            <span>MQTT指令</span>
          </button>
          {/* 通行记录 */}
          <button
            onClick={() => router.push('/dashboard/pass-logs')}
            className="flex items-center space-x-1 text-gray-600 hover:text-blue-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <span>通行记录</span>
          </button>
          {/* 系统设置 */}
          <button
            onClick={() => router.push('/dashboard/settings')}
            className="flex items-center space-x-1 text-gray-600 hover:text-blue-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
            <span>系统设置</span>
          </button>
        </div>
        <div className="flex items-center space-x-4">
          <span>© {currentYear} 诺亚 · 安全可靠</span>
          <span>{currentTime}</span>
        </div>
      </div>
    </footer>
  );
}

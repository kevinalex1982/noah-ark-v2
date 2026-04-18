/**
 * 无操作倒计时组件（静默模式）
 * 60 秒无操作自动返回待机页
 * 只在最后 30 秒显示
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const IDLE_TIMEOUT = 60; // 60 秒
const SHOW_COUNTDOWN_AFTER = 30; // 30 秒后显示

interface IdleTimerProps {
  onTimeout?: () => void;
}

export default function IdleTimer({ onTimeout, resetKey }: IdleTimerProps & { resetKey?: string }) {
  const router = useRouter();
  const [countdown, setCountdown] = useState(IDLE_TIMEOUT);
  const [shouldRedirect, setShouldRedirect] = useState(false);

  // 重置倒计时
  const resetCountdown = () => {
    setCountdown(IDLE_TIMEOUT);
  };

  // 当 resetKey 变化时（步骤切换），重置倒计时
  useEffect(() => {
    if (resetKey !== undefined) {
      resetCountdown();
    }
  }, [resetKey]);

  // 监听用户操作
  useEffect(() => {
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    
    const handleUserActivity = () => {
      resetCountdown();
    };

    events.forEach(event => {
      window.addEventListener(event, handleUserActivity);
    });

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleUserActivity);
      });
    };
  }, []);

  // 倒计时逻辑
  useEffect(() => {
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
  }, []);

  // 单独的 useEffect 处理跳转
  useEffect(() => {
    if (shouldRedirect) {
      if (onTimeout) {
        onTimeout();
      } else {
        router.push('/');
      }
    }
  }, [shouldRedirect, onTimeout, router]);

  // 进度条颜色（温和的渐变）
  const getProgressColor = () => {
    if (countdown > 20) return 'bg-blue-500';
    if (countdown > 10) return 'bg-yellow-500';
    return 'bg-orange-500';
  };

  // 只在最后 30 秒显示
  if (countdown > SHOW_COUNTDOWN_AFTER) {
    return null;
  }

  return (
    <div className="w-full max-w-md mx-auto">
      {/* 进度条 */}
      <div className="h-1 bg-gray-200 rounded-full overflow-hidden mb-2">
        <div 
          className={`h-full ${getProgressColor()} transition-all duration-1000 ease-linear`}
          style={{ width: `${((countdown - SHOW_COUNTDOWN_AFTER) / SHOW_COUNTDOWN_AFTER) * 100}%` }}
        ></div>
      </div>
      
      {/* 文字提示 */}
      <p className="text-center text-xs text-gray-500">
        {countdown} 秒后返回待机页
      </p>
    </div>
  );
}

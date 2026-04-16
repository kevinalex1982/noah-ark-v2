// 组合认证页面 - 按 authTypeList 顺序依次认证
// 密码/胁迫码在前（如有），生物识别在后（按 authTypeList 顺序）
'use client';

import { useState, useEffect, useRef, Suspense, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Footer from '@/components/kiosk/Footer';
import IdleTimer from '@/components/kiosk/IdleTimer';

type AuthStep = 'password' | 'iris' | 'palm';

interface UserInfo {
  personName: string;
  boxList: string;
  credentialId?: number;
}

function CombinedContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const identityId = searchParams.get('identityId') || '';

  const [steps, setSteps] = useState<AuthStep[]>([]);
  const [currentStep, setCurrentStep] = useState<AuthStep | null>(null);
  const [completedSteps, setCompletedSteps] = useState<AuthStep[]>([]);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState(60);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // 密码状态
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // 生物识别状态
  const [scanStatus, setScanStatus] = useState<'waiting' | 'scanning' | 'success' | 'error' | 'mismatch'>('waiting');
  const [mismatchHint, setMismatchHint] = useState(false);

  const pollingRef = useRef(true);
  const lastCreateTimeRef = useRef(0);

  const IRIS_POLL_INTERVAL = 3000;
  const PALM_POLL_INTERVAL = 2000;

  // 从 API 获取用户的认证方式和认证步骤
  useEffect(() => {
    const fetchAuthConfig = async () => {
      try {
        const response = await fetch(`/api/auth/types?identityId=${encodeURIComponent(identityId)}`);
        const data = await response.json();

        if (data.success) {
          const authTypeList = data.data.authTypeList || [];
          const hasPasswordType = authTypeList.includes(5) || authTypeList.includes(9);
          const hasIrisType = authTypeList.includes(7);
          const hasPalmType = authTypeList.includes(8);

          // 构建步骤：密码在前（如有5或9），生物识别在后（按 authTypeList 顺序）
          const newSteps: AuthStep[] = [];
          if (hasPasswordType) newSteps.push('password');
          // 按 authTypeList 原始顺序添加生物识别
          for (const type of authTypeList) {
            if (type === 7) newSteps.push('iris');
            else if (type === 8) newSteps.push('palm');
          }

          console.log('[组合认证] authTypeList:', authTypeList);
          console.log('[组合认证] 认证步骤:', newSteps);

          setSteps(newSteps);
          if (newSteps.length > 0) {
            setCurrentStep(newSteps[0]);
          }

          // 获取用户信息
          if (data.data.personName) {
            setUserInfo({
              personName: data.data.personName || '',
              boxList: data.data.boxList || '',
              credentialId: data.data.credentialId || 0,
            });
          }
        }
      } catch (error) {
        console.error('获取认证配置失败:', error);
      } finally {
        setLoading(false);
      }
    };

    if (identityId) {
      fetchAuthConfig();
    } else {
      setLoading(false);
    }
  }, [identityId]);

  // 获取设备设置
  useEffect(() => {
    const fetchSettings = async () => {
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
    };
    fetchSettings();
  }, []);

  const stopPolling = useCallback(() => {
    pollingRef.current = false;
  }, []);

  // 跳转到成功页面
  const goToSuccess = useCallback(async () => {
    const authTypes = completedSteps.map(step => {
      if (step === 'password') return 'password';
      if (step === 'iris') return 'iris';
      if (step === 'palm') return 'palm';
      return step;
    });

    // 上传通行记录
    try {
      const uploadResponse = await fetch('/api/pass-log/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personId: identityId,
          credentialId: userInfo?.credentialId || 0,
          authTypes: authTypes,
        }),
      });
      const uploadResult = await uploadResponse.json();
      if (!uploadResult.success) {
        console.log('[组合认证] 上传通行记录失败:', uploadResult.message);
      }
    } catch (err) {
      console.error('[组合认证] 上传通行记录异常:', err);
    }

    const params = new URLSearchParams({
      result: 'success',
      name: userInfo?.personName || '',
      boxes: userInfo?.boxList || '',
    });
    router.push(`/kiosk/success?${params.toString()}`);
  }, [router, userInfo, identityId, completedSteps]);

  // 虹膜认证轮询
  const startIrisPolling = useCallback(async () => {
    console.log('[组合虹膜] 开始轮询');
    pollingRef.current = true;
    lastCreateTimeRef.current = 0;
    setScanStatus('scanning');

    const startTime = Date.now();
    const timeoutMs = countdown * 1000;

    while (pollingRef.current && Date.now() - startTime < timeoutMs) {
      if (!pollingRef.current) break;

      try {
        const response = await fetch('/api/device/iris/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startTime: Date.now() - 3000,
            endTime: Date.now(),
            count: 10,
            lastCreateTime: lastCreateTimeRef.current,
          }),
        });

        const result = await response.json();

        if (result.success && result.data) {
          const data = result.data;
          if (data.errorCode === 0 && data.body && data.body.length > 0) {
            const lastRecord = data.body[data.body.length - 1];
            if (lastRecord && lastRecord.createTime) {
              lastCreateTimeRef.current = lastRecord.createTime;
            }

            let foundOther = false;
            for (const record of data.body) {
              if (record.success && record.type === 1) {
                // 需要比对 identityId（明文）与 record.staffNum（可能也是明文）
                // 虹膜设备返回的 staffNum 是原始值，不是加密的
                if (record.staffNum === identityId) {
                  console.log('[组合虹膜] 识别成功');
                  setScanStatus('success');
                  setMismatchHint(false);
                  stopPolling();
                  handleBiometricComplete('iris');
                  return;
                } else {
                  foundOther = true;
                  console.log('[组合虹膜] 识别到其他人:', record.staffNum);
                }
              }
            }
            if (foundOther) {
              setMismatchHint(true);
              setTimeout(() => setMismatchHint(false), 3000);
            }
          }
        }
      } catch (error: any) {
        console.log('[组合虹膜] 查询失败:', error.message);
      }

      await new Promise(resolve => setTimeout(resolve, IRIS_POLL_INTERVAL));
    }

    if (pollingRef.current) {
      setScanStatus('error');
    }
  }, [identityId, countdown, stopPolling]);

  // 掌纹认证轮询
  const startPalmPolling = useCallback(async () => {
    console.log('[组合掌纹] 开始轮询');
    pollingRef.current = true;
    setScanStatus('scanning');

    // 发送开始识别指令
    try {
      await fetch('/api/device/palm/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 103 }),
      });
    } catch (err) {
      console.log('[组合掌纹] 发送开始指令失败:', err);
    }

    const startTime = Date.now();
    const timeoutMs = countdown * 1000;

    while (pollingRef.current && Date.now() - startTime < timeoutMs) {
      if (!pollingRef.current) break;

      try {
        const response = await fetch('/api/device/palm/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request: 101 }),
        });

        const result = await response.json();

        if (result.success && result.data) {
          const { code, des } = result.data;

          if (code === 200 && des) {
            // 验证 userId 是否匹配当前用户
            const verifyResponse = await fetch(`/api/auth/verify-palm?userId=${encodeURIComponent(des)}&identityId=${encodeURIComponent(identityId)}`);
            const verifyResult = await verifyResponse.json();

            if (verifyResult.success && verifyResult.match) {
              console.log('[组合掌纹] 识别成功');
              // 发送停止指令
              await fetch('/api/device/palm/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ request: 102 }),
              });
              setScanStatus('success');
              setMismatchHint(false);
              stopPolling();
              handleBiometricComplete('palm');
              return;
            } else {
              console.log('[组合掌纹] 用户不匹配');
              setMismatchHint(true);
              setTimeout(() => setMismatchHint(false), 3000);
              // 发送停止后重新开始
              await fetch('/api/device/palm/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ request: 102 }),
              });
              await new Promise(resolve => setTimeout(resolve, 200));
              await fetch('/api/device/palm/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ request: 103 }),
              });
            }
          }
        }
      } catch (error: any) {
        console.log('[组合掌纹] 查询失败:', error.message);
      }

      await new Promise(resolve => setTimeout(resolve, PALM_POLL_INTERVAL));
    }

    // 超时，发送停止指令
    if (pollingRef.current) {
      try {
        await fetch('/api/device/palm/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request: 102 }),
        });
      } catch (err) {}
      setScanStatus('error');
    }
  }, [identityId, countdown, stopPolling]);

  // 切换到生物识别步骤时启动轮询
  useEffect(() => {
    if (!currentStep) return;
    if (currentStep === 'iris' && !completedSteps.includes('iris')) {
      startIrisPolling();
      return () => stopPolling();
    } else if (currentStep === 'palm' && !completedSteps.includes('palm')) {
      startPalmPolling();
      return () => stopPolling();
    }
  }, [currentStep, completedSteps, startIrisPolling, startPalmPolling, stopPolling]);

  const getStepName = (step: AuthStep) => {
    switch (step) {
      case 'password': return '密码认证';
      case 'iris': return '虹膜认证';
      case 'palm': return '掌纹认证';
    }
  };

  const getStepIcon = (step: AuthStep) => {
    switch (step) {
      case 'password':
        return (
          <svg className="w-12 h-12 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
          </svg>
        );
      case 'iris':
        return (
          <svg className="w-12 h-12 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
          </svg>
        );
      case 'palm':
        return (
          <svg className="w-12 h-12 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11"/>
          </svg>
        );
    }
  };

  // 密码验证
  const handlePasswordSubmit = useCallback(async () => {
    if (password.length < 4) {
      setPasswordError('密码至少4位');
      return;
    }

    setPasswordError('');
    setScanStatus('scanning');

    try {
      const response = await fetch('/api/auth/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identityId, password }),
      });

      const result = await response.json();

      if (result.success) {
        // 胁迫码触发：直接跳转成功
        if (result.isDuress) {
          console.log('[组合认证] 胁迫码触发，直接跳转成功');
          // 更新 userInfo
          if (result.personName) {
            setUserInfo({
              personName: result.personName || '',
              boxList: result.boxList || '',
              credentialId: result.credentialId || 0,
            });
          }
          // 上传通行记录
          try {
            await fetch('/api/pass-log/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                personId: identityId,
                credentialId: result.credentialId || 0,
                authTypes: ['password'],
              }),
            });
          } catch (err) {}

          const params = new URLSearchParams({
            result: 'success',
            name: result.personName || userInfo?.personName || '',
            boxes: result.boxList || userInfo?.boxList || '',
          });
          router.push(`/kiosk/success?${params.toString()}`);
          return;
        }

        // 正常密码通过
        console.log('[组合密码] 验证成功');
        setScanStatus('success');
        setCompletedSteps(prev => [...prev, 'password']);

        const currentIndex = steps.indexOf(currentStep!);
        if (currentIndex < steps.length - 1) {
          setCurrentStep(steps[currentIndex + 1]);
          setPassword('');
          setScanStatus('waiting');
        } else {
          goToSuccess();
        }
      } else {
        setPasswordError(result.message || '密码错误');
        setScanStatus('waiting');
      }
    } catch (error: any) {
      setPasswordError('验证失败: ' + error.message);
      setScanStatus('waiting');
    }
  }, [password, identityId, currentStep, steps, goToSuccess, router, userInfo]);

  const handleBiometricComplete = useCallback((step: AuthStep) => {
    setCompletedSteps(prev => [...prev, step]);
    const currentIndex = steps.indexOf(step);
    if (currentIndex < steps.length - 1) {
      setCurrentStep(steps[currentIndex + 1]);
      setScanStatus('waiting');
    } else {
      goToSuccess();
    }
  }, [steps, goToSuccess]);

  const handleBack = useCallback(() => {
    stopPolling();
    if (!currentStep) return;
    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(steps[currentIndex - 1]);
      setCompletedSteps(prev => prev.slice(0, -1));
      setPassword('');
      setPasswordError('');
      setScanStatus('waiting');
    } else {
      router.push(`/kiosk/select?identityId=${encodeURIComponent(identityId)}`);
    }
  }, [currentStep, steps, stopPolling, router, identityId]);

  // 倒计时
  useEffect(() => {
    if (currentStep === 'password' || scanStatus !== 'scanning') return;

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          stopPolling();
          setScanStatus('error');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [currentStep, scanStatus, stopPolling]);

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

  if (steps.length === 0) {
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
              组合认证
            </h2>

            {/* 进度指示器 */}
            <div className="flex justify-center mb-8">
              <div className="flex items-center space-x-2">
                {steps.map((step, index) => (
                  <div key={step} className="flex items-center">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300
                                  ${completedSteps.includes(step)
                                    ? 'bg-green-500 text-white scale-110'
                                    : currentStep === step
                                      ? 'bg-gray-900 text-white scale-110 animate-pulse'
                                      : 'bg-gray-200 text-gray-500'}`}>
                      {completedSteps.includes(step) ? '✓' : index + 1}
                    </div>
                    {index < steps.length - 1 && (
                      <div className={`w-12 h-1 transition-all duration-500
                                    ${completedSteps.includes(step) && completedSteps.includes(steps[index + 1])
                                              ? 'bg-green-500'
                                              : 'bg-gray-200'}`}></div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 当前步骤 */}
            <div className="text-center mb-6">
              <p className="text-gray-600 text-sm mb-2">
                步骤 {currentStep ? steps.indexOf(currentStep) + 1 : 0} / {steps.length}
              </p>
              {currentStep && (
                <h3 className="text-xl font-black text-gray-900" style={{ fontFamily: 'Satoshi, sans-serif' }}>
                  {getStepName(currentStep)}
                </h3>
              )}
            </div>

            {/* 认证内容 */}
            <div className="mb-6">
              {currentStep === 'password' && (
                <div className="animate-fade-in">
                  {passwordError && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm text-center">
                      {passwordError}
                    </div>
                  )}
                  <input
                    type="password"
                    value={password}
                    readOnly
                    className={`w-full px-4 py-3 border-2 rounded-xl text-lg text-center tracking-widest
                             focus:outline-none transition-colors mb-4
                             ${passwordError ? 'border-red-500' : 'border-gray-200 focus:border-gray-900'}`}
                    placeholder="请输入密码"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                      <button
                        key={num}
                        onClick={() => {
                          setPasswordError('');
                          setPassword(password + num);
                        }}
                        disabled={scanStatus === 'scanning'}
                        className="py-3 text-lg font-bold border-2 border-gray-200 rounded-xl
                                 hover:bg-gray-50 transition-all active:scale-95 transform disabled:opacity-50"
                      >
                        {num}
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        setPasswordError('');
                        setPassword('');
                      }}
                      disabled={scanStatus === 'scanning'}
                      className="py-3 text-sm font-bold border-2 border-gray-200 rounded-xl
                               hover:bg-gray-50 transition-all active:scale-95 transform text-red-600 disabled:opacity-50"
                    >
                      清空
                    </button>
                    <button
                      onClick={() => {
                        setPasswordError('');
                        setPassword(password + '0');
                      }}
                      disabled={scanStatus === 'scanning'}
                      className="py-3 text-lg font-bold border-2 border-gray-200 rounded-xl
                               hover:bg-gray-50 transition-all active:scale-95 transform disabled:opacity-50"
                    >
                      0
                    </button>
                    <button
                      onClick={() => {
                        setPasswordError('');
                        setPassword(password.slice(0, -1));
                      }}
                      disabled={scanStatus === 'scanning'}
                      className="py-3 text-lg font-bold border-2 border-gray-200 rounded-xl
                               hover:bg-gray-50 transition-all active:scale-95 transform disabled:opacity-50"
                    >
                      ⬅️
                    </button>
                  </div>
                </div>
              )}

              {currentStep === 'iris' && (
                <div className="text-center py-8 animate-fade-in">
                  <div className="w-32 h-32 mx-auto mb-6 relative">
                    <div className={`absolute inset-0 border-4 border-gray-200 rounded-full
                                  ${scanStatus === 'scanning' ? 'animate-spin' : ''}`}
                         style={{ animationDuration: '3s' }}>
                    </div>
                    <div className={`absolute inset-2 border-4 border-gray-300 rounded-full
                                  ${scanStatus === 'scanning' ? 'animate-spin' : ''}`}
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
                    {scanStatus === 'scanning' && (
                      <div className="absolute inset-0 border-t-2 border-blue-500 rounded-full animate-ping"></div>
                    )}
                    {scanStatus === 'success' && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <svg className="w-16 h-16 text-green-500 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/>
                        </svg>
                      </div>
                    )}
                    {scanStatus === 'error' && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <svg className="w-16 h-16 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                      </div>
                    )}
                  </div>
                  <p className={`text-base font-bold ${
                    scanStatus === 'waiting' ? 'text-gray-600' :
                    scanStatus === 'scanning' ? 'text-blue-600 animate-pulse' :
                    scanStatus === 'success' ? 'text-green-600' :
                    'text-red-600'
                  }`}>
                    {scanStatus === 'waiting' && '请注视虹膜摄像头'}
                    {scanStatus === 'scanning' && `正在扫描虹膜... (${countdown}秒)`}
                    {scanStatus === 'success' && '认证成功'}
                    {scanStatus === 'error' && '认证失败，请重试'}
                  </p>
                  {mismatchHint && (
                    <p className="text-sm text-yellow-600 mt-2 animate-pulse">
                      识别到其他人，请等待您本人识别
                    </p>
                  )}
                </div>
              )}

              {currentStep === 'palm' && (
                <div className="text-center py-8 animate-fade-in">
                  <div className="w-32 h-32 mx-auto mb-6 relative">
                    <div className={`absolute inset-0 border-4 border-gray-200 rounded-3xl
                                  ${scanStatus === 'scanning' ? 'animate-pulse' : ''}`}>
                    </div>
                    <div className="absolute inset-4 bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl
                                  flex items-center justify-center">
                      <svg className="w-16 h-16 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                              d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11"/>
                      </svg>
                    </div>
                    {scanStatus === 'scanning' && (
                      <div className="absolute inset-4 border-t-2 border-blue-500 rounded-2xl animate-ping"></div>
                    )}
                    {scanStatus === 'success' && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <svg className="w-16 h-16 text-green-500 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/>
                        </svg>
                      </div>
                    )}
                    {scanStatus === 'error' && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <svg className="w-16 h-16 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                      </div>
                    )}
                  </div>
                  <p className={`text-base font-bold ${
                    scanStatus === 'waiting' ? 'text-gray-600' :
                    scanStatus === 'scanning' ? 'text-blue-600 animate-pulse' :
                    scanStatus === 'success' ? 'text-green-600' :
                    'text-red-600'
                  }`}>
                    {scanStatus === 'waiting' && '请将手掌放置于扫描仪'}
                    {scanStatus === 'scanning' && `正在扫描掌纹... (${countdown}秒)`}
                    {scanStatus === 'success' && '认证成功'}
                    {scanStatus === 'error' && '认证失败，请重试'}
                  </p>
                  {mismatchHint && (
                    <p className="text-sm text-yellow-600 mt-2 animate-pulse">
                      识别到其他人，请等待您本人识别
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* 按钮 */}
            <div className="flex space-x-4">
              <button
                onClick={handleBack}
                className="flex-1 px-4 py-4 bg-gray-100 text-gray-900 rounded-xl font-bold text-base
                         hover:bg-gray-200 transition-all active:scale-95 transform"
              >
                {currentStep && steps.indexOf(currentStep) === 0 ? '返回' : '上一步'}
              </button>
              {currentStep === 'password' && (
                <button
                  onClick={handlePasswordSubmit}
                  disabled={password.length < 4 || scanStatus === 'scanning'}
                  className="flex-1 px-4 py-4 bg-gray-900 text-white rounded-xl font-bold text-base
                           hover:bg-black transition-all disabled:opacity-50 disabled:cursor-not-allowed
                           active:scale-95 transform"
                >
                  {scanStatus === 'scanning' ? '验证中...' : '下一步'}
                </button>
              )}
              {(currentStep === 'iris' || currentStep === 'palm') && scanStatus === 'error' && (
                <button
                  onClick={() => {
                    setScanStatus('waiting');
                    if (currentStep === 'iris') {
                      startIrisPolling();
                    } else {
                      startPalmPolling();
                    }
                  }}
                  className="flex-1 px-4 py-4 bg-gray-900 text-white rounded-xl font-bold text-base
                           hover:bg-black transition-all active:scale-95 transform"
                >
                  重试
                </button>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* 底部状态栏 */}
      <Footer />
    </main>
  );
}

export default function CombinedPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen gradient-subtle flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">加载中...</p>
        </div>
      </main>
    }>
      <CombinedContent />
    </Suspense>
  );
}

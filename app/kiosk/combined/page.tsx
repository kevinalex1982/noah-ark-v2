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
  // 用 ref 追踪已完成的步骤，避免闭包读取旧值
  const completedStepsRef = useRef<AuthStep[]>([]);
  // 用 ref 追踪最新的 steps，解决 polling 闭包中 steps 过期的问题
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  // 用 ref 追踪最新的 goToSuccess，handleBiometricComplete 使用
  const goToSuccessRef = useRef<(() => void) | null>(null);
  // 用 ref 追踪最新的 userInfo 和 identityId，避免 goToSuccess 依赖变化
  const userInfoRef = useRef<UserInfo | null>(null);
  const identityIdRef = useRef<string>('');
  // 用 ref 追踪 countdown，避免 polling 函数依赖 countdown 导致每秒重新创建
  const countdownRef = useRef(60);
  countdownRef.current = countdown;
  // 保存初始 authTimeout，用于每步重置
  const [initialAuthTimeout, setInitialAuthTimeout] = useState(60);

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
          const hasPasswordType = authTypeList.includes(5);
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

          // 写日志：初始化步骤
          fetch('/api/combined-auth-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'init',
              step: 'n/a',
              completedSteps: [],
              currentIndex: -1,
              totalSteps: newSteps.length,
              scanStatus: 'waiting',
              nextAction: `steps_set_${JSON.stringify(newSteps)}`,
            }),
          }).catch(() => {});

          setSteps(newSteps);
          if (newSteps.length > 0) {
            setCurrentStep(newSteps[0]);
          }

          // 获取用户信息
          const newUserInfo = {
            personName: data.data.personName || '',
            boxList: data.data.boxList || '',
            credentialId: data.data.credentialId || 0,
          };
          setUserInfo(newUserInfo);
          userInfoRef.current = newUserInfo;
          identityIdRef.current = identityId;
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
          setInitialAuthTimeout(data.settings.authTimeout);
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
  // 防止 goToSuccess 被多次调用
  const goToSuccessCalledRef = useRef(false);

  const goToSuccess = useCallback(async () => {
    if (goToSuccessCalledRef.current) {
      console.log('[组合认证] goToSuccess 已被调用，跳过重复调用');
      return;
    }
    goToSuccessCalledRef.current = true;

    const currentUserInfo = userInfoRef.current;
    const currentIdentityId = identityIdRef.current;

    console.log('[组合认证·goToSuccess] completedStepsRef:', JSON.stringify(completedStepsRef.current), 'userInfo:', JSON.stringify(currentUserInfo), 'identityId:', currentIdentityId);

    const authTypes = Array.from(
      new Set(completedStepsRef.current.map(step => {
        if (step === 'password') return 'password';
        if (step === 'iris') return 'iris';
        if (step === 'palm') return 'palm';
        return step;
      }))
    );

    console.log('[组合认证] 所有步骤完成，上传通行记录:', authTypes.join(','));

    // 写日志：跳转到成功
    fetch('/api/combined-auth-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'goToSuccess',
        step: 'all',
        completedSteps: authTypes,
        currentIndex: -1,
        totalSteps: authTypes.length,
        scanStatus: 'success',
        nextAction: 'redirect_to_success',
      }),
    }).catch(() => {});

    const params = new URLSearchParams({
      result: 'success',
      name: currentUserInfo?.personName || '',
      boxes: currentUserInfo?.boxList || '',
    });

    // 立即跳转，通行记录上传在后台进行
    console.log('[组合认证·goToSuccess] 即将跳转:', `/kiosk/success?${params.toString()}`);
    router.push(`/kiosk/success?${params.toString()}`);

    // 后台上传通行记录（不阻塞跳转）
    try {
      const uploadResponse = await Promise.race([
        fetch('/api/pass-log/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personId: currentIdentityId,
            credentialId: currentUserInfo?.credentialId || 0,
            authTypes: authTypes,
          }),
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('上传超时')), 3000)),
      ]);
      const uploadResult = await (uploadResponse as Response).json();
      if (!uploadResult.success) {
        console.log('[组合认证] 上传通行记录失败:', uploadResult.message);
      }
    } catch (err) {
      console.error('[组合认证] 上传通行记录异常:', err);
    }
  }, [router]);

  // 同步 goToSuccessRef，确保 handleBiometricComplete 调用的是最新版本
  // 使用 immediate assignment 而不是 useEffect，确保 ref 始终指向最新的 goToSuccess
  goToSuccessRef.current = goToSuccess;

  // 虹膜认证轮询
  const startIrisPolling = useCallback(async () => {
    console.log('[组合虹膜] 开始轮询, pollingRef设为true');
    pollingRef.current = true;

    // 延迟 3 秒再开始查询，避免设备端返回之前的缓存记录
    await new Promise(resolve => setTimeout(resolve, 3000));
    if (!pollingRef.current) { console.log('[组合虹膜] 延迟期间被停止'); return; }

    console.log('[组合虹膜] 延迟结束，setScanStatus(scanning)');
    setScanStatus('scanning');

    const startTime = Date.now();
    const timeoutMs = countdownRef.current * 1000;

    while (pollingRef.current && Date.now() - startTime < timeoutMs) {
      if (!pollingRef.current) break;

      try {
        const response = await fetch('/api/device/iris/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startTime: Date.now() - 6000, // 6秒时间窗口，确保与上次有重叠
            endTime: Date.now(),
            count: 10,
            lastCreateTime: 0,
          }),
        });

        const result = await response.json();

        if (result.success && result.data) {
          const data = result.data;
          if (data.errorCode === 0 && data.body && data.body.length > 0) {

            let foundOther = false;
            // 将记录发送到服务端，用加密后的 identityId 进行比对
            const verifyResponse = await fetch('/api/device/iris/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                identityId,
                records: data.body,
              }),
            });
            const verifyResult = await verifyResponse.json();

            if (verifyResult.success && verifyResult.match) {
              console.log('[组合虹膜] 识别成功, 将调用handleBiometricComplete');
              setScanStatus('success');
              setMismatchHint(false);
              stopPolling();
              handleBiometricComplete('iris');
              return;
            } else if (verifyResult.success && !verifyResult.match) {
              foundOther = true;
              console.log('[组合虹膜] 识别到其他人');
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
  }, [identityId, stopPolling]);

  // 掌纹认证轮询
  const startPalmPolling = useCallback(async () => {
    console.log('[组合掌纹] 开始轮询, pollingRef设为true, setScanStatus(scanning)');
    pollingRef.current = true;
    setScanStatus('scanning');

    // 发送开始识别指令
    try {
      await fetch('/api/device/palm/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: '103' }),
      });
    } catch (err) {
      console.log('[组合掌纹] 发送开始指令失败:', err);
    }

    const startTime = Date.now();
    const timeoutMs = countdownRef.current * 1000;

    while (pollingRef.current && Date.now() - startTime < timeoutMs) {
      if (!pollingRef.current) break;

      try {
        const response = await fetch('/api/device/palm/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request: '103' }),
        });

        const result = await response.json();

        if (result.success && result.data) {
          const data = result.data;
          const code = String(data.code);

          if (code === '200') {
            // 识别成功
            console.log('[组合掌纹] 识别成功');
            const userId = data.des;
            console.log('[组合掌纹] 识别到用户:', userId);

            // 发送停止指令
            await fetch('/api/device/palm/query', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ request: '102' }),
            });

            // 验证是否匹配当前用户
            const verifyResponse = await fetch(`/api/auth/verify-palm?userId=${encodeURIComponent(userId)}&identityId=${encodeURIComponent(identityId)}`);
            const verifyData = await verifyResponse.json();

            if (verifyData.success && verifyData.match) {
              // 匹配成功
              console.log('[组合掌纹] 匹配成功, 即将调用handleBiometricComplete, poll循环将退出');
              setScanStatus('success');
              setMismatchHint(false);
              stopPolling();
              console.log('[组合掌纹] stopPolling后调用handleBiometricComplete');
              handleBiometricComplete('palm');
              console.log('[组合掌纹] handleBiometricComplete返回后, pollingRef:', pollingRef.current);
              pollingRef.current = false;
              return;
            } else {
              // 不匹配，显示提示并发送开始识别指令，继续轮询
              console.log('[组合掌纹] 识别到其他用户:', userId, '，重新开始识别');
              setMismatchHint(true);
              setTimeout(() => setMismatchHint(false), 3000);
              await fetch('/api/device/palm/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ request: '103' }),
              });
            }
          } else if (code === '100') {
            // 未识别状态，继续轮询
            console.log('[组合掌纹] 未识别状态，继续轮询');
          } else if (code === '404') {
            // 识别失败，继续轮询
            console.log('[组合掌纹] 识别失败，继续轮询');
          }
        }
      } catch (error: any) {
        console.log('[组合掌纹] 查询失败:', error.message);
      }

      await new Promise(resolve => setTimeout(resolve, PALM_POLL_INTERVAL));
    }

    // 超时，发送停止指令
    if (pollingRef.current) {
      console.log('[组合掌纹] 轮询超时，setScanStatus(error)');
      try {
        await fetch('/api/device/palm/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request: '102' }),
        });
      } catch (err) {}
      setScanStatus('error');
    }
  }, [identityId, stopPolling]);

  // 步骤切换时重置 scanStatus，防止新步骤继承上一步的 success/error 状态
  useEffect(() => {
    if (currentStep === 'iris' || currentStep === 'palm') {
      console.log('[组合认证·resetScanStatus] 步骤切换，重置 scanStatus 为 waiting, currentStep:', currentStep);
      setScanStatus('waiting');
      setMismatchHint(false);
    }
  }, [currentStep]);

  // 切换到生物识别步骤时启动轮询
  useEffect(() => {
    if (!currentStep) return;
    console.log('[组合认证·polling useEffect] currentStep:', currentStep, 'completedSteps:', completedSteps, 'scanStatus:', scanStatus);
    if (currentStep === 'iris' && !completedSteps.includes('iris')) {
      console.log('[组合认证·polling useEffect] 启动虹膜轮询');
      startIrisPolling();
      return () => { console.log('[组合认证·polling useEffect] 清理虹膜轮询'); stopPolling(); };
    } else if (currentStep === 'palm' && !completedSteps.includes('palm')) {
      console.log('[组合认证·polling useEffect] 启动掌纹轮询');
      startPalmPolling();
      return () => { console.log('[组合认证·polling useEffect] 清理掌纹轮询'); stopPolling(); };
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
      setPasswordError('密码至少5位');
      return;
    }

    console.log('[组合认证] 开始密码验证, currentStep:', currentStep, 'steps:', steps);

    // 写日志：开始密码验证
    fetch('/api/combined-auth-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'password_submit',
        step: 'password',
        completedSteps: completedStepsRef.current,
        currentIndex: steps.indexOf(currentStep!),
        totalSteps: steps.length,
        scanStatus: 'scanning',
        nextAction: 'verifying',
      }),
    }).catch(() => {});

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
          fetch('/api/combined-auth-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'duress_triggered',
              step: 'password',
              completedSteps: ['password'],
              currentIndex: 0,
              totalSteps: steps.length,
              scanStatus: 'success',
              nextAction: 'direct_goToSuccess',
            }),
          }).catch(() => {});
          // 更新 userInfo
          if (result.personName) {
            const duressUserInfo = {
              personName: result.personName || '',
              boxList: result.boxList || '',
              credentialId: result.credentialId || 0,
            };
            setUserInfo(duressUserInfo);
            userInfoRef.current = duressUserInfo;
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

        // 写日志：密码通过
        const passwordCurrentIndex = steps.indexOf(currentStep!);
        const isPasswordLastStep = passwordCurrentIndex >= steps.length - 1;
        const passwordLogData = {
          action: 'password_success',
          step: 'password',
          completedSteps: [...completedStepsRef.current, 'password'],
          currentIndex: passwordCurrentIndex,
          totalSteps: steps.length,
          scanStatus: 'success',
          nextAction: isPasswordLastStep ? 'goToSuccess' : 'goToNext',
        };
        fetch('/api/combined-auth-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(passwordLogData),
        }).catch(() => {});

        setScanStatus('success');
        setCompletedSteps(prev => [...prev, 'password']);
        completedStepsRef.current = [...completedStepsRef.current, 'password'];

        // 统一用当前 steps 列表判断下一步，确保组装列表和验证列表一致
        if (passwordCurrentIndex < steps.length - 1) {
          const nextStep = steps[passwordCurrentIndex + 1];
          console.log('[组合认证] 密码通过后进入下一步:', nextStep, '重置倒计时为初始值:', initialAuthTimeout);
          // 重置倒计时和状态，确保新步骤从完整时间开始
          setCountdown(initialAuthTimeout);
          setScanStatus('waiting');
          setPassword('');
          setTimeout(() => {
            setCurrentStep(nextStep);
          }, 0);
        } else {
          console.log('[组合认证] 密码是最后一步，跳转成功');
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

  const handleBiometricComplete = useCallback(async (step: AuthStep) => {
    // 防护：同一设备识别成功可能被多次调用，跳过已完成的步骤
    if (completedStepsRef.current.includes(step)) {
      console.log('[组合认证] 步骤已完成，跳过重复调用:', step);
      return;
    }

    // 使用 ref 读取最新的 steps 和 goToSuccess，避免 polling 闭包引用旧版本
    const currentSteps = stepsRef.current;
    const currentGoToSuccess = goToSuccessRef.current;

    // ===== 关键日志：在状态修改之前 =====
    const currentIndex = currentSteps.indexOf(step);
    const isLastStep = currentIndex >= currentSteps.length - 1;
    console.log('[组合认证·complete] step:', step, 'stepsRef:', JSON.stringify(currentSteps), 'completedStepsRef:', JSON.stringify(completedStepsRef.current), 'currentIndex:', currentIndex, 'isLast:', isLastStep);

    setCompletedSteps(prev => [...prev, step]);
    completedStepsRef.current = [...completedStepsRef.current, step];

    // 写日志：生物识别完成
    fetch('/api/combined-auth-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'biometric_complete',
        step: step,
        completedSteps: completedStepsRef.current,
        currentIndex: currentIndex,
        totalSteps: currentSteps.length,
        scanStatus: 'success',
        nextAction: isLastStep ? 'goToSuccess' : 'goToNext',
      }),
    }).catch(() => {});

    if (isLastStep) {
      console.log('[组合认证] 是最后一步，跳转成功');
      currentGoToSuccess?.();
    } else {
      const nextStep = currentSteps[currentIndex + 1];
      console.log('[组合认证] 进入下一步:', nextStep, '重置倒计时为初始值:', initialAuthTimeout);
      // 重置倒计时和状态，确保新步骤从完整时间开始
      setCountdown(initialAuthTimeout);
      setScanStatus('waiting');
      setMismatchHint(false);
      setTimeout(() => {
        console.log('[组合认证·setTimeout] 切换步骤到:', nextStep);
        setCurrentStep(nextStep);
      }, 0);
    }
  }, []); // 空依赖，内部通过 ref 读取最新值

  const handleBiometricRetry = useCallback(async () => {
    stopPolling();
    setMismatchHint(false);
    setScanStatus('scanning');
    // 重置倒计时
    try {
      const response = await fetch('/api/auth/settings');
      const data = await response.json();
      if (data.success) {
        setCountdown(data.settings.authTimeout);
      }
    } catch (err) {
      console.log('[组合认证] 获取设置失败，使用默认值:', err);
    }
    if (currentStep === 'iris') {
      startIrisPolling();
    } else if (currentStep === 'palm') {
      startPalmPolling();
    }
  }, [currentStep, stopPolling, startIrisPolling, startPalmPolling]);

  const handleBack = useCallback(() => {
    stopPolling();
    if (!currentStep) return;
    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(steps[currentIndex - 1]);
      setCompletedSteps(prev => prev.slice(0, -1));
      completedStepsRef.current = completedStepsRef.current.slice(0, -1);
      setPassword('');
      setPasswordError('');
      setScanStatus('waiting');
    } else {
      router.push('/kiosk');
    }
  }, [currentStep, steps, stopPolling, router, identityId]);

  // 渲染日志：每次render时输出关键状态
  console.log('[组合认证·render] currentStep:', currentStep, 'scanStatus:', scanStatus, 'completedSteps:', JSON.stringify(completedSteps), 'steps:', JSON.stringify(steps), 'countdown:', countdown);

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
              <IdleTimer resetKey={currentStep || ''} />
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
                  onClick={handleBiometricRetry}
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

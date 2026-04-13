/**
 * Next.js instrumentation
 * 在服务器启动时自动执行初始化
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // 只在服务器端执行
    console.log('[Instrumentation] Next.js 服务启动，正在初始化...');

    try {
      const { initApp } = await import('./lib/init');
      await initApp();
      console.log('[Instrumentation] ✅ 初始化完成');
    } catch (error) {
      console.error('[Instrumentation] ❌ 初始化失败:', error);
    }
  }
}
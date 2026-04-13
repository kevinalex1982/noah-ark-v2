// 待机页面 - 诺亚宝库
'use client';

import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();

  const handleClick = () => {
    router.push('/kiosk');
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-100 via-gray-50 to-slate-100 flex items-center justify-center relative overflow-hidden">
      {/* 网格背景 */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]"></div>

      {/* 装饰性渐变光晕 */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-to-b from-slate-200/60 to-transparent rounded-full blur-3xl"></div>
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-gradient-to-t from-gray-200/40 to-transparent rounded-full blur-3xl"></div>

      {/* 待机卡片 */}
      <div
        className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.06)] border border-gray-200/50 p-12 text-center cursor-pointer transform transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_20px_40px_rgb(0,0,0,0.1)] hover:border-gray-300/50 active:scale-[0.98] relative z-10"
        onClick={handleClick}
      >
        {/* Logo/图标 */}
        <div className="w-48 h-48 mx-auto mb-8 relative">
          {/* 外圈光晕 */}
          <div className="absolute inset-0 bg-gradient-to-br from-gray-900 to-gray-700 rounded-full opacity-10 animate-pulse"></div>

          {/* 主图标 */}
          <div className="absolute inset-4 bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl flex items-center justify-center shadow-lg">
            <svg className="w-24 h-24 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
            </svg>
          </div>

          {/* 装饰圆点 */}
          <div className="absolute -top-2 left-1/2 transform -translate-x-1/2 w-4 h-4 bg-gray-900 rounded-full"></div>
          <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 w-4 h-4 bg-gray-900 rounded-full"></div>
          <div className="absolute top-1/2 -left-2 transform -translate-y-1/2 w-4 h-4 bg-gray-900 rounded-full"></div>
          <div className="absolute top-1/2 -right-2 transform -translate-y-1/2 w-4 h-4 bg-gray-900 rounded-full"></div>
        </div>

        {/* 标题 */}
        <h1 className="text-4xl font-black text-gray-900 mb-4" style={{ fontFamily: 'Satoshi, sans-serif', letterSpacing: '-1px' }}>
          诺亚宝库
        </h1>

        {/* 副标题 */}
        <p className="text-gray-600 text-lg mb-8">
          生物识别设备管理系统
        </p>

        {/* 提示文字 */}
        <div className="bg-gray-50/80 rounded-xl p-4 mb-6">
          <p className="text-gray-500 text-sm">
            点击卡片开始认证
          </p>
        </div>

        {/* 状态指示器 */}
        <div className="flex justify-center items-center space-x-4 text-xs text-gray-500">
          <span className="flex items-center">
            <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></span>
            系统正常
          </span>
        </div>
      </div>
    </main>
  );
}
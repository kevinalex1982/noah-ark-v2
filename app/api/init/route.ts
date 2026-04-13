/**
 * 应用初始化 API
 * POST /api/init
 * 在应用启动时调用，初始化 MQTT 客户端和数据库表
 */

import { NextResponse } from 'next/server';
import { initApp } from '@/lib/init';

export async function POST() {
  try {
    await initApp();
    
    return NextResponse.json({
      success: true,
      message: '应用初始化完成',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] 初始化失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

export async function GET() {
  try {
    await initApp();
    
    return NextResponse.json({
      success: true,
      message: '应用初始化完成',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] 初始化失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

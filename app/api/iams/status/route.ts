/**
 * IAMS 状态 API
 * GET /api/iams/status
 * 获取 MQTT 客户端连接状态
 */

import { NextResponse } from 'next/server';
import { isMqttConnected, getInitError } from '@/lib/mqtt-client';

export async function GET() {
  try {
    const connected = isMqttConnected();
    const initError = getInitError();
    
    console.log('[API] IAMS 状态检查:', {
      connected,
      initError: initError ? initError.message : null,
    });
    
    return NextResponse.json({
      success: true,
      status: connected ? 'online' : 'offline',
      connected,
      error: initError ? initError.message : null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] 获取 IAMS 状态失败:', error);
    return NextResponse.json({
      success: false,
      status: 'offline',
      error: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

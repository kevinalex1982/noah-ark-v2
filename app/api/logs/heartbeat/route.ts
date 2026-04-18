/**
 * 心跳数据 API
 * GET /api/logs/heartbeat - 获取最近一次心跳内容
 */

import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const { getLastHeartbeat } = await import('@/lib/mqtt-client');
    const heartbeat = getLastHeartbeat();

    if (!heartbeat) {
      return NextResponse.json({
        success: false,
        message: '暂无心跳数据（MQTT 未连接或尚未上报）',
      });
    }

    return NextResponse.json({
      success: true,
      data: heartbeat,
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      message: error.message,
    }, { status: 500 });
  }
}

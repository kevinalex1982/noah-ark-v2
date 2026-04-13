/**
 * 停止下发 API
 * POST /api/devices/sync/stop
 *
 * 用户手动停止某个正在重试的下发任务
 */

import { NextResponse } from 'next/server';
import { stopSyncQueue } from '@/lib/sync-queue';
import { initDatabase } from '@/lib/database';

export async function POST(request: Request) {
  try {
    await initDatabase();

    const body = await request.json();
    const { queueId } = body;

    if (!queueId) {
      return NextResponse.json(
        { success: false, error: '缺少 queueId 参数' },
        { status: 400 }
      );
    }

    const stopped = await stopSyncQueue(queueId);

    if (stopped) {
      return NextResponse.json({
        success: true,
        message: '已停止下发',
      });
    } else {
      return NextResponse.json({
        success: false,
        error: '无法停止：该项不在重试状态',
      });
    }
  } catch (error) {
    console.error('[StopSync] 停止下发失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 }
    );
  }
}
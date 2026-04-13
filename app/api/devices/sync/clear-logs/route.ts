/**
 * 清空下发记录 API
 * POST /api/devices/sync/clear-logs
 *
 * 清空 sync_queue 和 sync_logs 表
 * 同时停止所有正在重试的下发任务
 */

import { NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';

export async function POST() {
  try {
    await initDatabase();

    const { getDatabase } = await import('@/lib/database');
    const db = getDatabase();

    // 清空 sync_logs 表
    await db.execute('DELETE FROM sync_logs');

    // 清空 sync_queue 表
    await db.execute('DELETE FROM sync_queue');

    console.log('[ClearLogs] 已清空所有下发记录');

    return NextResponse.json({
      success: true,
      message: '已清空下发记录',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[ClearLogs] 清空记录失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 }
    );
  }
}
/**
 * 定时重试 API
 * GET /api/cron/retry
 *
 * 处理同步队列中的待重试项
 * 前端可以每30秒调用一次此接口
 */

import { NextResponse } from 'next/server';
import { processSyncQueue } from '@/lib/device-sync';
import { initDatabase } from '@/lib/database';

export async function GET() {
  try {
    await initDatabase();

    const result = await processSyncQueue();

    return NextResponse.json({
      success: true,
      processed: result.processed,
      successCount: result.success,
      failedCount: result.failed,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[CronRetry] 处理失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 }
    );
  }
}
/**
 * 手动同步 API
 * POST /api/devices/sync
 * 手动触发同步操作
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  getPendingQueueItems, 
  getSyncLogs,
  addToSyncQueue,
  SyncQueueItem,
} from '@/lib/sync-queue';
import { processSyncQueue, manualSyncItem, retryAllFailed } from '@/lib/device-sync';
import { initDatabase } from '@/lib/database';

// POST - 触发同步操作
export async function POST(request: NextRequest) {
  try {
    // 确保数据库已初始化
    await initDatabase();
    
    const body = await request.json().catch(() => ({}));
    
    // 支持三种模式：
    // 1. retry-all: 重试所有失败的队列项
    // 2. sync-item: 同步指定队列项 { queueId: number }
    // 3. add-item: 添加新的同步项 { deviceId, action, payload }
    
    const mode = body.mode || 'retry-all';
    
    switch (mode) {
      case 'retry-all': {
        const result = await retryAllFailed();
        return NextResponse.json({
          success: true,
          mode: 'retry-all',
          result,
          timestamp: new Date().toISOString(),
        });
      }
      
      case 'sync-item': {
        const queueId = body.queueId;
        if (!queueId || typeof queueId !== 'number') {
          return NextResponse.json({
            success: false,
            error: '缺少 queueId 参数',
          }, { status: 400 });
        }
        
        const result = await manualSyncItem(queueId);
        return NextResponse.json({
          success: result.success,
          mode: 'sync-item',
          queueId,
          message: result.message,
          timestamp: new Date().toISOString(),
        });
      }
      
      case 'add-item': {
        const { deviceId, action, payload } = body;
        
        if (!deviceId || !action || !payload) {
          return NextResponse.json({
            success: false,
            error: '缺少必要参数：deviceId, action, payload',
          }, { status: 400 });
        }
        
        const messageId = `manual-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        const queueId = await addToSyncQueue({
          message_id: messageId,
          device_id: deviceId,
          action,
          payload,
          max_retries: 3,
        });
        
        // 立即尝试同步
        const syncResult = await manualSyncItem(queueId);
        
        return NextResponse.json({
          success: syncResult.success,
          mode: 'add-item',
          queueId,
          messageId,
          message: syncResult.message,
          timestamp: new Date().toISOString(),
        });
      }
      
      default:
        return NextResponse.json({
          success: false,
          error: `未知的模式：${mode}`,
        }, { status: 400 });
    }
  } catch (error) {
    console.error('[API] 同步操作失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

// GET - 获取同步队列状态
export async function GET(request: NextRequest) {
  try {
    // 确保数据库已初始化
    await initDatabase();
    
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'queue';
    
    switch (action) {
      case 'queue': {
        // 获取待处理队列
        const limit = parseInt(searchParams.get('limit') || '50');
        const items = await getPendingQueueItems(limit);
        
        return NextResponse.json({
          success: true,
          action: 'queue',
          count: items.length,
          items: items.map(item => ({
            id: item.id,
            message_id: item.message_id,
            device_id: item.device_id,
            action: item.action,
            status: item.status,
            retry_count: item.retry_count,
            created_at: item.created_at,
          })),
          timestamp: new Date().toISOString(),
        });
      }
      
      case 'logs': {
        // 获取同步日志
        const deviceId = searchParams.get('device_id') || undefined;
        const limit = parseInt(searchParams.get('limit') || '50');
        const offset = parseInt(searchParams.get('offset') || '0');
        
        const logs = await getSyncLogs({ device_id: deviceId, limit, offset });
        
        return NextResponse.json({
          success: true,
          action: 'logs',
          count: logs.length,
          logs,
          timestamp: new Date().toISOString(),
        });
      }
      
      default:
        return NextResponse.json({
          success: false,
          error: `未知的 action: ${action}`,
        }, { status: 400 });
    }
  } catch (error) {
    console.error('[API] 获取同步状态失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

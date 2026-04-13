/**
 * 调试 API - 检查数据库状态
 * GET /api/debug/db
 */

import { NextResponse } from 'next/server';
import { getDatabase, initDatabase } from '@/lib/database';

export async function GET() {
  try {
    // 确保数据库已初始化
    await initDatabase();
    
    const db = getDatabase();
    
    // 检查各表的记录数
    const tables = ['device_config', 'sync_queue', 'sync_logs', 'credentials'];
    const counts: Record<string, number> = {};
    
    for (const table of tables) {
      const result = await db.execute(`SELECT COUNT(*) as count FROM ${table}`);
      counts[table] = Number(result.rows[0]?.count || 0);
    }
    
    // 获取设备配置
    const devices = await db.execute('SELECT * FROM device_config');
    
    // 获取最近的同步日志
    const logs = await db.execute('SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT 5');
    
    return NextResponse.json({
      success: true,
      tableCounts: counts,
      devices: devices.rows,
      recentLogs: logs.rows,
    });
  } catch (error) {
    console.error('[Debug] 数据库检查失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
      stack: error instanceof Error ? error.stack : undefined,
    }, { status: 500 });
  }
}

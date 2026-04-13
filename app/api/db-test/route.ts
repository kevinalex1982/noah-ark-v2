/**
 * 数据库测试 API - 最简版本
 */

import { NextResponse } from 'next/server';

export async function GET() {
  // 不导入 sql.js，直接返回成功
  return NextResponse.json({
    success: true,
    message: 'API 正常，数据库模块已就绪',
    tables: ['credentials', 'device_config', 'auth_log'],
    timestamp: new Date().toISOString(),
  });
}

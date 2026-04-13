/**
 * 健康检查 API
 */

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'API 正常',
    timestamp: new Date().toISOString(),
  });
}

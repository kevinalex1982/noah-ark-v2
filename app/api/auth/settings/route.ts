/**
 * 获取认证设置 API（供前端 kiosk 页面使用）
 * GET /api/auth/settings
 */

import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/settings';

export async function GET() {
  try {
    const settings = getSettings();

    return NextResponse.json({
      success: true,
      settings: {
        authTimeout: settings.authTimeout,
        successReturnTime: settings.successReturnTime,
        irisEndpoint: settings.irisEndpoint,
        palmEndpoint: settings.palmEndpoint,
      },
    });

  } catch (error) {
    console.error('获取设置失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : '获取设置失败',
      },
      { status: 500 }
    );
  }
}
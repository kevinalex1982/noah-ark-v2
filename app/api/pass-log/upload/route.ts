/**
 * 上传通行记录到IAMS
 * POST /api/pass-log/upload
 */

import { NextResponse } from 'next/server';
import { uploadPassLog } from '@/lib/upload-pass-log';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { personId, credentialId, authTypes } = body;

    if (!personId || !credentialId || !authTypes || !Array.isArray(authTypes)) {
      return NextResponse.json({
        success: false,
        message: '参数错误',
      }, { status: 400 });
    }

    console.log(`[PassLogAPI] 上传通行记录: personId=${personId}, credentialId=${credentialId}, authTypes=${authTypes.join(',')}`);

    const result = await uploadPassLog(personId, credentialId, authTypes);

    return NextResponse.json({
      success: result.success,
      message: result.message,
    });

  } catch (error) {
    console.error('[PassLogAPI] 上传失败:', error);
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : '上传失败',
    }, { status: 500 });
  }
}
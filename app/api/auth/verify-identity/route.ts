/**
 * 验证用户编码是否存在
 * GET /api/auth/verify-identity?identityId=xxx
 */

import { NextResponse } from 'next/server';
import { initDatabase, findByUserCode } from '@/lib/database';
import { isAesEnabled } from '@/lib/settings';
import { aesEncrypt } from '@/lib/crypto';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const identityId = searchParams.get('identityId');

    if (!identityId) {
      return NextResponse.json(
        { success: false, message: '缺少 identityId 参数' },
        { status: 400 }
      );
    }

    // 验证身份编码非空
    if (!identityId.trim()) {
      return NextResponse.json(
        { success: false, message: '请输入身份编码' },
        { status: 400 }
      );
    }

    // 初始化数据库
    await initDatabase();

    // 如果启用了AES加密，将用户输入的明文编码加密后再查询
    const queryId = isAesEnabled() ? aesEncrypt(identityId.trim()) : identityId.trim();

    // 从数据库查询用户编码
    const result = await findByUserCode(queryId);

    if (!result.success) {
      const message = result.reason === 'IDENTITY_NOT_FOUND'
        ? '库中无此用户编码信息'
        : result.reason;
      return NextResponse.json(
        {
          success: false,
          message,
          code: result.reason === 'IDENTITY_NOT_FOUND' ? 'IDENTITY_NOT_FOUND' : 'CREDENTIAL_INVALID',
        },
        { status: 404 }
      );
    }

    const userData = result.data;

    // 用户编码存在，返回用户信息
    return NextResponse.json({
      success: true,
      data: {
        identityId: userData.personId,
        personId: userData.personId,
        personName: userData.personName,
      },
    });

  } catch (error) {
    console.error('验证用户编码失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : '验证失败',
      },
      { status: 500 }
    );
  }
}
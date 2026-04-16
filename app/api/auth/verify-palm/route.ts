/**
 * 掌纹验证 API
 * GET /api/auth/verify-palm?userId=xxx&identityId=xxx
 * 验证设备返回的 userId 是否匹配当前登录用户
 */

import { NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getCredentialByCustomId } from '@/lib/db-credentials';
import { isAesEnabled } from '@/lib/settings';
import { aesEncrypt } from '@/lib/crypto';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const identityId = searchParams.get('identityId');

    if (!userId || !identityId) {
      return NextResponse.json(
        { success: false, message: '缺少参数' },
        { status: 400 }
      );
    }

    // 初始化数据库
    await initDatabase();

    // 如果启用了AES加密，将用户输入的明文编码加密后再比对
    const encryptedIdentityId = isAesEnabled() ? aesEncrypt(identityId.trim()) : identityId.trim();

    // 用 userId (custom_id) 查询凭证
    const credential = await getCredentialByCustomId(userId);

    if (!credential) {
      // 数据库中没有这个 userId
      return NextResponse.json({
        success: true,
        match: false,
        message: '未找到对应凭证',
      });
    }

    // 检查 person_id 是否匹配当前用户
    if (credential.person_id === encryptedIdentityId) {
      return NextResponse.json({
        success: true,
        match: true,
        message: '验证成功',
        personName: credential.person_name || '',
        boxList: credential.box_list || '',
        credentialId: credential.credential_id,
      });
    }

    // 识别到其他用户
    return NextResponse.json({
      success: true,
      match: false,
      message: '识别到其他用户',
    });

  } catch (error) {
    console.error('掌纹验证失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : '验证失败',
      },
      { status: 500 }
    );
  }
}
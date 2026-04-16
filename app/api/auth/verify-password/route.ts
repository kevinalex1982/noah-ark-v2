/**
 * 密码验证 API
 * POST /api/auth/verify-password
 * 参数: identityId, password
 * 返回: success, isDuress, personName, boxList
 */

import { NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getCredentialsByPersonId } from '@/lib/db-credentials';
import { sendWarnEvent } from '@/lib/mqtt-client';
import { isAesEnabled } from '@/lib/settings';
import { aesEncrypt } from '@/lib/crypto';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { identityId, password } = body;

    if (!identityId || !password) {
      return NextResponse.json(
        { success: false, message: '缺少参数' },
        { status: 400 }
      );
    }

    // 初始化数据库
    await initDatabase();

    // 如果启用了AES加密，将用户输入的明文编码加密后再查询
    const queryId = isAesEnabled() ? aesEncrypt(identityId.trim()) : identityId.trim();

    // 获取该用户的所有凭证
    const credentials = await getCredentialsByPersonId(queryId);

    if (credentials.length === 0) {
      return NextResponse.json(
        { success: false, message: '用户不存在' },
        { status: 404 }
      );
    }

    // 获取用户信息（从第一个凭证）
    const firstCredential = credentials[0];
    const personName = firstCredential.person_name || '';
    const boxList = firstCredential.box_list || '';

    // 检查是否为胁迫码 (type=9)
    const duressCredential = credentials.find(c => c.type === 9);
    if (duressCredential && duressCredential.content === password) {
      // 触发胁迫报警（静默）
      console.log(`[Auth] ⚠️ 胁迫码触发: ${identityId}`);

      // 发送胁迫告警到 IAMS
      try {
        await sendWarnEvent({
          credentialId: duressCredential.credential_id,
          warnContent: '胁迫码报警'
        });
        console.log(`[Auth] ✅ 胁迫告警已发送`);
      } catch (err) {
        console.error(`[Auth] ❌ 发送胁迫告警失败:`, err);
      }

      // 表面显示成功（胁迫码视为正确密码）
      return NextResponse.json({
        success: true,
        isDuress: true,
        message: '验证成功',
        personName,
        boxList,
        credentialId: duressCredential.credential_id,
      });
    }

    // 检查正常密码 (type=5)
    const passwordCredential = credentials.find(c => c.type === 5);
    if (passwordCredential && passwordCredential.content === password) {
      return NextResponse.json({
        success: true,
        isDuress: false,
        message: '验证成功',
        personName,
        boxList,
        credentialId: passwordCredential.credential_id,
      });
    }

    // 密码错误
    return NextResponse.json({
      success: false,
      message: '密码错误',
    }, { status: 401 });

  } catch (error) {
    console.error('密码验证失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : '验证失败',
      },
      { status: 500 }
    );
  }
}
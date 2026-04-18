/**
 * 虹膜识别结果验证 API
 * POST /api/device/iris/verify
 * 接收虹膜设备返回的识别记录，将用户输入的明文 identityId 加密后与设备返回的 staffNum 比对
 *
 * 关键：设备返回的 staffNum 是 IAMS 下发的加密值，必须用加密后的 identityId 比对
 */

import { NextResponse } from 'next/server';
import { initDatabase, findByUserCode } from '@/lib/database';
import { isAesEnabled } from '@/lib/settings';
import { aesEncrypt } from '@/lib/crypto';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { identityId, records } = body;

    if (!identityId || !records || !Array.isArray(records)) {
      return NextResponse.json({
        success: false,
        error: '缺少参数',
      }, { status: 400 });
    }

    await initDatabase();

    // 将明文 identityId 加密
    const encryptedIdentityId = isAesEnabled() ? aesEncrypt(identityId.trim()) : identityId.trim();

    console.log(`[IrisVerify] 明文 identityId: ${identityId.trim()}`);
    console.log(`[IrisVerify] AES 启用: ${isAesEnabled()}`);
    console.log(`[IrisVerify] 加密后 identityId: ${encryptedIdentityId}`);

    // 验证用户是否存在
    const userData = await findByUserCode(encryptedIdentityId);
    if (!userData) {
      return NextResponse.json({
        success: false,
        match: false,
        message: '用户不存在',
      });
    }

    // 遍历设备返回的记录，用加密后的值比对
    let matched = false;
    let matchedPersonName = '';
    let matchedCredentialId = 0;

    for (const record of records) {
      console.log(`[IrisVerify] 记录 staffNum: ${record.staffNum}, success: ${record.success}, type: ${record.type}`);
      if (record.success && record.type === 1) {
        if (record.staffNum === encryptedIdentityId) {
          matched = true;
          matchedPersonName = userData.personName;
          // 查询凭证ID
          const db = (await import('@/lib/database')).getDatabase();
          const credResult = await db.execute({
            sql: 'SELECT credential_id FROM credentials WHERE person_id = ? AND enable = 1 AND type = 7 LIMIT 1',
            args: [encryptedIdentityId],
          });
          matchedCredentialId = credResult.rows[0]?.credential_id as number || 0;
          break;
        }
      }
    }

    console.log(`[IrisVerify] 比对结果: ${matched ? '匹配' : '不匹配'}`);

    return NextResponse.json({
      success: true,
      match: matched,
      personName: matchedPersonName,
      credentialId: matchedCredentialId,
    });

  } catch (error) {
    console.error('[IrisVerify] 异常:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

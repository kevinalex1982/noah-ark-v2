/**
 * 获取用户的认证方式列表
 * GET /api/auth/types?identityId=xxx
 *
 * 返回实际存在的凭证类型，与 authTypeList 取交集
 * 排除胁迫码(type=9)，胁迫码不参与认证界面显示
 */

import { NextResponse } from 'next/server';
import { initDatabase, getDatabase, findByUserCode } from '@/lib/database';

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

    // 初始化数据库
    await initDatabase();

    // 从数据库查询用户编码
    const userData = await findByUserCode(identityId);

    if (!userData) {
      return NextResponse.json(
        {
          success: false,
          message: '库中无此用户编码信息',
          code: 'IDENTITY_NOT_FOUND'
        },
        { status: 404 }
      );
    }

    // 查询该用户实际存在的凭证类型
    const db = getDatabase();
    const result = await db.execute({
      sql: 'SELECT DISTINCT type FROM credentials WHERE person_id = ? AND enable = 1',
      args: [identityId]
    });

    // 实际凭证类型列表
    const actualCredentialTypes = result.rows.map(row => row.type as number);

    // authTypeList 配置
    const authTypeListConfig = userData.authTypeList;

    // 有效认证类型 = authTypeList ∩ 实际凭证类型
    // 排除胁迫码(type=9)，它不参与显示判断
    const validAuthTypes = authTypeListConfig.filter(type =>
      type !== 9 && actualCredentialTypes.includes(type)
    );

    // 检查是否有胁迫码凭证（用于密码认证时判断）
    const hasDuressCode = actualCredentialTypes.includes(9);

    console.log(`[AuthTypes] 用户 ${identityId}:`);
    console.log(`  - authTypeList配置: ${authTypeListConfig.join(',')}`);
    console.log(`  - 实际凭证类型: ${actualCredentialTypes.join(',')}`);
    console.log(`  - 有效认证类型: ${validAuthTypes.join(',')}`);
    console.log(`  - 有胁迫码: ${hasDuressCode}`);

    return NextResponse.json({
      success: true,
      data: {
        identityId: userData.personId,
        personId: userData.personId,
        personName: userData.personName,
        authTypes: validAuthTypes,           // 有效认证类型（用于界面显示）
        actualCredentialTypes: actualCredentialTypes,  // 实际凭证类型
        hasDuressCode: hasDuressCode,        // 是否有胁迫码
        authModel: 2, // 默认认证模型
      },
    });

  } catch (error) {
    console.error('获取认证方式失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : '获取认证方式失败',
      },
      { status: 500 }
    );
  }
}
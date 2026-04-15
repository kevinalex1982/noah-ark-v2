/**
 * AES 解密 API（仅用于凭证列表双击查看明文测试）
 * POST /api/auth/decrypt
 * 参数: ciphertext (密文)
 * 返回: plaintext (明文)
 *
 * 注意：只有当 AES 加密启用时才可用
 */

import { NextResponse } from 'next/server';
import { isAesEnabled } from '@/lib/settings';
import { aesDecrypt } from '@/lib/crypto';

export async function POST(request: Request) {
  try {
    if (!isAesEnabled()) {
      return NextResponse.json(
        { success: false, message: 'AES加密未启用，无需解密' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { ciphertext } = body;

    if (!ciphertext || typeof ciphertext !== 'string') {
      return NextResponse.json(
        { success: false, message: '缺少密文参数' },
        { status: 400 }
      );
    }

    try {
      const plaintext = aesDecrypt(ciphertext);
      return NextResponse.json({
        success: true,
        plaintext,
      });
    } catch (error) {
      return NextResponse.json(
        { success: false, message: '解密失败，密文可能无效' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('解密失败:', error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : '解密失败' },
      { status: 500 }
    );
  }
}

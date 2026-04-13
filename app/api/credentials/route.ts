/**
 * 凭证管理 API
 * GET /api/credentials - 获取凭证列表（分页）
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getAllCredentials, getCredentialCount, type CredentialType } from '@/lib/db-credentials';

export async function GET(request: NextRequest) {
  try {
    await initDatabase();

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') ? parseInt(searchParams.get('type')!) as CredentialType : undefined;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '15', 10);

    const offset = (page - 1) * pageSize;
    const credentials = await getAllCredentials({ type, limit: pageSize, offset });
    const total = await getCredentialCount(type);
    const totalPages = Math.ceil(total / pageSize);

    return NextResponse.json({
      success: true,
      credentials,
      total,
      page,
      pageSize,
      totalPages,
    });
  } catch (error: any) {
    console.error('[Credentials] 获取凭证列表失败:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
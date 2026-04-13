/**
 * 通行记录 API
 * GET: 获取通行记录（分页）
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase, getDatabase } from '@/lib/database';

export async function GET(request: NextRequest) {
  try {
    // 确保数据库已初始化
    await initDatabase();

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '15', 10);
    const date = searchParams.get('date'); // 格式: YYYY-MM-DD

    const db = getDatabase();

    // 构建查询条件
    let whereClause = '';
    const params: any[] = [];

    if (date) {
      whereClause = "WHERE date(created_at) = ?";
      params.push(date);
    }

    // 获取总数
    const countResult = await db.execute({
      sql: `SELECT COUNT(*) as count FROM pass_logs ${whereClause}`,
      args: params,
    });
    const total = countResult.rows[0]?.count as number || 0;
    const totalPages = Math.ceil(total / pageSize);

    // 获取分页数据
    const offset = (page - 1) * pageSize;
    const result = await db.execute({
      sql: `SELECT * FROM pass_logs ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`,
      args: [...params, pageSize, offset],
    });

    const logs = result.rows.map(row => ({
      id: row.id as number,
      person_id: row.person_id as string,
      credential_id: row.credential_id as number,
      auth_type: row.auth_type as string,
      auth_result: row.auth_result as number,
      device_id: row.device_id as string,
      iams_response: row.iams_response as number,
      iams_code: row.iams_code as number | undefined,
      iams_msg: row.iams_msg as string | undefined,
      created_at: row.created_at as string,
    }));

    return NextResponse.json({
      success: true,
      logs,
      total,
      page,
      pageSize,
      totalPages,
    });

  } catch (error) {
    console.error('获取通行记录失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '获取失败',
    }, { status: 500 });
  }
}
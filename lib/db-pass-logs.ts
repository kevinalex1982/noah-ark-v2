/**
 * 通行记录数据库操作
 * 使用 @libsql/client API
 */

import { Client } from '@libsql/client';
import { getDatabase } from './database';
import { getMaxPassLogs } from './settings';

// 通行记录接口
export interface PassLog {
  id?: number;
  person_id: string;
  credential_id: number;
  auth_type: string;        // 认证类型，如 "7" 或 "5,7"（组合）
  auth_result: number;      // 1=成功, 2=失败
  device_id: string;
  request_id: string;
  iams_response: number;    // 0=未响应, 1=成功, 2=失败
  iams_code?: number;
  iams_msg?: string;
  created_at?: string;
}

/**
 * 清理过多的通行记录
 * 保留最新的 maxCount 条
 */
async function cleanupOldPassLogs(db: Client, maxCount: number): Promise<void> {
  const countResult = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM pass_logs',
    args: [],
  });

  const count = countResult.rows[0]?.count as number || 0;

  if (count > maxCount) {
    const deleteCount = count - maxCount;
    await db.execute({
      sql: `DELETE FROM pass_logs WHERE id IN (SELECT id FROM pass_logs ORDER BY id ASC LIMIT ?)`,
      args: [deleteCount],
    });
    console.log(`[PassLog] 清理了 ${deleteCount} 条旧通行记录`);
  }
}

/**
 * 获取东八区时间的ISO字符串
 */
function getBeijingTime(): string {
  const now = new Date();
  // 东八区 = UTC+8
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return beijingTime.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/**
 * 插入通行记录
 */
export async function insertPassLog(log: Omit<PassLog, 'id' | 'iams_response' | 'created_at'>): Promise<number> {
  const db = getDatabase();
  const maxCount = getMaxPassLogs();

  // 先清理过多记录
  await cleanupOldPassLogs(db, maxCount);

  // 使用东八区时间
  const beijingTime = getBeijingTime();

  const result = await db.execute({
    sql: `INSERT INTO pass_logs (person_id, credential_id, auth_type, auth_result, device_id, request_id, iams_response, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    args: [
      log.person_id,
      log.credential_id,
      log.auth_type,
      log.auth_result,
      log.device_id,
      log.request_id,
      beijingTime,
    ],
  });

  const id = result.rows[0]?.id as number || Number(result.lastInsertRowid);
  console.log(`[PassLog] 插入通行记录: id=${id}, personId=${log.person_id}, authType=${log.auth_type}`);
  return id;
}

/**
 * 更新IAMS响应
 */
export async function updateIamsResponse(id: number, code: number, msg: string): Promise<void> {
  const db = getDatabase();

  const iamsResponse = code === 200 ? 1 : 2;

  await db.execute({
    sql: `UPDATE pass_logs SET iams_response = ?, iams_code = ?, iams_msg = ? WHERE id = ?`,
    args: [iamsResponse, code, msg, id],
  });
  console.log(`[PassLog] 更新IAMS响应: id=${id}, code=${code}`);
}

/**
 * 获取通行记录
 */
export async function getPassLogById(id: number): Promise<PassLog | null> {
  const db = getDatabase();

  const result = await db.execute({
    sql: 'SELECT * FROM pass_logs WHERE id = ?',
    args: [id],
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id as number,
    person_id: row.person_id as string,
    credential_id: row.credential_id as number,
    auth_type: row.auth_type as string,
    auth_result: row.auth_result as number,
    device_id: row.device_id as string,
    request_id: row.request_id as string,
    iams_response: row.iams_response as number,
    iams_code: row.iams_code as number | undefined,
    iams_msg: row.iams_msg as string | undefined,
    created_at: row.created_at as string,
  };
}

/**
 * 获取未收到IAMS响应的记录
 */
export async function getUnrespondedPassLogs(): Promise<PassLog[]> {
  const db = getDatabase();

  const result = await db.execute({
    sql: 'SELECT * FROM pass_logs WHERE iams_response = 0 ORDER BY id ASC',
    args: [],
  });

  return result.rows.map(row => ({
    id: row.id as number,
    person_id: row.person_id as string,
    credential_id: row.credential_id as number,
    auth_type: row.auth_type as string,
    auth_result: row.auth_result as number,
    device_id: row.device_id as string,
    request_id: row.request_id as string,
    iams_response: row.iams_response as number,
    iams_code: row.iams_code as number | undefined,
    iams_msg: row.iams_msg as string | undefined,
    created_at: row.created_at as string,
  }));
}

/**
 * 检查最近 N 秒内是否存在相同 person_id + credential_id + auth_type 的记录
 * 用于去重
 */
export async function getRecentPassLogByPerson(
  personId: string,
  credentialId: number,
  authType: string,
  seconds: number = 5
): Promise<boolean> {
  const db = getDatabase();

  const result = await db.execute({
    sql: `SELECT COUNT(*) as count FROM pass_logs
          WHERE person_id = ? AND credential_id = ? AND auth_type = ?
          AND created_at > datetime('now', '+8 hours', '-' || ? || ' seconds')`,
    args: [personId, credentialId, authType, seconds],
  });

  const count = result.rows[0]?.count as number || 0;
  return count > 0;
}

/**
 * 获取最近的通行记录
 */
export async function getRecentPassLogs(limit: number = 50): Promise<PassLog[]> {
  const db = getDatabase();

  const result = await db.execute({
    sql: 'SELECT * FROM pass_logs ORDER BY id DESC LIMIT ?',
    args: [limit],
  });

  return result.rows.map(row => ({
    id: row.id as number,
    person_id: row.person_id as string,
    credential_id: row.credential_id as number,
    auth_type: row.auth_type as string,
    auth_result: row.auth_result as number,
    device_id: row.device_id as string,
    request_id: row.request_id as string,
    iams_response: row.iams_response as number,
    iams_code: row.iams_code as number | undefined,
    iams_msg: row.iams_msg as string | undefined,
    created_at: row.created_at as string,
  }));
}

/**
 * 获取通行记录总数
 */
export async function getPassLogCount(): Promise<number> {
  const db = getDatabase();
  const result = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM pass_logs',
    args: [],
  });
  return result.rows[0]?.count as number || 0;
}

/**
 * 清空所有通行记录
 */
export async function clearAllPassLogs(): Promise<void> {
  const db = getDatabase();
  await db.execute({
    sql: 'DELETE FROM pass_logs',
    args: [],
  });
  console.log('[PassLog] 已清空所有通行记录');
}
/**
 * 胁迫码数据访问模块（核心安全功能）
 * 
 * 胁迫码逻辑：
 * 1. 每个人员可以设置一个胁迫码
 * 2. 输入胁迫码时，表面认证成功，后台触发告警
 * 3. authResult=9, is_duress=1
 */

import { getDatabase } from './database';

// 胁迫码对象
export interface DuressCode {
  id: string;
  person_id: string;
  code: string;
  is_active: number; // 0 或 1
  created_at: string;
}

/**
 * 设置胁迫码（通过姓名）
 */
export async function setDuressCodeByName(name: string, code: string): Promise<DuressCode> {
  const db = getDatabase();
  const now = new Date().toISOString();
  
  // 1. 查询人员
  const personResult = await db.execute({
    sql: 'SELECT id FROM persons WHERE name = ?',
    args: [name]
  });
  
  let personId: string;
  
  if (personResult.rows.length === 0) {
    // 人员不存在，先创建
    personId = `person_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await db.execute({
      sql: `INSERT INTO persons (id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      args: [personId, name, now, now]
    });
  } else {
    personId = personResult.rows[0].id as string;
  }
  
  // 2. 删除旧的胁迫码（一个人员只能有一个）
  await db.execute({
    sql: 'DELETE FROM duress_codes WHERE person_id = ?',
    args: [personId]
  });
  
  // 3. 插入新的胁迫码
  const id = `duress_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  await db.execute({
    sql: `INSERT INTO duress_codes (id, person_id, code, is_active, created_at)
     VALUES (?, ?, ?, 1, ?)`,
    args: [id, personId, code, now]
  });
  
  return {
    id,
    person_id: personId,
    code,
    is_active: 1,
    created_at: now,
  };
}

/**
 * 验证胁迫码（通过姓名）
 * @returns 返回胁迫码对象（如果匹配），否则返回 null
 */
export async function verifyDuressCodeByName(name: string, code: string): Promise<DuressCode | null> {
  const db = getDatabase();
  
  // 1. 查询人员 ID
  const personResult = await db.execute({
    sql: 'SELECT id FROM persons WHERE name = ?',
    args: [name]
  });
  
  if (personResult.rows.length === 0) {
    return null;
  }
  
  const personId = personResult.rows[0].id as string;
  
  // 2. 验证胁迫码
  const result = await db.execute({
    sql: `SELECT * FROM duress_codes 
     WHERE person_id = ? AND code = ? AND is_active = 1`,
    args: [personId, code]
  });
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return rowToDuressCode(result.rows[0]);
}

/**
 * 查询人员的胁迫码
 */
export async function getDuressCodeByName(name: string): Promise<DuressCode | null> {
  const db = getDatabase();
  
  // 1. 查询人员 ID
  const personResult = await db.execute({
    sql: 'SELECT id FROM persons WHERE name = ?',
    args: [name]
  });
  
  if (personResult.rows.length === 0) {
    return null;
  }
  
  const personId = personResult.rows[0].id as string;
  
  // 2. 查询胁迫码
  const result = await db.execute({
    sql: 'SELECT * FROM duress_codes WHERE person_id = ?',
    args: [personId]
  });
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return rowToDuressCode(result.rows[0]);
}

/**
 * 停用胁迫码
 */
export async function deactivateDuressCodeByName(name: string): Promise<boolean> {
  const db = getDatabase();
  
  const personResult = await db.execute({
    sql: 'SELECT id FROM persons WHERE name = ?',
    args: [name]
  });
  
  if (personResult.rows.length === 0) {
    return false;
  }
  
  const personId = personResult.rows[0].id as string;
  
  await db.execute({
    sql: 'UPDATE duress_codes SET is_active = 0 WHERE person_id = ?',
    args: [personId]
  });
  
  return true;
}

/**
 * 删除胁迫码
 */
export async function deleteDuressCodeByName(name: string): Promise<boolean> {
  const db = getDatabase();
  
  const personResult = await db.execute({
    sql: 'SELECT id FROM persons WHERE name = ?',
    args: [name]
  });
  
  if (personResult.rows.length === 0) {
    return false;
  }
  
  const personId = personResult.rows[0].id as string;
  
  await db.execute({
    sql: 'DELETE FROM duress_codes WHERE person_id = ?',
    args: [personId]
  });
  
  return true;
}

/**
 * 获取所有胁迫记录（用于管理后台）
 */
export async function getAllDuressLogs(): Promise<any[]> {
  const db = getDatabase();
  
  const result = await db.execute({
    sql: `SELECT 
      al.id,
      al.person_id,
      p.name as person_name,
      al.device_id,
      al.auth_type,
      al.result,
      al.is_duress,
      al.timestamp,
      al.metadata
    FROM auth_logs al
    LEFT JOIN persons p ON al.person_id = p.id
    WHERE al.is_duress = 1
    ORDER BY al.timestamp DESC`
  });
  
  return result.rows.map(row => {
    const log: any = {};
    Object.keys(row).forEach(key => {
      log[key] = row[key];
    });
    return log;
  });
}

/**
 * 将数据库行转换为胁迫码对象
 */
function rowToDuressCode(row: Record<string, any>): DuressCode {
  return {
    id: row.id as string,
    person_id: row.person_id as string,
    code: row.code as string,
    is_active: row.is_active as number,
    created_at: row.created_at as string,
  };
}

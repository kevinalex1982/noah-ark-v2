/**
 * 用户数据访问模块
 */

import { getDatabase } from './database';
import type { User } from './db-types';

/**
 * 创建用户
 */
export async function createUser(user: Omit<User, 'id' | 'created_at' | 'updated_at'>): Promise<User> {
  const db = getDatabase();
  
  const id = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date().toISOString();
  
  await db.execute({
    sql: `INSERT INTO users (id, employee_id, name, department, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, user.employee_id, user.name, user.department || null, user.position || null, now, now]
  });
  
  return {
    ...user,
    id,
    created_at: now,
    updated_at: now,
  };
}

/**
 * 根据员工 ID 查询用户
 */
export async function getUserByEmployeeId(employeeId: string): Promise<User | null> {
  const db = getDatabase();
  
  const result = await db.execute({
    sql: 'SELECT * FROM users WHERE employee_id = ?',
    args: [employeeId]
  });
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return rowToUser(result.rows[0]);
}

/**
 * 根据用户 ID 查询用户
 */
export async function getUserById(userId: string): Promise<User | null> {
  const db = getDatabase();
  
  const result = await db.execute({
    sql: 'SELECT * FROM users WHERE id = ?',
    args: [userId]
  });
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return rowToUser(result.rows[0]);
}

/**
 * 查询所有用户
 */
export async function getAllUsers(): Promise<User[]> {
  const db = getDatabase();
  
  const result = await db.execute({
    sql: 'SELECT * FROM users ORDER BY created_at DESC'
  });
  
  return result.rows.map(row => rowToUser(row));
}

/**
 * 更新用户
 */
export async function updateUser(userId: string, updates: Partial<User>): Promise<User | null> {
  const db = getDatabase();
  const now = new Date().toISOString();
  
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.name) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.department !== undefined) {
    fields.push('department = ?');
    values.push(updates.department);
  }
  if (updates.position !== undefined) {
    fields.push('position = ?');
    values.push(updates.position);
  }
  
  if (fields.length === 0) {
    return getUserById(userId);
  }
  
  fields.push('updated_at = ?');
  values.push(now);
  values.push(userId);
  
  await db.execute({
    sql: `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
    args: values
  });
  
  return getUserById(userId);
}

/**
 * 删除用户
 */
export async function deleteUser(userId: string): Promise<boolean> {
  const db = getDatabase();
  
  await db.execute({
    sql: 'DELETE FROM users WHERE id = ?',
    args: [userId]
  });
  await db.execute({
    sql: 'DELETE FROM biometric_credentials WHERE user_id = ?',
    args: [userId]
  });
  await db.execute({
    sql: 'DELETE FROM duress_codes WHERE user_id = ?',
    args: [userId]
  });
  
  return true;
}

/**
 * 将数据库行转换为用户对象
 */
function rowToUser(row: Record<string, any>): User {
  return {
    id: row.id as string,
    employee_id: row.employee_id as string,
    name: row.name as string,
    department: row.department as string | undefined,
    position: row.position as string | undefined,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

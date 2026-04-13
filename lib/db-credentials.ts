/**
 * 凭证数据访问模块
 * 完全按照 Next.js 后端设计文档 v5.0 实现
 */

import { getDatabase } from './database';

export type CredentialType = 1 | 5 | 7 | 8 | 9; // 1=人脸，5=密码，7=虹膜，8=掌纹，9=胁迫码

export interface Credential {
  id: number;
  person_id: string;        // 用户编码
  person_name: string;
  person_type: string;
  credential_id: number;
  type: CredentialType;
  content: string | null;
  iris_left_image: string | null;
  iris_right_image: string | null;
  palm_feature: string | null;
  show_info: string | null;
  tags: string | null;
  auth_model: number;
  auth_type_list: string | null;
  box_list: string | null;
  custom_id: string | null;  // 自定义ID（掌纹设备的userId等）
  enable: number;
  created_at: string;
  updated_at: string;
}

/**
 * 创建或更新凭证（upsert）
 * 支持存储所有字段，确保数据完整性
 */
export async function upsertCredential(data: {
  person_id: string;
  person_name: string;
  person_type?: string;
  credential_id: number;
  type: CredentialType;
  content?: string;
  iris_left_image?: string;
  iris_right_image?: string;
  palm_feature?: string;
  show_info?: string;
  tags?: string;
  auth_model?: number;
  auth_type_list?: string;
  box_list?: string;
  custom_id?: string;  // 自定义ID（掌纹设备的userId等）
  enable?: number;     // 启用状态
}): Promise<Credential> {
  const db = getDatabase();
  const now = new Date().toISOString();

  // 检查是否已存在
  const existing = await db.execute({
    sql: 'SELECT id FROM credentials WHERE credential_id = ?',
    args: [data.credential_id]
  });

  if (existing.rows.length > 0) {
    // 更新现有凭证 - 更新所有字段
    await db.execute({
      sql: `UPDATE credentials SET
        person_id = ?,
        person_name = ?,
        person_type = ?,
        type = ?,
        content = ?,
        iris_left_image = ?,
        iris_right_image = ?,
        palm_feature = ?,
        show_info = ?,
        tags = ?,
        auth_model = ?,
        auth_type_list = ?,
        box_list = ?,
        custom_id = ?,
        enable = ?,
        updated_at = ?
      WHERE credential_id = ?`,
      args: [
        data.person_id,
        data.person_name,
        data.person_type || 'n',
        data.type,
        data.content || null,
        data.iris_left_image || null,
        data.iris_right_image || null,
        data.palm_feature || null,
        data.show_info || null,
        data.tags || null,
        data.auth_model || 1,
        data.auth_type_list || null,
        data.box_list || null,
        data.custom_id || null,
        data.enable ?? 1,
        now,
        data.credential_id
      ]
    });

    return (await getCredentialById(data.credential_id))!;
  } else {
    // 创建新凭证 - 插入所有字段
    await db.execute({
      sql: `INSERT INTO credentials (
        person_id, person_name, person_type, credential_id, type,
        content, iris_left_image, iris_right_image, palm_feature, show_info, tags,
        auth_model, auth_type_list, box_list, custom_id, enable,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        data.person_id,
        data.person_name,
        data.person_type || 'n',
        data.credential_id,
        data.type,
        data.content || null,
        data.iris_left_image || null,
        data.iris_right_image || null,
        data.palm_feature || null,
        data.show_info || null,
        data.tags || null,
        data.auth_model || 1,
        data.auth_type_list || null,
        data.box_list || null,
        data.custom_id || null,
        data.enable ?? 1,
        now,
        now
      ]
    });

    return (await getCredentialById(data.credential_id))!;
  }
}

/**
 * 通过 credential_id 查询凭证
 */
export async function getCredentialById(credentialId: number): Promise<Credential | null> {
  const db = getDatabase();
  const result = await db.execute({
    sql: 'SELECT * FROM credentials WHERE credential_id = ?',
    args: [credentialId]
  });
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return rowToCredential(result.rows[0]);
}

/**
 * 通过 person_id 查询某人的所有凭证
 */
export async function getCredentialsByPersonId(personId: string): Promise<Credential[]> {
  const db = getDatabase();
  const result = await db.execute({
    sql: 'SELECT * FROM credentials WHERE person_id = ? AND enable = 1',
    args: [personId]
  });

  return result.rows.map(row => rowToCredential(row));
}

/**
 * 通过 person_id 查询某人的第一个凭证（用于删除时查找）
 */
export async function getCredentialByPersonId(personId: string): Promise<Credential | null> {
  const db = getDatabase();
  const result = await db.execute({
    sql: 'SELECT * FROM credentials WHERE person_id = ? LIMIT 1',
    args: [personId]
  });

  if (result.rows.length === 0) {
    return null;
  }

  return rowToCredential(result.rows[0]);
}

/**
 * 通过 custom_id 查询凭证（用于掌纹识别）
 * custom_id 存储掌纹设备上的 userId
 */
export async function getCredentialByCustomId(customId: string): Promise<Credential | null> {
  const db = getDatabase();
  const result = await db.execute({
    sql: 'SELECT * FROM credentials WHERE custom_id = ? AND enable = 1 LIMIT 1',
    args: [customId]
  });

  if (result.rows.length === 0) {
    return null;
  }

  return rowToCredential(result.rows[0]);
}

/**
 * 通过 person_name 查询某人
 */
export async function getPersonByName(personName: string): Promise<{ person_id: string; credentials: Credential[] } | null> {
  const db = getDatabase();
  
  // 先查询人员
  const result = await db.execute({
    sql: 'SELECT person_id, person_name FROM credentials WHERE person_name = ? LIMIT 1',
    args: [personName]
  });
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const personId = result.rows[0].person_id as string;
  const credentials = await getCredentialsByPersonId(personId);
  
  return {
    person_id: personId,
    credentials,
  };
}

/**
 * 删除凭证
 */
export async function deleteCredential(credentialId: number): Promise<boolean> {
  const db = getDatabase();
  await db.execute({
    sql: 'DELETE FROM credentials WHERE credential_id = ?',
    args: [credentialId]
  });
  return true;
}

/**
 * 获取所有凭证（分页）
 */
export async function getAllCredentials(options?: {
  limit?: number;
  offset?: number;
  type?: CredentialType;
}): Promise<Credential[]> {
  const db = getDatabase();
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;

  let sql = 'SELECT * FROM credentials WHERE enable = 1';
  const args: any[] = [];

  if (options?.type) {
    sql += ' AND type = ?';
    args.push(options.type);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  args.push(limit, offset);

  const result = await db.execute({ sql, args });
  return result.rows.map(row => rowToCredential(row));
}

/**
 * 获取凭证总数
 */
export async function getCredentialCount(type?: CredentialType): Promise<number> {
  const db = getDatabase();

  let sql = 'SELECT COUNT(*) as count FROM credentials WHERE enable = 1';
  const args: any[] = [];

  if (type) {
    sql += ' AND type = ?';
    args.push(type);
  }

  const result = await db.execute({ sql, args });
  return result.rows[0].count as number;
}

/**
 * 更新凭证的 show_info
 */
export async function updateCredentialShowInfo(
  credentialId: number,
  showInfo: string
): Promise<boolean> {
  const db = getDatabase();
  const now = new Date().toISOString();

  const result = await db.execute({
    sql: 'UPDATE credentials SET show_info = ?, updated_at = ? WHERE credential_id = ?',
    args: [showInfo, now, credentialId]
  });

  return result.rowsAffected > 0;
}

/**
 * 更新凭证的姓名（需要同步到设备）
 */
export async function updateCredentialName(
  credentialId: number,
  personName: string
): Promise<boolean> {
  const db = getDatabase();
  const now = new Date().toISOString();

  const result = await db.execute({
    sql: 'UPDATE credentials SET person_name = ?, updated_at = ? WHERE credential_id = ?',
    args: [personName, now, credentialId]
  });

  return result.rowsAffected > 0;
}

/**
 * 更新凭证的多个字段
 */
export async function updateCredentialFields(
  credentialId: number,
  fields: {
    person_name?: string;
    content?: string;
    show_info?: string;
  }
): Promise<boolean> {
  const db = getDatabase();
  const now = new Date().toISOString();

  const updates: string[] = [];
  const args: any[] = [];

  if (fields.person_name !== undefined) {
    updates.push('person_name = ?');
    args.push(fields.person_name);
  }
  if (fields.content !== undefined) {
    updates.push('content = ?');
    args.push(fields.content);
  }
  if (fields.show_info !== undefined) {
    updates.push('show_info = ?');
    args.push(fields.show_info);
  }

  if (updates.length === 0) {
    return false;
  }

  updates.push('updated_at = ?');
  args.push(now);
  args.push(credentialId);

  const result = await db.execute({
    sql: `UPDATE credentials SET ${updates.join(', ')} WHERE credential_id = ?`,
    args
  });

  return result.rowsAffected > 0;
}

/**
 * 更新凭证的属性字段（用于 passport-update）
 * 只更新属性，不更新凭证内容
 */
export async function updateCredentialAttributes(
  credentialId: number,
  attributes: {
    show_info?: string;
    tags?: string;
    enable?: number;
    auth_model?: number;
    auth_type_list?: string;
    box_list?: string;
  }
): Promise<boolean> {
  const db = getDatabase();
  const now = new Date().toISOString();

  const updates: string[] = [];
  const args: any[] = [];

  if (attributes.show_info !== undefined) {
    updates.push('show_info = ?');
    args.push(attributes.show_info);
  }
  if (attributes.tags !== undefined) {
    updates.push('tags = ?');
    args.push(attributes.tags);
  }
  if (attributes.enable !== undefined) {
    updates.push('enable = ?');
    args.push(attributes.enable);
  }
  if (attributes.auth_model !== undefined) {
    updates.push('auth_model = ?');
    args.push(attributes.auth_model);
  }
  if (attributes.auth_type_list !== undefined) {
    updates.push('auth_type_list = ?');
    args.push(attributes.auth_type_list);
  }
  if (attributes.box_list !== undefined) {
    updates.push('box_list = ?');
    args.push(attributes.box_list);
  }

  if (updates.length === 0) {
    console.log(`[DB] 更新凭证属性: 没有需要更新的字段`);
    return false;
  }

  updates.push('updated_at = ?');
  args.push(now);
  args.push(credentialId);

  console.log(`[DB] 更新凭证属性: credentialId=${credentialId}, 字段=${updates.join(', ')}`);

  const result = await db.execute({
    sql: `UPDATE credentials SET ${updates.join(', ')} WHERE credential_id = ?`,
    args
  });

  return result.rowsAffected > 0;
}

/**
 * 清空所有凭证（用于 reset-passport）
 */
export async function clearAllCredentials(): Promise<number> {
  const db = getDatabase();

  // 先获取数量
  const countResult = await db.execute('SELECT COUNT(*) as count FROM credentials');
  const count = countResult.rows[0]?.count as number || 0;

  // 清空表
  await db.execute('DELETE FROM credentials');

  console.log(`[DB] 已清空所有凭证，共 ${count} 条`);

  return count;
}

/**
 * 将数据库行转换为 Credential 对象
 */
function rowToCredential(row: Record<string, any>): Credential {
  return {
    id: row.id as number,
    person_id: row.person_id as string,
    person_name: row.person_name as string,
    person_type: row.person_type as string,
    credential_id: row.credential_id as number,
    type: row.type as CredentialType,
    content: row.content as string | null,
    iris_left_image: row.iris_left_image as string | null,
    iris_right_image: row.iris_right_image as string | null,
    palm_feature: row.palm_feature as string | null,
    show_info: row.show_info as string | null,
    tags: row.tags as string | null,
    auth_model: row.auth_model as number,
    auth_type_list: row.auth_type_list as string | null,
    box_list: row.box_list as string | null,
    custom_id: row.custom_id as string | null,
    enable: row.enable as number,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

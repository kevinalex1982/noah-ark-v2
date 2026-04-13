/**
 * 同步队列数据库模块
 * 管理 sync_queue 和 sync_logs 表
 */

import { getDatabase } from './database';

// 同步状态
// pending: 待处理
// processing: 处理中
// success: 成功
// failed: 失败（不再重试）
// retrying: 持续尝试下发
// stopped: 已停止（用户手动停止）
// offline: 设备离线，等待上线后重试
export type SyncStatus = 'pending' | 'processing' | 'success' | 'failed' | 'retrying' | 'stopped' | 'offline';

// 同步队列项
export interface SyncQueueItem {
  id: number;
  message_id: string;
  device_id: string;
  credential_id?: number;
  action: string;
  payload: string;
  status: SyncStatus;
  retry_count: number;
  max_retries: number;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

// 同步日志
export interface SyncLog {
  id: number;
  queue_id: number;
  credential_id?: number;
  device_id: string;
  action: string;
  status: SyncStatus;
  response?: string;
  error_message?: string;
  duration_ms: number;
  created_at: string;
}

// 设备配置
export interface DeviceConfig {
  device_id: string;
  device_name: string;
  device_type: 'iris' | 'palm';
  endpoint: string;
  online: boolean;
  last_heartbeat?: string;
}

// 默认设备配置
export const DEFAULT_DEVICES: DeviceConfig[] = [
  {
    device_id: 'iris-device-001',
    device_name: '虹膜设备 1',
    device_type: 'iris',
    endpoint: 'http://192.168.3.202:9003',
    online: false,
  },
  {
    device_id: 'palm-device-001',
    device_name: '掌纹设备 1',
    device_type: 'palm',
    endpoint: 'http://127.0.0.1:8080',
    online: false,
  },
];

/**
 * 初始化同步相关表
 * 注意：表已在 database.ts 的 initTables 中创建，这里只确保索引存在
 */
export async function initSyncTables(): Promise<void> {
  const db = getDatabase();

  // 只创建额外索引（表已由 database.ts 创建）
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sync_logs_queue_id ON sync_logs(queue_id)`);
}

/**
 * 添加同步队列项
 * 如果相同 credential_id 已存在且状态为 retrying，则更新而非新增
 */
export async function addToSyncQueue(item: {
  message_id: string;
  device_id: string;
  credential_id?: number;
  action: string;
  payload: object;
  max_retries?: number;
}): Promise<number> {
  const db = getDatabase();
  const now = new Date().toISOString();

  // 如果有 credential_id，检查是否已存在
  if (item.credential_id) {
    const existing = await db.execute({
      sql: `SELECT id, status FROM sync_queue WHERE credential_id = ? AND device_id = ?`,
      args: [item.credential_id, item.device_id]
    });

    if (existing.rows.length > 0) {
      const existingId = existing.rows[0].id as number;
      const existingStatus = existing.rows[0].status as string;

      // 如果状态是 retrying 或 pending 或 offline，更新该记录
      if (['retrying', 'pending', 'offline'].includes(existingStatus)) {
        await db.execute({
          sql: `UPDATE sync_queue SET
                  message_id = ?,
                  action = ?,
                  payload = ?,
                  status = 'pending',
                  retry_count = 0,
                  error_message = NULL,
                  updated_at = ?
                WHERE id = ?`,
          args: [
            item.message_id,
            item.action,
            JSON.stringify(item.payload),
            now,
            existingId
          ]
        });
        console.log(`[SyncQueue] 更新队列项 #${existingId}（credential_id: ${item.credential_id}）`);
        return existingId;
      }
    }
  }

  // 新增记录
  const result = await db.execute({
    sql: `INSERT INTO sync_queue (message_id, device_id, credential_id, action, payload, status, max_retries, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    args: [
      item.message_id,
      item.device_id,
      item.credential_id || null,
      item.action,
      JSON.stringify(item.payload),
      item.max_retries ?? 3,
      now,
      now,
    ]
  });

  console.log(`[SyncQueue] 添加队列项：${item.message_id}, 设备：${item.device_id}, 操作：${item.action}${item.credential_id ? `, 凭证ID: ${item.credential_id}` : ''}`);
  return Number(result.lastInsertRowid);
}

/**
 * 获取待处理的队列项
 * ⚠️ 只返回 pending 状态的项（不再自动重试）
 */
export async function getPendingQueueItems(limit: number = 50): Promise<SyncQueueItem[]> {
  const db = getDatabase();

  try {
    const result = await db.execute({
      sql: `SELECT * FROM sync_queue
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT ?`,
      args: [limit]
    });

    return result.rows.map(row => ({
      id: row.id as number,
      message_id: row.message_id as string,
      device_id: row.device_id as string,
      action: row.action as string,
      payload: row.payload as string,
      status: row.status as SyncStatus,
      retry_count: row.retry_count as number,
      max_retries: row.max_retries as number,
      error_message: row.error_message as string | undefined,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    }));
  } catch (error: any) {
    if (error?.message?.includes('no such table')) {
      return [];
    }
    throw error;
  }
}

/**
 * 更新队列项状态
 * ⚠️ 关键：失败直接标记为 failed，不再重试
 */
export async function updateQueueStatus(
  id: number,
  status: SyncStatus,
  errorMessage?: string
): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();

  // 直接更新状态，失败就是 failed，不再重试
  await db.execute({
    sql: `UPDATE sync_queue SET status = ?, error_message = ?, updated_at = ? WHERE id = ?`,
    args: [status, errorMessage || null, now, id]
  });
}

/**
 * 添加同步日志
 */
export async function addSyncLog(log: {
  queue_id: number;
  device_id: string;
  device_type?: string;  // 直接存设备类型，不依赖LEFT JOIN
  action: string;
  status: SyncStatus;
  response?: string;
  error_message?: string;
  duration_ms: number;
}): Promise<void> {
  const db = getDatabase();

  try {
    await db.execute({
      sql: `INSERT INTO sync_logs (queue_id, device_id, device_type, action, status, response, error_message, duration_ms, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        log.queue_id,
        log.device_id,
        log.device_type || null,
        log.action,
        log.status,
        log.response || null,
        log.error_message || null,
        log.duration_ms,
        new Date().toISOString(),
      ]
    });
  } catch (error: any) {
    if (error?.message?.includes('no such table') || error?.code === 'SQLITE_CONSTRAINT') {
      console.warn('[SyncQueue] 跳过日志记录:', error.message);
      return;
    }
    throw error;
  }
}

/**
 * 获取同步日志（按 queue_id 去重，只显示最新 N 条）
 * - 相同的 queue_id 只保留最新的一条记录
 * - 同时返回 sync_queue 表的当前状态（用于显示"停止下发"按钮）
 * - 默认限制返回 50 条记录
 */
export async function getSyncLogs(options: {
  device_id?: string;
  limit?: number;
  offset?: number;
}): Promise<SyncLog[]> {
  const db = getDatabase();
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  try {
    // 直接从 sync_logs 读取 device_type，不再依赖 LEFT JOIN
    let sql = `
      SELECT sl.*, sq.status as queue_status, sq.credential_id
      FROM sync_logs sl
      INNER JOIN sync_queue sq ON sl.queue_id = sq.id
      INNER JOIN (
        SELECT queue_id, MAX(created_at) as max_created_at
        FROM sync_logs
        ${options.device_id ? 'WHERE device_id = ?' : ''}
        GROUP BY queue_id
      ) latest ON sl.queue_id = latest.queue_id AND sl.created_at = latest.max_created_at
      ORDER BY sl.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const args: any[] = [];

    if (options.device_id) {
      args.push(options.device_id);
    }

    args.push(limit, offset);

    const result = await db.execute({ sql, args });

    return result.rows.map(row => ({
      id: row.id as number,
      queue_id: row.queue_id as number,
      credential_id: row.credential_id as number | undefined,
      device_id: row.device_id as string,
      device_type: row.device_type as string || 'unknown',
      action: row.action as string,
      status: (row.queue_status as SyncStatus) || (row.status as SyncStatus),
      response: row.response as string | undefined,
      error_message: row.error_message as string | undefined,
      duration_ms: row.duration_ms as number,
      created_at: row.created_at as string,
    }));
  } catch (error: any) {
    if (error?.message?.includes('no such table')) {
      return [];
    }
    throw error;
  }
}

/**
 * 获取或初始化设备配置
 */
export async function getDeviceConfigs(): Promise<DeviceConfig[]> {
  const db = getDatabase();
  
  try {
    const result = await db.execute('SELECT * FROM device_config');
    
    if (result.rows.length === 0) {
      // 初始化默认设备配置
      for (const device of DEFAULT_DEVICES) {
        await db.execute({
          sql: `INSERT INTO device_config (device_id, device_name, device_type, endpoint, online, created_at, updated_at)
                VALUES (?, ?, ?, ?, 0, ?, ?)`,
          args: [
            device.device_id,
            device.device_name,
            device.device_type,
            device.endpoint,
            new Date().toISOString(),
            new Date().toISOString(),
          ]
        });
      }
      
      return DEFAULT_DEVICES;
    }
    
    return result.rows.map(row => ({
      device_id: row.device_id as string,
      device_name: row.device_name as string,
      device_type: row.device_type as 'iris' | 'palm',
      endpoint: row.endpoint as string,
      online: row.online === 1,
      last_heartbeat: row.last_heartbeat as string | undefined,
    }));
  } catch (error: any) {
    if (error?.message?.includes('no such table')) {
      // 创建表并插入默认设备
      await db.execute(`
        CREATE TABLE IF NOT EXISTS device_config (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id VARCHAR(64) NOT NULL UNIQUE,
          device_name VARCHAR(128),
          device_type VARCHAR(16) NOT NULL,
          endpoint VARCHAR(256) NOT NULL,
          online INTEGER DEFAULT 0,
          last_heartbeat DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      for (const device of DEFAULT_DEVICES) {
        await db.execute({
          sql: `INSERT INTO device_config (device_id, device_name, device_type, endpoint, online, created_at, updated_at)
                VALUES (?, ?, ?, ?, 0, ?, ?)`,
          args: [
            device.device_id,
            device.device_name,
            device.device_type,
            device.endpoint,
            new Date().toISOString(),
            new Date().toISOString(),
          ]
        });
      }
      
      return DEFAULT_DEVICES;
    }
    throw error;
  }
}

/**
 * 更新设备在线状态
 */
export async function updateDeviceStatus(
  deviceId: string,
  online: boolean
): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  
  await db.execute({
    sql: `UPDATE device_config SET online = ?, last_heartbeat = ?, updated_at = ? WHERE device_id = ?`,
    args: [online ? 1 : 0, now, now, deviceId]
  });
}

/**
 * 检查消息是否已存在（防重复）
 */
export async function isMessageExists(messageId: string): Promise<boolean> {
  const db = getDatabase();

  try {
    const result = await db.execute({
      sql: 'SELECT id FROM sync_queue WHERE message_id = ?',
      args: [messageId]
    });

    return result.rows.length > 0;
  } catch (error: any) {
    if (error?.message?.includes('no such table')) {
      return false;
    }
    throw error;
  }
}

/**
 * 停止下发（用户手动停止）
 * 将状态改为 stopped，不再重试
 */
export async function stopSyncQueue(queueId: number): Promise<boolean> {
  const db = getDatabase();
  const now = new Date().toISOString();

  try {
    // 只能停止 retrying 状态的项
    const result = await db.execute({
      sql: `UPDATE sync_queue SET status = 'stopped', updated_at = ? WHERE id = ? AND status = 'retrying'`,
      args: [now, queueId]
    });

    if (result.rowsAffected > 0) {
      console.log(`[SyncQueue] 已停止队列项 #${queueId}`);
      return true;
    }
    return false;
  } catch (error: any) {
    console.error(`[SyncQueue] 停止队列项失败:`, error);
    return false;
  }
}

/**
 * 数据库模块 - @libsql/client (SQLite)
 * 兼容 Next.js 14 + Node.js v24
 */

import { createClient, Client } from '@libsql/client';
import path from 'path';
import fs from 'fs';

let db: Client | null = null;
let initPromise: Promise<Client> | null = null;

export async function initDatabase(): Promise<Client> {
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    let dbPath: string;

    // 优先级1: DATA_DIR（打包后由 main.ts 设置，指向 AppData）
    // 优先级2: DATABASE_PATH（旧环境变量，可能被缓存污染）
    // 优先级3: 开发模式 fallback 到项目 data/ 目录
    const dataDir = process.env.DATA_DIR;
    if (dataDir) {
      dbPath = path.join(dataDir, 'noah-ark.db');
    } else if (process.env.DATABASE_PATH) {
      dbPath = process.env.DATABASE_PATH;
    } else {
      dbPath = path.join(process.cwd(), 'data', 'noah-ark.db');
    }

    console.log(`[Database] 数据库路径: ${dbPath}`);
    console.log(`[Database] cwd: ${process.cwd()}`);
    console.log(`[Database] DATABASE_PATH env: ${process.env.DATABASE_PATH || '(未设置)'}`);
    console.log(`[Database] DATA_DIR env: ${process.env.DATA_DIR || '(未设置)'}`);

    // 确保目录存在
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log(`[Database] 创建目录: ${dbDir}`);
    }

    // 创建数据库连接
    db = createClient({
      url: `file:${dbPath}`
    });

    // 初始化表结构
    await initTables(db);

    return db;
  })();

  return initPromise;
}

async function initTables(database: Client): Promise<void> {
  // credentials 表
  await database.execute(`
    CREATE TABLE IF NOT EXISTS credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id VARCHAR(64) NOT NULL,
      person_name VARCHAR(100),
      person_type CHAR(1) DEFAULT 'n',
      credential_id BIGINT NOT NULL UNIQUE,
      type TINYINT NOT NULL,
      content TEXT,
      iris_left_image TEXT,
      iris_right_image TEXT,
      palm_feature TEXT,
      show_info TEXT,
      tags VARCHAR(255),
      auth_model TINYINT DEFAULT 1,
      auth_type_list VARCHAR(64),
      box_list VARCHAR(255),
      enable TINYINT DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 添加 show_info 列（如果不存在）
  try {
    await database.execute(`ALTER TABLE credentials ADD COLUMN show_info TEXT`);
  } catch (e: any) {
    // 列已存在，忽略错误
  }

  // 添加 tags 列（如果不存在）
  try {
    await database.execute(`ALTER TABLE credentials ADD COLUMN tags VARCHAR(255)`);
  } catch (e: any) {
    // 列已存在，忽略错误
  }

  // 添加 custom_id 列（如果不存在）
  // 用于存储设备上的自定义ID，如掌纹设备的userId
  try {
    await database.execute(`ALTER TABLE credentials ADD COLUMN custom_id VARCHAR(128)`);
  } catch (e: any) {
    // 列已存在，忽略错误
  }

  // device_config 表（设备配置）
  await database.execute(`
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
  
  // sync_queue 表（同步队列）
  await database.execute(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id VARCHAR(64) NOT NULL UNIQUE,
      device_id VARCHAR(64) NOT NULL,
      credential_id BIGINT,
      action VARCHAR(32) NOT NULL,
      payload TEXT NOT NULL,
      status VARCHAR(16) DEFAULT 'pending',
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 添加 credential_id 列（如果不存在）
  try {
    await database.execute(`ALTER TABLE sync_queue ADD COLUMN credential_id BIGINT`);
  } catch (e: any) {
    // 列已存在，忽略错误
  }
  
  // sync_logs 表（同步日志）
  await database.execute(`
    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      queue_id INTEGER NOT NULL,
      device_id VARCHAR(64) NOT NULL,
      action VARCHAR(32) NOT NULL,
      status VARCHAR(16) NOT NULL,
      response TEXT,
      error_message TEXT,
      duration_ms INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (queue_id) REFERENCES sync_queue(id)
    )
  `);
  
  // 索引
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_credentials_person ON credentials(person_id)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_credentials_type ON credentials(type)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status)`);

  // 添加 show_info 字段（如果不存在）
  try {
    await database.execute(`ALTER TABLE credentials ADD COLUMN show_info VARCHAR(255)`);
  } catch {
    // 字段已存在，忽略错误
  }
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_sync_queue_device ON sync_queue(device_id)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_sync_logs_device ON sync_logs(device_id)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_sync_logs_created ON sync_logs(created_at)`);

  // 添加 device_type 字段到 sync_logs（MQTT的device_id和device_config对不上）
  try {
    await database.execute(`ALTER TABLE sync_logs ADD COLUMN device_type VARCHAR(16)`);
  } catch {
    // 字段已存在，忽略错误
  }

  // pass_logs 表（通行记录）
  await database.execute(`
    CREATE TABLE IF NOT EXISTS pass_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id VARCHAR(64) NOT NULL,
      credential_id BIGINT NOT NULL,
      auth_type VARCHAR(32) NOT NULL,
      auth_result INTEGER DEFAULT 1,
      device_id VARCHAR(64) NOT NULL,
      request_id VARCHAR(64),
      iams_response INTEGER DEFAULT 0,
      iams_code INTEGER,
      iams_msg TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_pass_logs_created ON pass_logs(created_at)`);

  // device_attrs 表（设备配置项 - IAMS下发）
  await database.execute(`
    CREATE TABLE IF NOT EXISTS device_attrs (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      passportVer TEXT DEFAULT '',
      model INTEGER DEFAULT 1,
      doorModel INTEGER DEFAULT 1,
      passRulerList TEXT DEFAULT '[]',
      warnRulerList TEXT DEFAULT '[]',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export function getDatabase(): Client {
  if (!db) {
    throw new Error('数据库未初始化，请先调用 initDatabase()');
  }
  return db;
}

export function isDatabaseInitialized(): boolean {
  return db !== null;
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
    initPromise = null;
  }
}

/**
 * 保存数据库（对于 libsql 是空操作，因为更改会自动持久化）
 * 为了兼容旧代码而保留
 */
export function saveDatabase(): void {
  // libsql/client 自动持久化，无需手动保存
}

/**
 * 根据用户编码（person_id）查询用户信息
 * auth_type_list 取所有凭证行的并集，避免 LIMIT 1 随机取到不完整配置
 */
export async function findByUserCode(userCode: string): Promise<{
  personId: string;
  personName: string;
  authTypeList: number[];
  authModel: number;
  credentialId: number;
} | null> {
  const database = getDatabase();

  // 基本信息 + credential_id 取第一条
  const infoResult = await database.execute({
    sql: 'SELECT person_id, person_name, auth_model, credential_id FROM credentials WHERE person_id = ? AND enable = 1 LIMIT 1',
    args: [userCode]
  });

  if (infoResult.rows.length === 0) return null;

  const row = infoResult.rows[0];

  // auth_type_list = 所有凭证行的并集
  const allAuthTypesResult = await database.execute({
    sql: 'SELECT auth_type_list FROM credentials WHERE person_id = ? AND enable = 1 AND auth_type_list IS NOT NULL',
    args: [userCode]
  });

  const mergedAuthTypeSet = new Set<number>();
  for (const authRow of allAuthTypesResult.rows) {
    const list = (authRow.auth_type_list as string || '')
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n));
    list.forEach(n => mergedAuthTypeSet.add(n));
  }

  // 如果 auth_type_list 合并后为空，回退使用实际凭证类型
  const typesResult = await database.execute({
    sql: 'SELECT DISTINCT type FROM credentials WHERE person_id = ? AND enable = 1',
    args: [userCode]
  });
  const actualTypes = typesResult.rows.map(r => r.type as number);
  const authTypeList = mergedAuthTypeSet.size > 0 ? Array.from(mergedAuthTypeSet) : actualTypes;

  return {
    personId: row.person_id as string,
    personName: row.person_name as string,
    authTypeList,
    authModel: (row.auth_model as number) ?? 1,
    credentialId: (row.credential_id as number) ?? 0,
  };
}

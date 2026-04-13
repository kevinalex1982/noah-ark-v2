/**
 * 设备配置项数据库操作模块
 * 用于存储IAMS下发的配置项（只存储，不关心含义）
 */

import { getDatabase, initDatabase } from './database';

// 设备配置项类型
export interface DeviceAttrs {
  passportVer: string;      // 凭证库版本号
  model: number;            // 识别模式
  doorModel: number;        // 门禁模式
  passRulerList: any[];     // 通行规则列表
  warnRulerList: any[];     // 告警规则列表
}

// 默认配置
const DEFAULT_ATTRS: DeviceAttrs = {
  passportVer: '',
  model: 1,
  doorModel: 1,
  passRulerList: [],
  warnRulerList: [],
};

/**
 * 初始化 device_attrs 表
 */
export async function initDeviceAttrsTable(): Promise<void> {
  const db = await initDatabase();

  await db.execute(`
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

  // 确保有一行默认数据
  const result = await db.execute('SELECT COUNT(*) as count FROM device_attrs');
  const count = result.rows[0]?.count as number;

  if (count === 0) {
    await db.execute(`
      INSERT INTO device_attrs (id, passportVer, model, doorModel, passRulerList, warnRulerList)
      VALUES (1, '', 1, 1, '[]', '[]')
    `);
    console.log('[DeviceAttrs] 创建默认配置行');
  }
}

/**
 * 获取设备配置项
 */
export async function getDeviceAttrs(): Promise<DeviceAttrs> {
  await initDeviceAttrsTable();
  const db = getDatabase();

  const result = await db.execute('SELECT * FROM device_attrs WHERE id = 1');

  if (result.rows.length === 0) {
    return DEFAULT_ATTRS;
  }

  const row = result.rows[0];

  return {
    passportVer: (row.passportVer as string) || '',
    model: (row.model as number) || 1,
    doorModel: (row.doorModel as number) || 1,
    passRulerList: parseJsonArray(row.passRulerList as string),
    warnRulerList: parseJsonArray(row.warnRulerList as string),
  };
}

/**
 * 更新设备配置项
 */
export async function updateDeviceAttrs(attrs: Partial<DeviceAttrs>): Promise<void> {
  await initDeviceAttrsTable();
  const db = getDatabase();

  const current = await getDeviceAttrs();

  const newAttrs = {
    passportVer: attrs.passportVer ?? current.passportVer,
    model: attrs.model ?? current.model,
    doorModel: attrs.doorModel ?? current.doorModel,
    passRulerList: attrs.passRulerList ?? current.passRulerList,
    warnRulerList: attrs.warnRulerList ?? current.warnRulerList,
  };

  await db.execute({
    sql: `UPDATE device_attrs SET
      passportVer = ?,
      model = ?,
      doorModel = ?,
      passRulerList = ?,
      warnRulerList = ?,
      updated_at = CURRENT_TIMESTAMP
      WHERE id = 1`,
    args: [
      newAttrs.passportVer,
      newAttrs.model,
      newAttrs.doorModel,
      JSON.stringify(newAttrs.passRulerList),
      JSON.stringify(newAttrs.warnRulerList),
    ],
  });

  console.log('[DeviceAttrs] 配置已更新');
}

/**
 * 清空版本号（重置凭证库时调用）
 */
export async function clearPassportVer(): Promise<void> {
  await initDeviceAttrsTable();
  const db = getDatabase();

  await db.execute({
    sql: 'UPDATE device_attrs SET passportVer = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
    args: [''],
  });

  console.log('[DeviceAttrs] 版本号已清空');
}

/**
 * 解析JSON数组
 */
function parseJsonArray(jsonStr: string): any[] {
  if (!jsonStr) return [];

  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
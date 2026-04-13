/**
 * 设备初始化脚本
 * 在数据库为空时自动添加默认设备配置
 */

import { getDatabase } from './database';

/**
 * 初始化默认设备配置
 */
export async function initDefaultDevices(): Promise<void> {
  const db = getDatabase();
  
  try {
    // 检查是否已有设备配置
    const result = await db.execute('SELECT COUNT(*) as count FROM device_config');
    const count = Number(result.rows[0]?.count || 0);
    
    if (count > 0) {
      console.log('[Init] ✅ 设备配置已存在，跳过初始化');
      return;
    }
    
    console.log('[Init] 📦 正在初始化默认设备配置...');
    
    // 添加掌纹设备
    await db.execute(`
      INSERT INTO device_config (device_id, device_name, device_type, endpoint, online, last_heartbeat)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      'palm-001',
      '掌纹设备 1',
      'palm',
      'http://127.0.0.1:8080',
      0,
      null
    ]);
    
    // 添加虹膜设备
    await db.execute(`
      INSERT INTO device_config (device_id, device_name, device_type, endpoint, online, last_heartbeat)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      'iris-001',
      '虹膜设备 1',
      'iris',
      'http://192.168.3.202:9003',
      0,
      null
    ]);
    
    console.log('[Init] ✅ 默认设备配置已添加');
  } catch (error) {
    console.error('[Init] ❌ 初始化设备配置失败:', error);
    throw error;
  }
}

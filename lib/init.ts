/**
 * 应用初始化模块
 * 在应用启动时自动调用
 *
 * ⚠️ 所有初始化错误必须本地捕获，不能 propagate 到进程级别
 */

import { initDatabase } from './database';
import { initMqttClient } from './mqtt-client';
import { initSyncTables } from './sync-queue';
import { initDefaultDevices } from './init-devices';
import { startSyncScheduler } from './sync-scheduler';
import { startDevicePoller } from './device-poller';

let initialized = false;

/**
 * 注册全局错误处理器
 * ⚠️ 确保未捕获的错误不会搞挂进程
 */
function registerGlobalErrorHandlers(): void {
  // 未捕获的异常
  process.on('uncaughtException', (error) => {
    console.error('[全局] ❌ Uncaught Exception:', error);
    console.error('[全局] 📍 Origin:', error.stack);
    // ⚠️ 关键：不退出进程，只记录日志
    // 不要调用 process.exit()
  });

  // 未处理的 Promise rejection
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[全局] ❌ Unhandled Rejection at:', promise);
    console.error('[全局] 📍 Reason:', reason);
    // ⚠️ 关键：不退出进程，只记录日志
    // 不要调用 process.exit()
  });

  console.log('[全局] ✅ 全局错误处理器已注册');
}

/**
 * 同步 device_config 与 settings.json 中的设备地址
 * 解决安装后首次启动 device_config 与 settings.json 不一致的问题
 */
async function syncDeviceEndpoints(): Promise<void> {
  try {
    const { getSettings } = await import('./settings');
    const settings = getSettings();

    const { getDatabase } = await import('./database');
    const db = getDatabase();

    const now = new Date().toISOString();

    // 同步虹膜设备 endpoint
    const irisResult = await db.execute({
      sql: `UPDATE device_config SET endpoint = ?, updated_at = ? WHERE device_type = 'iris'`,
      args: [settings.irisEndpoint, now],
    });
    if (irisResult.rowsAffected > 0) {
      console.log(`[Init] ✅ 虹膜设备 endpoint 已同步: ${settings.irisEndpoint}`);
    }

    // 同步掌纹设备 endpoint
    const palmResult = await db.execute({
      sql: `UPDATE device_config SET endpoint = ?, updated_at = ? WHERE device_type = 'palm'`,
      args: [settings.palmEndpoint, now],
    });
    if (palmResult.rowsAffected > 0) {
      console.log(`[Init] ✅ 掌纹设备 endpoint 已同步: ${settings.palmEndpoint}`);
    }
  } catch (error: any) {
    console.error('[Init] ⚠️ 同步设备 endpoint 失败:', error.message);
    // 不抛出错误，允许继续启动
  }
}

/**
 * 初始化应用（幂等操作）
 * ⚠️ 即使 MQTT 连接失败也不会抛出异常
 */
export async function initApp(): Promise<void> {
  // 先注册全局错误处理器
  registerGlobalErrorHandlers();

  if (initialized) {
    return;
  }

  try {
    // 初始化数据库连接（会自动创建表）
    await initDatabase();

    // 初始化同步表额外索引
    await initSyncTables();

    // 初始化默认设备配置
    await initDefaultDevices();

    // ⚠️ 关键：同步 device_config 与 settings.json 中的设备地址
    // 确保数据库中的 endpoint 与设置页面一致（修复安装后首次启动连不上的问题）
    await syncDeviceEndpoints();

    // 初始化 MQTT 客户端（失败不会抛出异常）
    const mqttClient = await initMqttClient();

    // 启动定时同步任务
    startSyncScheduler();

    // 启动设备轮巡（后端自己轮巡掌纹和虹膜设备）
    startDevicePoller();

    initialized = true;
    console.log('[Init] ✅ 应用初始化完成');
  } catch (error) {
    // ⚠️ 关键：记录错误但不 throw，避免进程退出
    console.error('[Init] ❌ 应用初始化失败:', error);
  }
}

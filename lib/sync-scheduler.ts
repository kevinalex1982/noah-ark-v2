/**
 * 同步任务调度器
 * ⚠️ 已简化：只检查设备在线状态，不再定时重试
 *
 * 说明：
 * - MQTT 消息处理由 mqtt-client.ts 的内存队列处理
 * - 成功失败都记录到数据库，不再重试
 * - 这个调度器只负责更新设备在线状态
 */

import { checkDeviceStatus } from './device-sync';
import { getDeviceConfigs, updateDeviceStatus } from './sync-queue';

let syncInterval: NodeJS.Timeout | null = null;
let initialized = false; // 是否已初始化

/**
 * 检查所有设备的在线状态
 */
async function checkAllDevicesStatus(): Promise<void> {
  const devices = await getDeviceConfigs();

  for (const device of devices) {
    // 检查设备实际状态
    const status = await checkDeviceStatus(device.device_type, device.endpoint);
    const isNowOnline = status.online;

    // 更新数据库中的状态
    await updateDeviceStatus(device.device_id, isNowOnline);

    if (device.online !== isNowOnline) {
      console.log(`[Scheduler] 设备 ${device.device_id} 状态变化: ${device.online ? '在线' : '离线'} → ${isNowOnline ? '在线' : '离线'}`);
    }
  }
}

/**
 * 启动调度器
 * ⚠️ 只检查设备状态，不处理队列
 */
export function startSyncScheduler(): void {
  if (syncInterval) {
    return;
  }

  // 立即检查一次设备状态
  checkAllDevicesStatus().catch(err => {
    console.error('[Scheduler] 初始状态检查失败:', err);
  });

  // 每 30 秒检查设备状态
  syncInterval = setInterval(() => {
    checkAllDevicesStatus().catch(err => {
      console.error('[Scheduler] 状态检查失败:', err);
    });
  }, 30000);

  console.log('[Scheduler] ✅ 调度器已启动，每30秒检查设备状态');
}

/**
 * 停止调度器
 */
export function stopSyncScheduler(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('[Scheduler] ⏹️ 调度器已停止');
  }
}

/**
 * 获取调度器状态
 */
export function isSchedulerRunning(): boolean {
  return syncInterval !== null;
}
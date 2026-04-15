/**
 * 同步任务调度器
 *
 * 说明：
 * - 设备状态检查由前端 /api/devices 每 20 秒调用
 * - MQTT 消息处理由 mqtt-client.ts 的内存队列处理
 * - 成功失败都记录到数据库，不再重试
 * - 这个调度器保留占位，方便后续添加其他定时任务
 */

let syncInterval: NodeJS.Timeout | null = null;

/**
 * 启动调度器
 */
export function startSyncScheduler(): void {
  if (syncInterval) {
    return;
  }

  console.log('[Scheduler] ✅ 调度器已启动');
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

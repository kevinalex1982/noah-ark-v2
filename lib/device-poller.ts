/**
 * 后端设备轮巡器
 *
 * 功能：
 * - 后端自己轮巡掌纹和虹膜设备，不依赖前端请求
 * - 前端请求时直接返回缓存的设备状态
 *
 * 轮巡间隔：
 * - 掌纹设备：15 秒（105 接口）
 * - 虹膜设备：30 秒（members 接口）
 */

import { getDeviceConfigs, DeviceConfig } from './sync-queue';
import { initDatabase, getDatabase } from './database';
import http from 'http';

// 设备缓存 - 使用 globalThis 防止 Next.js 热重载导致重复实例
interface DeviceCache {
  online: boolean;
  credential_count: number | null;
  last_check: string;
  error?: string;
}

const PALM_INTERVAL = 15000;  // 15 秒
const IRIS_INTERVAL = 30000;  // 30 秒

// 使用 globalThis 保持热重载之间的状态
function getState() {
  if (!(globalThis as any).__pollerState) {
    (globalThis as any).__pollerState = {
      cache: new Map<string, DeviceCache>(),
      isRunning: false,
      palmTimer: null as NodeJS.Timeout | null,
      irisTimer: null as NodeJS.Timeout | null,
    };
  }
  return (globalThis as any).__pollerState as {
    cache: Map<string, DeviceCache>;
    isRunning: boolean;
    palmTimer: NodeJS.Timeout | null;
    irisTimer: NodeJS.Timeout | null;
  };
}

/**
 * 掌纹设备 105 接口（测试脚本验证过的方式）
 */
async function checkPalmDevice(endpoint: string): Promise<{ online: boolean; count: number | null }> {
  return new Promise((resolve) => {
    const endpointUrl = new URL(endpoint);
    const host = endpointUrl.hostname;
    const port = parseInt(endpointUrl.port) || 80;

    const req = http.request({
      hostname: host,
      port: port,
      path: '/api?sendData={"request":"105"}',
      method: 'POST',
      agent: false,
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ online: true, count: json.userNumber ?? null });
        } catch {
          resolve({ online: false, count: null });
        }
      });
    });

    req.on('error', (e) => {
      if (e.message.includes('ECONNRESET')) {
        // ECONNRESET 视为在线，保留上次凭证数量
        resolve({ online: true, count: null });
      } else {
        resolve({ online: false, count: null });
      }
    });

    req.on('timeout', () => { req.destroy(); resolve({ online: false, count: null }); });
    req.end();
  });
}

/**
 * 虹膜设备 members 接口
 */
async function checkIrisDevice(endpoint: string): Promise<{ online: boolean; count: number | null }> {
  try {
    const response = await fetch(`${endpoint}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        count: 100,
        key: '',
        lastStaffNumDec: '',
        needImages: 0,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      const count = data.body?.length ?? data.data?.length ?? null;
      return { online: true, count };
    }
    return { online: false, count: null };
  } catch {
    return { online: false, count: null };
  }
}

/**
 * 单次掌纹设备检查
 */
async function pollPalmDevice() {
  try {
    await initDatabase();
    const devices = await getDeviceConfigs();
    const palmDevices = devices.filter(d => d.device_type === 'palm');

    for (const device of palmDevices) {
      const result = await checkPalmDevice(device.endpoint);
      const now = new Date().toISOString();

      const cached = getState().cache.get(device.device_id);
      getState().cache.set(device.device_id, {
        online: result.online,
        credential_count: result.count !== null ? result.count : (cached?.credential_count ?? null),
        last_check: now,
      });
    }
  } catch (e) {
    console.error('[Poller] 掌纹轮巡异常:', e);
  }
}

/**
 * 单次虹膜设备检查
 */
async function pollIrisDevice() {
  try {
    await initDatabase();
    const devices = await getDeviceConfigs();
    const irisDevices = devices.filter(d => d.device_type === 'iris');

    for (const device of irisDevices) {
      const result = await checkIrisDevice(device.endpoint);
      getState().cache.set(device.device_id, {
        online: result.online,
        credential_count: result.count,
        last_check: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.error('[Poller] 虹膜轮巡异常:', e);
  }
}

/**
 * 启动设备轮巡
 */
export function startDevicePoller(): void {
  const state = getState();
  if (state.isRunning) {
    console.log('[Poller] 已经在运行，跳过');
    return;
  }

  state.isRunning = true;
  console.log('[Poller] ✅ 设备轮巡已启动');

  // 立即执行一次
  pollPalmDevice();
  pollIrisDevice();

  // 掌纹 15 秒
  state.palmTimer = setInterval(() => {
    pollPalmDevice();
  }, PALM_INTERVAL);

  // 虹膜 30 秒
  state.irisTimer = setInterval(() => {
    pollIrisDevice();
  }, IRIS_INTERVAL);
}

/**
 * 停止设备轮巡
 */
export function stopDevicePoller(): void {
  const state = getState();
  if (state.palmTimer) clearInterval(state.palmTimer);
  if (state.irisTimer) clearInterval(state.irisTimer);
  state.palmTimer = null;
  state.irisTimer = null;
  state.isRunning = false;
  console.log('[Poller] ⏹️ 设备轮巡已停止');
}

/**
 * 获取缓存的设备状态
 */
export async function getCachedDeviceStates(): Promise<DeviceCache[]> {
  await initDatabase();
  const devices = await getDeviceConfigs();
  const state = getState();

  return devices.map(device => {
    const cached = state.cache.get(device.device_id);
    if (cached) {
      return cached;
    }
    return {
      online: false,
      credential_count: null,
      last_check: '',
    };
  });
}

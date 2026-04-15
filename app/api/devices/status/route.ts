/**
 * 设备状态 API
 * GET /api/devices/status
 * 获取所有设备的在线状态
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDeviceConfigs, updateDeviceStatus, DeviceConfig } from '@/lib/sync-queue';
import { initDatabase } from '@/lib/database';

// 设备 API 端点配置
const DEVICE_ENDPOINTS = {
  'iris-device-001': {
    type: 'iris',
    url: process.env.IRIS_DEVICE_ENDPOINT || 'http://192.168.3.202:9003',
  },
  'palm-device-001': {
    type: 'palm',
    url: process.env.PALM_DEVICE_ENDPOINT || 'http://127.0.0.1:8080',
  },
};

// 检查掌纹设备状态（使用 105 接口查询用户数量）
async function checkPalmDeviceHealth(endpoint: string): Promise<{
  online: boolean;
  responseTime?: number;
  userCount?: number;
  error?: string;
}> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    // ⚠️ 关键：sendData 必须放在 URL 中，JSON 不能有空格！
    const sendData = '{"request":"105"}';
    const url = `${endpoint}/api?sendData=${sendData}`;

    console.log(`[PalmDevice] 检查状态 URL: ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;

    console.log(`[PalmDevice] HTTP 状态: ${response.status}, 耗时: ${responseTime}ms`);

    if (response.ok) {
      const text = await response.text();
      console.log(`[PalmDevice] 响应原文: ${text}`);

      try {
        const data = JSON.parse(text);
        console.log(`[PalmDevice] 解析后数据:`, JSON.stringify(data, null, 2));

        // 105 接口返回 userNumber 表示用户数量
        const userCount = data.userNumber || 0;

        return { online: true, responseTime, userCount };
      } catch (parseError) {
        console.error(`[PalmDevice] JSON 解析失败: ${text}`);
        return { online: false, error: 'JSON 解析失败' };
      }
    } else {
      return { online: false, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[PalmDevice] 检查失败:`, errorMessage);
    // ECONNRESET 说明设备端主动断开连接，设备仍在工作，视为在线
    if (errorMessage.includes('ECONNRESET')) {
      console.log(`[PalmDevice] ECONNRESET，设备视为在线`);
      return { online: true };
    }
    return { online: false, error: errorMessage };
  }
}

// 检查虹膜设备状态（使用 members 接口）
async function checkIrisDeviceHealth(endpoint: string): Promise<{
  online: boolean;
  responseTime?: number;
  userCount?: number;
  error?: string;
}> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const url = `${endpoint}/members`;

    console.log(`[IrisDevice] 检查状态 URL: ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1, key: '', lastStaffNumDec: '', needImages: 0 }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;

    console.log(`[IrisDevice] HTTP 状态: ${response.status}, 耗时: ${responseTime}ms`);

    if (response.ok) {
      const text = await response.text();
      console.log(`[IrisDevice] 响应原文(前200字符): ${text.substring(0, 200)}`);

      try {
        const data = JSON.parse(text);
        // members 接口返回人员列表
        const userCount = data.data?.length || 0;
        console.log(`[IrisDevice] 用户数量: ${userCount}`);

        return { online: true, responseTime, userCount };
      } catch (parseError) {
        console.error(`[IrisDevice] JSON 解析失败`);
        return { online: false, error: 'JSON 解析失败' };
      }
    } else {
      return { online: false, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[IrisDevice] 检查失败:`, errorMessage);
    return { online: false, error: errorMessage };
  }
}

export async function GET(request: NextRequest) {
  try {
    // 确保数据库已初始化
    await initDatabase();

    // 获取设备配置
    const devices = await getDeviceConfigs();

    // 并行检查所有设备状态
    const statusPromises = devices.map(async (device) => {
      const endpointConfig = DEVICE_ENDPOINTS[device.device_id as keyof typeof DEVICE_ENDPOINTS];
      const healthUrl = endpointConfig?.url || device.endpoint;
      const deviceType = endpointConfig?.type || device.device_type;

      // 根据设备类型调用不同的检查函数
      let health;
      if (deviceType === 'palm') {
        health = await checkPalmDeviceHealth(healthUrl);
      } else if (deviceType === 'iris') {
        health = await checkIrisDeviceHealth(healthUrl);
      } else {
        health = { online: false, error: '未知设备类型' };
      }

      // 更新数据库中的设备状态
      await updateDeviceStatus(device.device_id, health.online);

      return {
        device_id: device.device_id,
        device_name: device.device_name,
        device_type: device.device_type,
        endpoint: device.endpoint,
        online: health.online,
        response_time: health.responseTime,
        user_count: health.userCount,
        last_heartbeat: health.online ? new Date().toISOString() : device.last_heartbeat,
        error: health.error,
      };
    });

    const deviceStatuses = await Promise.all(statusPromises);

    // 统计信息
    const stats = {
      total: deviceStatuses.length,
      online: deviceStatuses.filter(d => d.online).length,
      offline: deviceStatuses.filter(d => !d.online).length,
    };

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      stats,
      devices: deviceStatuses,
    });
  } catch (error) {
    console.error('[API] 获取设备状态失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

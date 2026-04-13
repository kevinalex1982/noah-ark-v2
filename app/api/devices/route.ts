/**
 * 设备状态 API
 * GET /api/devices
 * 获取所有设备的状态和凭证数量
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDeviceConfigs, DeviceConfig } from '@/lib/sync-queue';
import { initDatabase } from '@/lib/database';
import http from 'http';

// 设备超时配置
const DEVICE_TIMEOUT = 5000;

/**
 * 查询虹膜设备凭证数量
 * API: POST /members
 */
async function getIrisCredentialCount(endpoint: string): Promise<{ online: boolean; count: number | null; error?: string }> {
  const startTime = Date.now();
  console.log(`[IrisDevice] 检查状态: ${endpoint}`);

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
      signal: AbortSignal.timeout(DEVICE_TIMEOUT),
    });

    const responseTime = Date.now() - startTime;
    console.log(`[IrisDevice] HTTP 状态: ${response.status}, 耗时: ${responseTime}ms`);

    if (response.ok) {
      const data = await response.json();
      const count = data.body?.length ?? data.data?.length ?? null;
      console.log(`[IrisDevice] 凭证数量: ${count}`);
      return { online: true, count };
    } else {
      return { online: false, count: null, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[IrisDevice] 检查失败:`, errorMessage);
    return { online: false, count: null, error: errorMessage };
  }
}

/**
 * 查询掌纹设备凭证数量
 * ⚠️ 必须使用 Node.js http 模块模拟 Python http.client 行为
 * ⚠️ sendData 必须放在 URL 中，JSON 不能有空格！
 */
async function getPalmCredentialCount(endpoint: string): Promise<{ online: boolean; count: number | null; error?: string }> {
  const startTime = Date.now();
  console.log(`[PalmDevice] 检查状态: ${endpoint}`);

  // 解析 endpoint 获取 host 和 port
  const url = new URL(endpoint);
  const host = url.hostname;
  const port = parseInt(url.port) || 80;

  // ⚠️ 关键：sendData 放在 URL 中，JSON 不能有空格！
  const sendData = '{"request":"105"}';
  const path = `/api?sendData=${sendData}`;

  console.log(`[PalmDevice] URL: http://${host}:${port}${path}`);

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: host,
        port: port,
        path: path,
        method: 'POST',
        timeout: DEVICE_TIMEOUT,
      },
      (res) => {
        const responseTime = Date.now() - startTime;
        console.log(`[PalmDevice] HTTP 状态: ${res.statusCode}, 耗时: ${responseTime}ms`);

        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          console.log(`[PalmDevice] 响应: ${data}`);

          try {
            const json = JSON.parse(data);
            const count = json.userNumber ?? null;
            console.log(`[PalmDevice] 凭证数量: ${count}`);
            resolve({ online: true, count });
          } catch {
            console.error(`[PalmDevice] JSON 解析失败`);
            resolve({ online: false, count: null, error: 'JSON 解析失败' });
          }
        });
      }
    );

    req.on('error', (error) => {
      const responseTime = Date.now() - startTime;
      console.error(`[PalmDevice] 请求失败 (${responseTime}ms):`, error.message);
      resolve({ online: false, count: null, error: error.message });
    });

    req.on('timeout', () => {
      console.error(`[PalmDevice] 请求超时`);
      req.destroy();
      resolve({ online: false, count: null, error: '请求超时' });
    });

    req.end();
  });
}

export async function GET(request: NextRequest) {
  try {
    // 确保数据库已初始化
    await initDatabase();

    // 获取设备配置
    const devices = await getDeviceConfigs();
    console.log(`[API] 获取到 ${devices.length} 个设备配置`);

    // 并行检查所有设备状态和凭证数量
    const deviceResults = await Promise.all(
      devices.map(async (device: DeviceConfig) => {
        console.log(`[API] 检查设备: ${device.device_name} (${device.device_type})`);

        // 根据设备类型调用不同的检查函数
        let result;
        if (device.device_type === 'iris') {
          result = await getIrisCredentialCount(device.endpoint);
        } else if (device.device_type === 'palm') {
          result = await getPalmCredentialCount(device.endpoint);
        } else {
          result = { online: false, count: null, error: '未知设备类型' };
        }

        return {
          id: device.device_id,
          name: device.device_name,
          type: device.device_type,
          ip: device.endpoint.replace('http://', '').split(':')[0],
          port: parseInt(device.endpoint.split(':').pop() || '0'),
          endpoint: device.endpoint,
          status: result.online ? 'online' : 'offline',
          lastSync: result.online ? new Date().toISOString() : null,
          credential_count: result.count,
        };
      })
    );

    console.log(`[API] 设备检查完成`);
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      devices: deviceResults,
    });
  } catch (error) {
    console.error('[API] 获取设备状态失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

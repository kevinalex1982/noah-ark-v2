/**
 * 设备状态 API
 * GET /api/devices
 * 查询设备配置并检查凭证数量（服务端主动发请求）
 *
 * 参数：
 *   ?type=palm  - 只查掌纹设备
 *   ?type=iris  - 只查虹膜设备
 *   无参数      - 查所有设备
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDeviceConfigs, DeviceConfig } from '@/lib/sync-queue';
import { initDatabase } from '@/lib/database';
import http from 'http';

const DEVICE_TIMEOUT = 5000;

/**
 * 查询虹膜设备凭证数量
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
 * 查询掌纹设备凭证数量（105 接口）
 * ⚠️ 必须使用 Node.js http 模块
 * ⚠️ sendData 放在 URL 中，不能 URL 编码，JSON 不能有空格
 */
async function getPalmCredentialCount(endpoint: string): Promise<{ online: boolean; count: number | null; error?: string }> {
  const startTime = Date.now();
  console.log(`[PalmDevice] 检查状态: ${endpoint}`);

  const url = new URL(endpoint);
  const host = url.hostname;
  const port = parseInt(url.port) || 80;

  // ⚠️ sendData 不能 URL 编码，直接传原始 JSON 字符串，不能有空格
  const sendData = '{"request":"105"}';
  const path = `/api?sendData=${sendData}`;

  console.log(`[PalmDevice] URL path: ${path}`);

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
      // ECONNRESET 说明设备忙碌拒绝，视为在线
      if (error.message.includes('ECONNRESET')) {
        console.log(`[PalmDevice] ECONNRESET，设备视为在线`);
        resolve({ online: true, count: null });
      } else {
        resolve({ online: false, count: null, error: error.message });
      }
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
    await initDatabase();

    const typeFilter = request.nextUrl.searchParams.get('type'); // palm | iris | null

    const devices = await getDeviceConfigs();
    console.log(`[API] 获取到 ${devices.length} 个设备配置${typeFilter ? ` (过滤: ${typeFilter})` : ''}`);

    // 根据 type 参数过滤设备
    const filteredDevices = typeFilter
      ? devices.filter(d => d.device_type === typeFilter)
      : devices;

    const deviceResults = await Promise.all(
      filteredDevices.map(async (device: DeviceConfig) => {
        console.log(`[API] 检查设备: ${device.device_name} (${device.device_type})`);

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

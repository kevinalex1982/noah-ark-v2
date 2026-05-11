/**
 * 虹膜设备锁定/解锁 API
 * POST /api/devices/iris-lock
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getDeviceConfigs } from '@/lib/sync-queue';
import * as http from 'http';

export async function POST(request: NextRequest) {
  try {
    await initDatabase();

    const body = await request.json();
    const { state, device_id } = body;

    if (state !== 0 && state !== 1) {
      return NextResponse.json({
        success: false,
        error: 'state 必须是 0（解锁）或 1（锁定）',
      }, { status: 400 });
    }

    // 获取设备配置
    const devices = await getDeviceConfigs();
    const device = devices.find(d => d.device_id === device_id || d.device_type === 'iris');

    if (!device) {
      return NextResponse.json({
        success: false,
        error: '未找到虹膜设备',
      }, { status: 404 });
    }

    // 从 endpoint 提取设备 IP
    const endpointUrl = new URL(device.endpoint);
    const deviceIp = endpointUrl.hostname;

    console.log(`[IrisLock] ${state === 1 ? '锁定' : '解锁'}虹膜设备, ip: ${deviceIp}`);

    const responseData: any = await new Promise((resolve, reject) => {
      const url = new URL(device.endpoint + '/memberSaveState');
      const postData = JSON.stringify({ ip: deviceIp, state });
      const req = http.request({
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
        agent: false,
        timeout: 30000,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve({ errorCode: -1, errorInfo: '解析失败: ' + data }); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
      req.write(postData);
      req.end();
    });
    console.log(`[IrisLock] 响应: ${JSON.stringify(responseData)}`);

    if (responseData.errorCode === 0 || responseData.errorCode === '0') {
      return NextResponse.json({
        success: true,
        message: state === 1 ? '设备已锁定' : '设备已解锁',
        response: responseData,
      });
    } else {
      return NextResponse.json({
        success: false,
        error: `设备返回错误: errorCode=${responseData.errorCode}`,
        response: responseData,
      });
    }
  } catch (error: any) {
    console.error('[IrisLock] 请求失败:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
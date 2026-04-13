/**
 * 虹膜设备锁定/解锁 API
 * POST /api/devices/iris-lock
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getDeviceConfigs } from '@/lib/sync-queue';

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

    const url = `${device.endpoint}/memberSaveState`;
    const requestData = {
      ip: deviceIp,
      state: state,
    };

    console.log(`[IrisLock] ${state === 1 ? '锁定' : '解锁'}虹膜设备, ip: ${deviceIp}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
      signal: AbortSignal.timeout(30000),
    });

    const responseData = await response.json();
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
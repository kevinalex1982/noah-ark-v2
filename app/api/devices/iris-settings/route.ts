/**
 * 获取/设置虹膜设备参数 API
 * GET /api/devices/iris-settings - 获取参数
 * POST /api/devices/iris-settings - 设置阈值参数
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getDeviceConfigs } from '@/lib/sync-queue';

/**
 * 获取虹膜设备完整参数
 */
async function getIrisFullSettings(): Promise<{
  success: boolean;
  endpoint?: string;
  body?: any;
  error?: string;
}> {
  const devices = await getDeviceConfigs();
  const irisDevice = devices.find(d => d.device_type === 'iris');

  if (!irisDevice) {
    return { success: false, error: '未找到虹膜设备' };
  }

  const url = `${irisDevice.endpoint}/settingsGet`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(10000),
  });

  const responseData = await response.json();

  if (responseData.errorCode === 0 || responseData.errorCode === '0') {
    return {
      success: true,
      endpoint: irisDevice.endpoint,
      body: responseData.body,
    };
  } else {
    return {
      success: false,
      error: `设备返回错误: errorCode=${responseData.errorCode}`,
    };
  }
}

/**
 * GET - 获取设备参数
 */
export async function GET() {
  try {
    await initDatabase();

    const result = await getIrisFullSettings();

    if (!result.success) {
      return NextResponse.json({
        success: false,
        error: result.error,
      }, { status: 500 });
    }

    // 提取阈值参数
    const thresh = result.body?.thresh || {};
    const settings = {
      deviceSN: result.body?.deviceSN,
      thresh: {
        irisQualityReg: thresh.irisQualityReg,
        irisQualityMatch: thresh.irisQualityMatch,
        irisReg: thresh.irisReg,
        irisMatch: thresh.irisMatch,
        faceMatch: thresh.faceMatch,
      },
      led: result.body?.led,
      sound: result.body?.sound,
      screenOff: result.body?.screenOff,
    };

    return NextResponse.json({
      success: true,
      settings,
      raw: result.body,
    });
  } catch (error: any) {
    console.error('[IrisSettings] 请求失败:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}

/**
 * POST - 设置阈值参数
 * 先获取完整参数，修改阈值后再设置
 */
export async function POST(request: NextRequest) {
  try {
    await initDatabase();

    const body = await request.json();
    const newThresh = body.thresh;

    if (!newThresh) {
      return NextResponse.json({
        success: false,
        error: '缺少 thresh 参数',
      }, { status: 400 });
    }

    // 1. 先获取完整参数
    const getResult = await getIrisFullSettings();
    if (!getResult.success) {
      return NextResponse.json({
        success: false,
        error: `获取参数失败: ${getResult.error}`,
      }, { status: 500 });
    }

    // 2. 修改阈值
    const fullBody = getResult.body;
    if (newThresh.irisQualityReg) fullBody.thresh.irisQualityReg = newThresh.irisQualityReg;
    if (newThresh.irisQualityMatch) fullBody.thresh.irisQualityMatch = newThresh.irisQualityMatch;
    if (newThresh.irisReg) fullBody.thresh.irisReg = newThresh.irisReg;
    if (newThresh.irisMatch) fullBody.thresh.irisMatch = newThresh.irisMatch;
    if (newThresh.faceMatch) fullBody.thresh.faceMatch = newThresh.faceMatch;

    console.log('[IrisSettings] 新阈值:', fullBody.thresh);

    // 3. 发送设置请求
    const url = `${getResult.endpoint}/settingsUpdate`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceSN: fullBody.deviceSN,
        body: fullBody,
      }),
      signal: AbortSignal.timeout(10000),
    });

    const responseData = await response.json();
    console.log('[IrisSettings] 设置响应:', responseData);

    if (responseData.errorCode === 0 || responseData.errorCode === '0') {
      return NextResponse.json({
        success: true,
        message: '阈值设置成功',
        thresh: fullBody.thresh,
      });
    } else {
      return NextResponse.json({
        success: false,
        error: `设置失败: errorCode=${responseData.errorCode}`,
      });
    }
  } catch (error: any) {
    console.error('[IrisSettings] 设置失败:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
/**
 * 清空虹膜设备 API
 * POST /api/devices/clear-iris
 */

import { NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getDeviceConfigs } from '@/lib/sync-queue';
import { clearIrisDevice } from '@/lib/device-sync';

export async function POST() {
  try {
    await initDatabase();

    const devices = await getDeviceConfigs();
    const irisDevice = devices.find(d => d.device_type === 'iris');

    if (!irisDevice) {
      return NextResponse.json({
        success: false,
        error: '未配置虹膜设备',
      }, { status: 400 });
    }

    console.log(`[ClearIris] 开始清空虹膜设备: ${irisDevice.endpoint}`);

    const result = await clearIrisDevice(irisDevice.endpoint);

    return NextResponse.json({
      success: result.success,
      message: result.success
        ? `清空成功，共删除 ${result.deleted} 个人员`
        : `部分失败，删除 ${result.deleted} 个，失败 ${result.failed} 个`,
      deleted: result.deleted,
      failed: result.failed,
      errors: result.errors,
    });
  } catch (error) {
    console.error('[ClearIris] 清空虹膜设备失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 }
    );
  }
}
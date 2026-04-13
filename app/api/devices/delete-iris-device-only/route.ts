/**
 * 只删除设备上的虹膜数据，不删除数据库记录
 * POST /api/devices/delete-iris-device-only
 *
 * 用于测试"先删后增"场景
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getDeviceConfigs } from '@/lib/sync-queue';
import { deleteFromIrisDevice } from '@/lib/device-sync';

export async function POST(request: NextRequest) {
  try {
    await initDatabase();

    const body = await request.json();
    const { person_id } = body;

    if (!person_id) {
      return NextResponse.json(
        { success: false, error: '缺少 person_id' },
        { status: 400 }
      );
    }

    // 获取虹膜设备配置
    const devices = await getDeviceConfigs();
    const irisDevice = devices.find(d => d.device_type === 'iris');

    if (!irisDevice) {
      return NextResponse.json({
        success: false,
        error: '未配置虹膜设备',
      });
    }

    console.log(`[DeleteIrisDeviceOnly] 只删除设备上的虹膜数据: person_id=${person_id}`);

    // 只删除设备上的数据，不删除数据库记录
    const result = await deleteFromIrisDevice(irisDevice.endpoint, person_id);

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: `已从虹膜设备删除用户 ${person_id}（数据库记录保留）`,
      });
    } else {
      return NextResponse.json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    console.error('[DeleteIrisDeviceOnly] 删除失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    );
  }
}
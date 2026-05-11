/**
 * 虹膜数据清理 API
 * POST /api/device/iris/cleanup
 *
 * 虹膜认证完成（成功/超时/失败）或回到首页时调用。
 * 从虹膜设备删除当前人员数据，并重新锁定设备。
 *
 * 请求体：{ credentialId: number }
 * 响应：{ success }
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getCredentialById } from '@/lib/db-credentials';
import { loadIrisData } from '@/lib/iris-data';
import { getDeviceConfigs } from '@/lib/sync-queue';
import { setIrisDeviceSaveState, deleteFromIrisDevice } from '@/lib/device-sync';

export async function POST(request: NextRequest) {
  try {
    await initDatabase();

    const body = await request.json();
    const credentialId = body.credentialId;

    if (!credentialId) {
      return NextResponse.json({ success: false, error: '缺少 credentialId' }, { status: 400 });
    }

    // 找虹膜设备
    const devices = await getDeviceConfigs();
    const irisDevice = devices.find(d => d.device_type === 'iris');
    if (!irisDevice) {
      return NextResponse.json({ success: false, error: '未找到虹膜设备配置' }, { status: 500 });
    }

    // 尝试从凭证获取 staffNum 用于删除
    let staffNum = '';
    try {
      const credential = await getCredentialById(credentialId);
      if (credential?.iris_data_path) {
        const irisData = loadIrisData(credentialId);
        staffNum = irisData.staffNum;
      }
    } catch (e) {
      console.log('[IrisCleanup] 读取凭证/文件失败，使用 credentialId 作为 staffNum');
    }

    // 删除设备上数据
    if (staffNum) {
      console.log(`[IrisCleanup] 删除设备数据: staffNum=${staffNum}`);
      await deleteFromIrisDevice(irisDevice.endpoint, staffNum);
    } else {
      console.log(`[IrisCleanup] 无 staffNum，跳过设备删除`);
    }

    // 重新锁定设备
    console.log('[IrisCleanup] 重新锁定设备');
    await setIrisDeviceSaveState(irisDevice.endpoint, 1);

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('[IrisCleanup] 异常:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

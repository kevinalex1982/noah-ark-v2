/**
 * 测试虹膜删除 API
 * POST /api/test/iris-delete
 *
 * ⚠️ 先删设备成功 → 再删数据库
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getDeviceConfigs } from '@/lib/sync-queue';
import { deleteFromIrisDevice } from '@/lib/device-sync';
import { getCredentialByPersonId, deleteCredential } from '@/lib/db-credentials';

// 固定的测试凭证ID
const TEST_CREDENTIAL_ID = 999999;
const TEST_PERSON_ID = 'test-iris-001';

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    await initDatabase();

    // 获取虹膜设备配置
    const devices = await getDeviceConfigs();
    const irisDevice = devices.find(d => d.device_type === 'iris');

    if (!irisDevice) {
      return NextResponse.json({
        success: false,
        error: '未配置虹膜设备',
      });
    }

    // ⚠️ 先删设备
    console.log(`[TestIrisDelete] 先删设备: personId=${TEST_PERSON_ID}`);
    const deviceResult = await deleteFromIrisDevice(irisDevice.endpoint, TEST_PERSON_ID);

    // ⚠️ 设备成功才删数据库
    let dbDeleted = false;
    if (deviceResult.success) {
      console.log(`[TestIrisDelete] 设备成功，删数据库`);
      const credential = await getCredentialByPersonId(TEST_PERSON_ID);
      if (credential) {
        await deleteCredential(credential.credential_id);
        dbDeleted = true;
        console.log(`[TestIrisDelete] 数据库已删除: credentialId=${credential.credential_id}`);
      } else {
        console.log(`[TestIrisDelete] 数据库无此记录`);
      }
    } else {
      console.log(`[TestIrisDelete] 设备失败，不删数据库`);
    }

    const durationMs = Date.now() - startTime;

    if (deviceResult.success) {
      return NextResponse.json({
        success: true,
        message: `虹膜删除成功: personId=${TEST_PERSON_ID}`,
        data: {
          personId: TEST_PERSON_ID,
          dbDeleted,
          durationMs,
        },
      });
    } else {
      return NextResponse.json({
        success: false,
        error: deviceResult.error,
        data: {
          personId: TEST_PERSON_ID,
          dbDeleted: false,
          durationMs,
        },
      });
    }
  } catch (error) {
    console.error('[TestIrisDelete] 异常:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    });
  }
}
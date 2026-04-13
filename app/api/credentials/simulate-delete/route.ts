/**
 * 模拟 MQTT 删除凭证 API
 * POST /api/credentials/simulate-delete
 *
 * 模拟MQTT下发端发送删除指令：
 * - 掌纹：先删设备，成功后删数据库
 * - 虹膜：锁定 → 500ms → 删除 → 500ms → 解锁 → 删数据库
 * - 其他：直接删数据库
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getCredentialById, deleteCredential } from '@/lib/db-credentials';
import { getDeviceConfigs } from '@/lib/sync-queue';
import {
  deleteFromIrisDevice,
  deleteFromPalmDeviceMQTT,
  setIrisDeviceSaveState,
} from '@/lib/device-sync';

export async function POST(request: NextRequest) {
  try {
    await initDatabase();

    const body = await request.json();
    const { credential_id } = body;

    if (!credential_id) {
      return NextResponse.json(
        { success: false, error: '缺少 credential_id' },
        { status: 400 }
      );
    }

    // 获取凭证信息
    const credential = await getCredentialById(credential_id);
    if (!credential) {
      return NextResponse.json(
        { success: false, error: '凭证不存在' },
        { status: 404 }
      );
    }

    const isIris = credential.type === 7;
    const isPalm = credential.type === 8;

    console.log(`[SimulateDelete] 模拟MQTT删除: type=${credential.type}, person_id=${credential.person_id}`);

    // 获取设备配置
    const devices = await getDeviceConfigs();

    if (isIris) {
      // ==================== 虹膜删除流程 ====================
      // 锁定 → 等500ms → 删除 → 等500ms → 解锁 → 删数据库
      const irisDevice = devices.find(d => d.device_type === 'iris');
      if (!irisDevice) {
        return NextResponse.json({
          success: false,
          error: '未配置虹膜设备',
        });
      }

      console.log('[SimulateDelete] 虹膜删除流程：锁定 → 500ms → 删除 → 500ms → 解锁');

      // 1. 锁定
      const lockResult = await setIrisDeviceSaveState(irisDevice.endpoint, 1);
      if (!lockResult.success) {
        // 锁定失败也要尝试解锁
        await setIrisDeviceSaveState(irisDevice.endpoint, 0);
        return NextResponse.json({
          success: false,
          error: `锁定设备失败: ${lockResult.error}`,
        });
      }

      // 2. 等待200ms（API返回后再等待）
      await new Promise(r => setTimeout(r, 200));

      // 3. 删除设备上的数据
      const deleteResult = await deleteFromIrisDevice(irisDevice.endpoint, credential.person_id);
      if (!deleteResult.success) {
        console.log(`[SimulateDelete] 虹膜设备删除: ${deleteResult.error}`);
      }

      // 4. 等待200ms（API返回后再等待）
      await new Promise(r => setTimeout(r, 200));

      // 5. 解锁
      await setIrisDeviceSaveState(irisDevice.endpoint, 0);

      // 6. 删除数据库记录
      await deleteCredential(credential_id);

      return NextResponse.json({
        success: true,
        message: '虹膜凭证已删除',
        deviceDeleted: deleteResult.success,
      });

    } else if (isPalm) {
      // ==================== 掌纹删除流程 ====================
      // 先删设备，成功后删数据库
      const palmDevice = devices.find(d => d.device_type === 'palm');
      if (!palmDevice) {
        return NextResponse.json({
          success: false,
          error: '未配置掌纹设备',
        });
      }

      // 从 featureData 提取 userId
      const featureData = credential.palm_feature || '';
      let userId = credential.person_id;

      const firstCaret = featureData.indexOf('^');
      if (firstCaret > 0) {
        const beforeCaret = featureData.substring(0, firstCaret);
        const match = beforeCaret.match(/([a-z][a-z0-9_-]{2,20})$/);
        if (match) {
          userId = match[1];
        }
      }

      console.log(`[SimulateDelete] 掌纹删除: userId=${userId}`);

      // 1. 删除设备上的数据
      const deleteResult = await deleteFromPalmDeviceMQTT(palmDevice.endpoint, userId);

      // 2. 删除数据库记录（无论设备删除是否成功都删除数据库）
      await deleteCredential(credential_id);

      return NextResponse.json({
        success: true,
        message: '掌纹凭证已删除',
        deviceDeleted: deleteResult.success,
      });

    } else {
      // ==================== 其他凭证 ====================
      // 直接删除数据库
      await deleteCredential(credential_id);

      return NextResponse.json({
        success: true,
        message: '凭证已从数据库删除',
      });
    }

  } catch (error: any) {
    console.error('[SimulateDelete] 错误:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
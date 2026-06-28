/**
 * 虹膜数据预加载 API
 * POST /api/device/iris/preload
 *
 * 用户编码验证通过后、进入虹膜认证步骤前调用。
 * 从加密文件读取虹膜数据，上传到虹膜设备并解锁，开始识别。
 *
 * 请求体：{ credentialId: number }
 * 响应：{ success, errorCode?, errorInfo? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getCredentialById } from '@/lib/db-credentials';
import { loadIrisData } from '@/lib/iris-data';
import { getDeviceConfigs } from '@/lib/sync-queue';
import { setIrisDeviceSaveState, uploadIrisToDevice, deleteFromIrisDevice } from '@/lib/device-sync';

export async function POST(request: NextRequest) {
  try {
    await initDatabase();

    const body = await request.json();
    const credentialId = body.credentialId;

    if (!credentialId) {
      return NextResponse.json({ success: false, error: '缺少 credentialId' }, { status: 400 });
    }

    // 1. 查凭证获取文件路径
    const credential = await getCredentialById(credentialId);
    console.log(`[IrisPreload·DEBUG] credentialId=${credentialId}`);
    console.log(`[IrisPreload·DEBUG] 凭证查询结果:`, credential ? '存在' : '不存在');
    if (credential) {
      console.log(`[IrisPreload·DEBUG] credential.iris_data_path:`, credential.iris_data_path);
    }
    if (!credential || !credential.iris_data_path) {
      return NextResponse.json({ success: false, error: '未找到虹膜数据路径' }, { status: 404 });
    }

    // 2. 读取并解密虹膜数据
    console.log('[IrisPreload·DEBUG] 开始加载加密文件...');
    const irisData = loadIrisData(credentialId);
    console.log('[IrisPreload·DEBUG] 文件加载结果:', irisData ? '成功' : '失败');
    if (irisData) {
      console.log('[IrisPreload·DEBUG] staffNum:', irisData.staffNum, 'memberName:', irisData.memberName);
      console.log('[IrisPreload·DEBUG] leftImage长度:', irisData.irisLeftImage?.length || 0, 'rightImage长度:', irisData.irisRightImage?.length || 0);
    }

    // 3. 找虹膜设备
    const devices = await getDeviceConfigs();
    const irisDevice = devices.find(d => d.device_type === 'iris');
    if (!irisDevice) {
      return NextResponse.json({ success: false, error: '未找到虹膜设备配置' }, { status: 500 });
    }

    // 4. 设备应已处于锁定状态，直接上传（不锁定）
    console.log(`[IrisPreload] 上传虹膜数据到设备: staffNum=${irisData.staffNum}`);
    const uploadResult = await uploadIrisToDevice(irisDevice.endpoint, {
      staffNum: irisData.staffNum,
      staffNumDec: irisData.staffNumDec || irisData.staffNum,
      memberName: irisData.memberName,
      irisLeftImage: irisData.irisLeftImage,
      irisRightImage: irisData.irisRightImage,
      faceImage: irisData.faceImage || '',
    });

    if (!uploadResult.success) {
      const errResp: any = JSON.parse(uploadResult.response || '{}');
      return NextResponse.json({
        success: false,
        errorCode: errResp.errorCode,
        errorInfo: errResp.errorInfo || uploadResult.error,
      }, { status: 200 });
    }

    console.log('[IrisPreload] 上传成功，解锁设备开始识别');

    // 5. 解锁设备，开始识别
    const unlockResult = await setIrisDeviceSaveState(irisDevice.endpoint, 0);
    if (!unlockResult.success) {
      console.error(`[IrisPreload] 解锁失败: ${unlockResult.error}，但仍返回成功让前端重试`);
    }
    console.log(`[IrisPreload] 解锁${unlockResult.success ? '成功' : '失败(' + unlockResult.error + ')'}`);

    // 6. 启动安全计时器（60 秒后自动重锁定 + 删除数据）
    const savedCredentialId = credentialId;
    setTimeout(async () => {
      try {
        console.log(`[IrisPreload] 安全计时器触发(${savedCredentialId})，自动清理`);
        const devices = await getDeviceConfigs();
        const dev = devices.find(d => d.device_type === 'iris');
        if (dev) {
          // 删除设备上数据
          await deleteFromIrisDevice(dev.endpoint, irisData.staffNum);
          // 重新锁定
          await setIrisDeviceSaveState(dev.endpoint, 1);
          console.log(`[IrisPreload] 安全计时器清理完成`);
        }
      } catch (e) {
        console.error('[IrisPreload] 安全计时器清理失败:', e);
      }
    }, 60_000);

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('[IrisPreload] 异常:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

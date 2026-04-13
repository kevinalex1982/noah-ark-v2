/**
 * 测试虹膜添加 API
 * POST /api/test/iris-add
 *
 * ⚠️ 先同步设备成功，再保存数据库
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getDeviceConfigs } from '@/lib/sync-queue';
import { syncToIrisDevice } from '@/lib/device-sync';
import { upsertCredential } from '@/lib/db-credentials';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

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

    // 读取虹膜测试数据
    let irisLeftImage = '';
    let irisRightImage = '';
    let staffNum = TEST_PERSON_ID;
    let staffNumDec = TEST_PERSON_ID;
    let memberName = '测试虹膜用户';

    try {
      const dataDir = join(process.cwd(), 'data');
      const files = require('fs').readdirSync(dataDir);
      const irisFile = files.find((f: string) => f.startsWith('iris_user_') && f.endsWith('.json'));

      if (irisFile) {
        const content = require('fs').readFileSync(join(dataDir, irisFile), 'utf-8');
        const json = JSON.parse(content);
        const userData = Array.isArray(json) ? json[0] : json;

        if (userData.irisLeftImage) {
          irisLeftImage = userData.irisLeftImage;
          irisRightImage = userData.irisRightImage || userData.irisLeftImage;
          staffNum = userData.staffNum || TEST_PERSON_ID;
          staffNumDec = userData.staffNumDec || TEST_PERSON_ID;
          memberName = userData.name || '测试虹膜用户';
          console.log(`[TestIrisAdd] 从 ${irisFile} 加载虹膜数据: ${memberName}`);
        }
      }
    } catch (error) {
      console.warn('[TestIrisAdd] 无法读取虹膜数据文件');
    }

    if (!irisLeftImage) {
      return NextResponse.json({
        success: false,
        error: '没有找到虹膜测试数据（data/iris_user_*.json）',
      });
    }

    // 读取人脸图片
    let faceImage = '';
    const faceFilePath = join(process.cwd(), 'data', 'face_photo_sample.txt');
    if (existsSync(faceFilePath)) {
      faceImage = readFileSync(faceFilePath, 'utf-8').trim();
    }

    // ⚠️ 先同步设备
    console.log(`[TestIrisAdd] 先同步设备: personId=${staffNum}`);
    const result = await syncToIrisDevice(irisDevice.endpoint, {
      staffNum: staffNum,
      staffNumDec: staffNumDec,
      memberName: memberName,
      irisLeftImage: irisLeftImage,
      irisRightImage: irisRightImage,
      faceImage: faceImage,
    });

    // ⚠️ 设备成功才保存数据库
    if (result.success) {
      console.log(`[TestIrisAdd] 设备成功，保存数据库`);
      await upsertCredential({
        person_id: staffNum,
        person_name: memberName,
        credential_id: TEST_CREDENTIAL_ID,
        type: 7,
        content: `${irisLeftImage}|==BMP-SEP==|${irisRightImage}`,
        iris_left_image: irisLeftImage,
        iris_right_image: irisRightImage,
        auth_type_list: '7',
      });
    } else {
      console.log(`[TestIrisAdd] 设备失败，不保存数据库`);
    }

    const durationMs = Date.now() - startTime;

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: `虹膜添加成功: ${memberName}`,
        data: {
          credentialId: TEST_CREDENTIAL_ID,
          personId: staffNum,
          personName: memberName,
          dbSaved: true,
          durationMs,
        },
      });
    } else {
      return NextResponse.json({
        success: false,
        error: result.error,
        data: {
          credentialId: TEST_CREDENTIAL_ID,
          personId: staffNum,
          dbSaved: false,
          durationMs,
        },
      });
    }
  } catch (error) {
    console.error('[TestIrisAdd] 异常:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    });
  }
}
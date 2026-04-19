/**
 * 凭证批量添加/删除 API
 * POST /api/test/credentials-batch
 *
 * body: { mode: 'add-combo' | 'add-single' | 'delete' }
 *
 * add-combo: auth_model=2, 添加4条凭证（密码、胁迫、虹膜、掌纹）并同步设备
 * add-single: auth_model=1, 添加4条凭证（密码、胁迫、虹膜、掌纹）并同步设备
 * delete: 从数据库读取 → 删除虹膜设备 → 删除掌纹设备 → 删除数据库
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getDeviceConfigs } from '@/lib/sync-queue';
import { syncToIrisDevice, deleteFromIrisDevice, syncToPalmDeviceMQTT, deleteFromPalmDeviceMQTT } from '@/lib/device-sync';
import { upsertCredential, deleteCredential, getAllCredentials } from '@/lib/db-credentials';
import { aesEncrypt } from '@/lib/crypto';
import { SAMPLE_FACE_IMAGE_BASE64 } from '@/lib/sample-face-image';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const TEST_PERSON_NAME = 'ces-test-user';
const PLAIN_USER_CODE = '112233';
const PASSWORD_CONTENT = '123456';     // 密码凭证明文
const DURESS_CONTENT = '123457';      // 胁迫码凭证明文

// 固定凭证ID（避免重复）
const CREDENTIAL_IDS = {
  password: 900001,
  duress: 900002,
  iris: 900003,
  palm: 900004,
};

/**
 * 读取掌纹特征数据
 */
function readPalmFeatureData(): { userId: string; featureData: string } | null {
  try {
    const dataDir = join(process.env.DATA_DIR || process.cwd(), 'data');
    const filePath = join(dataDir, 'palm_user_kevin.json');
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, 'utf-8');
    const json = JSON.parse(content);
    return { userId: json.userId, featureData: json.featureData };
  } catch {
    return null;
  }
}

/**
 * 读取虹膜测试数据（iris_user_123_full_20260317_214108.json）
 */
function readIrisTestData(): {
  leftIrisImage: string;
  rightIrisImage: string;
  name: string;
} | null {
  try {
    const dataDir = join(process.env.DATA_DIR || process.cwd(), 'data');
    const filePath = join(dataDir, 'iris_user_123_full_20260317_214108.json');
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, 'utf-8');
    const json = JSON.parse(content);
    // 可能是数组或单个对象
    const userData = Array.isArray(json) ? json[0] : json;
    return {
      leftIrisImage: userData.irisLeftImage || '',
      rightIrisImage: userData.irisRightImage || '',
      name: userData.name || TEST_PERSON_NAME,
    };
  } catch {
    return null;
  }
}

/**
 * 添加凭证 + 同步设备
 */
async function addCredentials(authModel: number) {
  const logs: string[] = [];
  const log = (msg: string) => { console.log(`[CredentialsBatch] ${msg}`); logs.push(msg); };

  await initDatabase();

  const personId = aesEncrypt(PLAIN_USER_CODE);
  log(`用户编码: ${PLAIN_USER_CODE} → AES加密: ${personId}`);

  // 读取掌纹数据
  const palmData = readPalmFeatureData();
  if (!palmData) {
    return { success: false, error: '无法读取掌纹数据 (data/palm_user_kevin.json)', logs };
  }
  log(`掌纹 userId: ${palmData.userId}, featureData 长度: ${palmData.featureData.length}`);

  // 读取虹膜数据
  const irisData = readIrisTestData();
  if (!irisData) {
    return { success: false, error: '无法读取虹膜数据 (data/iris_test.json)', logs };
  }
  log(`虹膜姓名: ${irisData.name}, 左图长度: ${irisData.leftIrisImage.length}, 右图长度: ${irisData.rightIrisImage.length}`);

  // === 1. 写入数据库（只存元数据，不存图片和特征）===
  const credentials = [
    { credentialId: CREDENTIAL_IDS.password, type: 5 as const, typeName: '密码' },
    { credentialId: CREDENTIAL_IDS.duress, type: 9 as const, typeName: '胁迫码' },
    { credentialId: CREDENTIAL_IDS.iris, type: 7 as const, typeName: '虹膜' },
    { credentialId: CREDENTIAL_IDS.palm, type: 8 as const, typeName: '掌纹' },
  ];

  for (const cred of credentials) {
    await upsertCredential({
      person_id: personId,
      person_name: TEST_PERSON_NAME,
      person_type: 'n',
      credential_id: cred.credentialId,
      type: cred.type,
      content: cred.type === 5 ? PASSWORD_CONTENT : (cred.type === 9 ? DURESS_CONTENT : undefined),
      auth_model: authModel,
      auth_type_list: '5,7,8,9',
      custom_id: cred.type === 8 ? palmData.userId : undefined,
      enable: 1,
    });
    log(`数据库: 写入 ${cred.typeName} (type=${cred.type}, id=${cred.credentialId})`);
  }

  // === 2. 同步虹膜设备（内置 锁定→等待8秒→上传→等待500ms→解锁）===
  const devices = await getDeviceConfigs();
  const irisDevice = devices.find(d => d.device_type === 'iris');
  if (irisDevice) {
    log(`虹膜同步: 开始完整流程（锁定→上传→解锁）...`);
    const irisResult = await syncToIrisDevice(irisDevice.endpoint, {
      staffNum: personId,
      staffNumDec: personId,
      memberName: irisData.name,
      irisLeftImage: irisData.leftIrisImage,
      irisRightImage: irisData.rightIrisImage,
      faceImage: SAMPLE_FACE_IMAGE_BASE64,
      purview: 30,
    });
    log(`虹膜同步: ${irisResult.success ? '✅ 成功' : '❌ 失败 - ' + irisResult.error}`);
  } else {
    log('虹膜同步: 未配置虹膜设备，跳过');
  }

  // === 3. 同步掌纹设备 ===
  const palmDevice = devices.find(d => d.device_type === 'palm');
  if (palmDevice) {
    log(`掌纹同步: 下发特征到 ${palmDevice.endpoint}...`);
    const palmResult = await syncToPalmDeviceMQTT(palmDevice.endpoint, {
      userId: palmData.userId,
      featureData: palmData.featureData,
    });
    log(`掌纹下发: ${palmResult.success ? '✅ 成功' : '❌ 失败 - ' + palmResult.error}`);
  } else {
    log('掌纹同步: 未配置掌纹设备，跳过');
  }

  log(`完成: auth_model=${authModel}, 数据库4条 + 虹膜1条 + 掌纹1条`);
  return { success: true, logs, data: { personId, authModel } };
}

/**
 * 删除凭证（从设备 + 数据库）
 * 查询数据库内所有凭证，逐条从设备删除后再从数据库删除
 */
async function deleteCredentials() {
  const logs: string[] = [];
  const log = (msg: string) => { console.log(`[CredentialsBatch] ${msg}`); logs.push(msg); };

  await initDatabase();

  // 查询数据库内所有凭证（不排除大字段）
  const dbCreds = await getAllCredentials({ limit: 10000, offset: 0, excludeLarge: false });
  if (dbCreds.length === 0) {
    log('数据库无记录');
    return { success: true, message: '数据库无凭证记录', logs };
  }
  log(`数据库找到 ${dbCreds.length} 条凭证`);

  const devices = await getDeviceConfigs();
  const irisDevice = devices.find(d => d.device_type === 'iris');
  const palmDevice = devices.find(d => d.device_type === 'palm');

  // 收集需要删除的 person_id 和 custom_id（去重后统一删设备）
  const personIds = new Set<string>();
  const palmUserIds = new Set<string>();

  for (const cred of dbCreds) {
    personIds.add(cred.person_id);
    if (cred.custom_id) palmUserIds.add(cred.custom_id);
  }

  // 从虹膜设备删除（按 person_id 去重）
  for (const pid of personIds) {
    if (irisDevice) {
      log(`虹膜删除: 从 ${irisDevice.endpoint} 删除 staffNum=${pid}...`);
      const irisResult = await deleteFromIrisDevice(irisDevice.endpoint, pid);
      log(`虹膜删除: ${irisResult.success ? '✅ 成功' : '❌ 失败 - ' + irisResult.error}`);
    }
  }

  // 从掌纹设备删除（按 custom_id 去重）
  for (const userId of palmUserIds) {
    if (palmDevice) {
      log(`掌纹删除: 从 ${palmDevice.endpoint} 删除 userId=${userId}...`);
      const palmResult = await deleteFromPalmDeviceMQTT(palmDevice.endpoint, userId);
      log(`掌纹删除: ${palmResult.success ? '✅ 成功' : '❌ 失败 - ' + palmResult.error}`);
    }
  }

  // 从数据库逐条删除
  for (const cred of dbCreds) {
    await deleteCredential(cred.credential_id);
    log(`数据库删除: type=${cred.type}, person=${cred.person_name}, id=${cred.credential_id}`);
  }

  log(`完成: 已删除全部 ${dbCreds.length} 条凭证`);
  return { success: true, message: `已删除全部 ${dbCreds.length} 条凭证`, logs, data: { count: dbCreds.length } };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mode } = body;

    if (!mode || !['add-combo', 'add-single', 'delete'].includes(mode)) {
      return NextResponse.json({
        success: false,
        error: 'mode 必须是 add-combo, add-single 或 delete',
      }, { status: 400 });
    }

    if (mode === 'add-combo') {
      const result = await addCredentials(2);
      return NextResponse.json(result);
    } else if (mode === 'add-single') {
      const result = await addCredentials(1);
      return NextResponse.json(result);
    } else {
      const result = await deleteCredentials();
      return NextResponse.json(result);
    }
  } catch (error) {
    console.error('[CredentialsBatch] 异常:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

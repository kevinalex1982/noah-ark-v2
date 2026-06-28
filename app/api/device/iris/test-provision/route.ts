/**
 * 虹膜完整下发测试 API（模拟 IAMS passport-add 完整流程）
 * POST /api/device/iris/test-provision
 *
 * 流程：
 * 1. 读取 data/iris_test_members/iris_user_123_full_20260317_214108.json
 * 2. 锁定设备 → 等待8秒 → BMP转换 → memberSave 上传
 * 3. 上传成功 → AES 加密存储到 data/iris_data/<credentialId>.json.enc
 * 4. 保存凭证到数据库（type=7，虹膜）
 * 5. 调用 memberDelete 从设备删除数据
 * 6. 添加密码凭证（type=5，用户编码 11112222）
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getDeviceConfigs } from '@/lib/sync-queue';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { convertToBmpBase64 } from '@/lib/device-sync';
import { aesEncrypt } from '@/lib/crypto';

function bjt(): string {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

async function apiCall(endpoint: string, path: string, body?: object, timeout: number = 15000): Promise<any> {
  const url = endpoint + path;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: NextRequest) {
  const logs: string[] = [];
  const log = (msg: string) => { const line = `[${bjt()}] ${msg}`; console.log(line); logs.push(line); };

  try {
    await initDatabase();

    // 获取虹膜设备
    const devices = await getDeviceConfigs();
    const irisDevice = devices.find(d => d.device_type === 'iris');
    if (!irisDevice) {
      return NextResponse.json({ success: false, error: '未找到虹膜设备配置', logs }, { status: 404 });
    }
    const endpoint = irisDevice.endpoint;
    log(`设备地址: ${endpoint}`);

    // 读取测试成员数据
    const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
    const testMemberPath = join(dataDir, 'iris_test_members', 'iris_user_123_full_20260317_214108.json');
    if (!existsSync(testMemberPath)) {
      return NextResponse.json({ success: false, error: `测试数据不存在: ${testMemberPath}`, logs }, { status: 404 });
    }
    const raw = JSON.parse(readFileSync(testMemberPath, 'utf-8'));
    const testMember = raw['0'] || Object.values(raw)[0] as any;
    log(`成员: ${testMember.name} (${testMember.staffNum})`);

    const testCredentialId = 900001;
    const testPersonId = aesEncrypt('11112222');
    const testPersonName = testMember.name;

    // 锁定设备
    log('锁定设备...');
    const lockResult: any = await apiCall(endpoint, '/memberSaveState', { ip: new URL(endpoint).hostname, state: 1 }, 10000);
    log(`锁定: errorCode=${lockResult.errorCode}`);
    if (lockResult.errorCode !== 0 && lockResult.errorCode !== '0') {
      return NextResponse.json({ success: false, error: `锁定失败`, logs }, { status: 200 });
    }

    // 等待8秒
    log('等待8秒...');
    await new Promise(resolve => setTimeout(resolve, 8000));

    // BMP转换
    log('BMP转换...');
    const leftIrisBmp = await convertToBmpBase64(testMember.irisLeftImage);
    const rightIrisBmp = await convertToBmpBase64(testMember.irisRightImage);
    log(`BMP left: ${leftIrisBmp.length} chars, right: ${rightIrisBmp.length} chars`);

    // 上传
    const requestData: any = {
      staffNum: testPersonId,
      cardNum: '',
      cardType: 0,
      name: testMember.name,
      openDoor: testMember.openDoor ? 1 : 0,
      purview: testMember.purview ?? 30,
      purviewStartTime: 0,
      purviewEndTime: 0,
      singleIrisAllowed: 0,
      leftIrisImage: leftIrisBmp,
      rightIrisImage: rightIrisBmp,
      faceImage: '',
    };

    log('上传人员(memberSave)...');
    let uploadResult: any;
    try { uploadResult = await apiCall(endpoint, '/memberSave', requestData, 30000); }
    catch (e) { uploadResult = { errorCode: -1, errorInfo: e instanceof Error ? e.message : String(e) }; }
    log(`上传响应: errorCode=${uploadResult.errorCode}, errorInfo=${uploadResult.errorInfo || ''}`);

    const uploadSuccess = uploadResult.errorCode === 0 || uploadResult.errorCode === '0';
    if (!uploadSuccess) {
      log(`上传失败`);
      try { await apiCall(endpoint, '/memberSaveState', { ip: new URL(endpoint).hostname, state: 1 }, 10000); } catch (e) {}
      return NextResponse.json({ success: false, error: `上传失败: errorCode=${uploadResult.errorCode}`, logs }, { status: 200 });
    }
    log('上传成功');

    // 重新锁定
    log('重新锁定设备...');
    try { await apiCall(endpoint, '/memberSaveState', { ip: new URL(endpoint).hostname, state: 1 }, 10000); } catch (e) {}

    // AES 加密存储
    log('AES 加密存储虹膜数据...');
    const { saveIrisData } = await import('@/lib/iris-data');
    const irisPayload = {
      staffNum: testPersonId,
      staffNumDec: testMember.staffNumDec || testPersonId,
      memberName: testPersonName,
      irisLeftImage: testMember.irisLeftImage,
      irisRightImage: testMember.irisRightImage,
      faceImage: '',
    };
    const savedPath = saveIrisData(testCredentialId, irisPayload);
    log(`加密文件已保存: ${savedPath}`);

    // 保存虹膜凭证到数据库
    log('保存虹膜凭证到数据库(type=7)...');
    const { upsertCredential } = await import('@/lib/db-credentials');
    const encryptedUserCode = aesEncrypt('11112222');
    log(`用户编码加密: 11112222 → ${encryptedUserCode}`);

    await upsertCredential({
      person_id: encryptedUserCode,
      person_name: testPersonName,
      credential_id: testCredentialId,
      type: 7,
      auth_type_list: '7',
      auth_model: 1,
      iris_data_path: savedPath,
    });
    log(`虹膜凭证已保存: credentialId=${testCredentialId}`);

    // 从设备删除数据
    log('从虹膜设备删除数据(memberDelete)...');
    let deleteResult: any;
    try { deleteResult = await apiCall(endpoint, '/memberDelete', { staffNum: testPersonId }, 10000); }
    catch (e) { deleteResult = { errorCode: -1, errorInfo: e instanceof Error ? e.message : String(e) }; }
    log(`删除响应: errorCode=${deleteResult.errorCode}`);
    if (deleteResult.errorCode === 0 || deleteResult.errorCode === '0') {
      log('设备数据删除成功');
    } else {
      log(`设备数据删除失败: errorCode=${deleteResult.errorCode}`);
    }

    // 添加密码凭证（type=5，用户编码 11112222，content明文）
    log('添加密码凭证(type=5, 用户编码: 11112222)...');
    const passwordCredentialId = 900002;
    await upsertCredential({
      person_id: encryptedUserCode,
      person_name: testPersonName,
      credential_id: passwordCredentialId,
      type: 5,
      content: '11112222',
      auth_type_list: '5',
      auth_model: 1,
    });
    log(`密码凭证已保存: credentialId=${passwordCredentialId}`);

    log('=== 完整下发测试完成 ===');

    return NextResponse.json({
      success: true,
      credentialId: testCredentialId,
      passwordCredentialId,
      personId: testPersonId,
      personName: testPersonName,
      logs,
    });

  } catch (error) {
    console.error('[IrisTestProvision] 异常:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
      logs,
    }, { status: 500 });
  }
}

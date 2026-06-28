/**
 * 用已有虹膜数据下发凭证 API
 * POST /api/device/iris/provision-from-existing
 *
 * 从 data/iris_test_members/device_members.json 中选取指定成员，
 * 组织成完整凭证下发到虹膜设备（模拟 IAMS passport-add 流程）。
 *
 * 流程：
 * 1. 读取 device_members.json 获取所有成员
 * 2. 用 needImages:0 检查设备是否有人员
 * 3. 如果有人员，全部删除（锁定→逐个 memberDelete→重新锁定）
 * 4. 锁定设备 → 等待1秒 → memberSave 上传 → 保持锁定
 * 5. AES 加密存储到 data/iris_data/<credentialId>.json.enc
 * 6. 保存凭证到数据库（type=7，虹膜）
 * 7. 调用 memberDelete 从设备删除数据
 * 8. 添加密码凭证（type=5，用户编码 11112222）
 *
 * 请求体：{ staffNum?: string } — 不传则用第一个成员
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getDeviceConfigs } from '@/lib/sync-queue';
import { irisRequest } from '@/lib/device-sync';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function bjt(): string {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

export async function POST(request: NextRequest) {
  const logs: string[] = [];
  const log = (msg: string) => {
    const line = `[${bjt()}] ${msg}`;
    console.log(line);
    logs.push(line);
  };

  try {
    await initDatabase();

    // 读取设备配置
    const devices = await getDeviceConfigs();
    const irisDevice = devices.find(d => d.device_type === 'iris');
    if (!irisDevice) {
      return NextResponse.json({ success: false, error: '未找到虹膜设备配置', logs }, { status: 404 });
    }
    const endpoint = irisDevice.endpoint;
    log(`设备地址: ${endpoint}`);

    // 读取已有的成员数据
    const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
    const membersPath = join(dataDir, 'iris_test_members', 'device_members.json');
    if (!existsSync(membersPath)) {
      return NextResponse.json({
        success: false,
        error: `成员数据不存在: ${membersPath}，请先点击"获取虹膜设备成员"按钮下载`,
        logs,
      }, { status: 404 });
    }

    const membersData = JSON.parse(readFileSync(membersPath, 'utf-8'));
    const allMembers = membersData.members || [];
    if (allMembers.length === 0) {
      return NextResponse.json({ success: false, error: '成员数据为空', logs }, { status: 404 });
    }

    // 解析请求中的 staffNum，找不到则用第一个
    const reqBody = await request.json().catch(() => ({}));
    const targetStaffNum = reqBody.staffNum;
    let selectedMember: any;
    if (targetStaffNum) {
      selectedMember = allMembers.find((m: any) => m.staffNum === targetStaffNum);
      if (!selectedMember) {
        return NextResponse.json({
          success: false,
          error: `未找到 staffNum=${targetStaffNum} 的成员，可用的: ${allMembers.map((m: any) => `${m.name}(${m.staffNum})`).join(', ')}`,
          logs,
          availableMembers: allMembers.map((m: any) => ({ name: m.name, staffNum: m.staffNum })),
        }, { status: 404 });
      }
    } else {
      selectedMember = allMembers[0];
    }

    log(`选用成员: ${selectedMember.name} (${selectedMember.staffNum})`);
    log(`左眼虹膜: ${selectedMember.irisLeftImage?.length || 0} chars, 右眼: ${selectedMember.irisRightImage?.length || 0} chars`);

    const testPersonId = selectedMember.staffNum;
    const testPersonName = selectedMember.name;
    const testCredentialId = 900010; // 用一个固定测试 ID
    const passwordCredentialId = 900011;

    // === 步骤1: 检查设备现有人员 ===
    log('步骤1: 检查设备现有人员...');
    const membersResp: any = await irisRequest(endpoint, '/members', {
      count: 100, key: '', lastStaffNumDec: '', needImages: 0,
    }, 15000);

    if (membersResp.errorCode !== 0 && membersResp.errorCode !== '0') {
      log(`检查人员失败: errorCode=${membersResp.errorCode}`);
    }

    const existingMembers = membersResp.body || [];
    log(`设备上有 ${existingMembers.length} 个人员`);

    // === 步骤2: 删除所有现有人员 ===
    if (existingMembers.length > 0) {
      log('步骤2: 删除设备上所有现有人员...');

      log('  锁定设备...');
      const lockResult: any = await irisRequest(endpoint, '/memberSaveState', {
        ip: new URL(endpoint).hostname, state: 1,
      }, 10000);
      log(`  锁定: errorCode=${lockResult.errorCode}`);

      let deletedCount = 0;
      for (const member of existingMembers) {
        if (!member.staffNum) continue;
        log(`  删除: ${member.staffNum} (${member.name})...`);
        try {
          const delResp: any = await irisRequest(endpoint, '/memberDelete', {
            staffNum: member.staffNum,
          }, 10000);
          log(`    响应: errorCode=${delResp.errorCode}`);
          if (delResp.errorCode === 0 || delResp.errorCode === '0') deletedCount++;
        } catch (e) {
          log(`    删除异常: ${e instanceof Error ? e.message : String(e)}`);
        }
        await new Promise(r => setTimeout(r, 300)); // 间隔300ms
      }
      log(`删除完成: 成功${deletedCount}个`);

      log('步骤3: 重新锁定设备...');
      try {
        const relockResult: any = await irisRequest(endpoint, '/memberSaveState', {
          ip: new URL(endpoint).hostname, state: 1,
        }, 10000);
        log(`  重锁定: errorCode=${relockResult.errorCode}`);
      } catch (e) {
        log(`  重锁定异常: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // === 步骤3: 锁定设备 → 等待1秒 → 上传 ===
    log('步骤4: 锁定设备...');
    const lockResult: any = await irisRequest(endpoint, '/memberSaveState', {
      ip: new URL(endpoint).hostname, state: 1,
    }, 10000);
    if (lockResult.errorCode !== 0 && lockResult.errorCode !== '0') {
      return NextResponse.json({ success: false, error: `锁定失败: errorCode=${lockResult.errorCode}`, logs }, { status: 200 });
    }
    log('锁定成功');

    log('等待1秒...');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 转换 JPEG → BMP（设备要求 BMP 格式 + 正确的字段名）
    log('步骤4a: JPEG→BMP 转换...');
    const { convertToBmpBase64 } = await import('@/lib/device-sync');
    const leftIrisBmp = await convertToBmpBase64(selectedMember.irisLeftImage || selectedMember.leftIrisImage);
    const rightIrisBmp = await convertToBmpBase64(selectedMember.irisRightImage || selectedMember.rightIrisImage);
    log(`  BMP left: ${leftIrisBmp.length} chars, right: ${rightIrisBmp.length} chars`);
    log(`  BMP prefix: ${leftIrisBmp.substring(0, 20)}`);

    // 构建 memberSave payload（使用和 iris_test.json 完全相同的字段名和结构）
    const requestData: any = {};
    requestData.staffNum = selectedMember.staffNum;
    requestData.cardNum = selectedMember.cardNum || '';
    requestData.cardType = selectedMember.cardType ?? 0;
    requestData.name = selectedMember.name;
    requestData.openDoor = selectedMember.openDoor ?? 1;
    requestData.purview = selectedMember.purview ?? 30;
    requestData.purviewStartTime = selectedMember.purviewStartTime ?? 0;
    requestData.purviewEndTime = selectedMember.purviewEndTime ?? 0;
    requestData.singleIrisAllowed = selectedMember.singleIrisAllowed ?? 0;
    requestData.leftIrisImage = leftIrisBmp;
    requestData.rightIrisImage = rightIrisBmp;
    requestData.faceImage = '';
    log(`payload keys: ${Object.keys(requestData).join(', ')}`);
    log(`leftIrisImage: len=${requestData.leftIrisImage.length}`);
    log(`rightIrisImage: len=${requestData.rightIrisImage.length}`);

    log('步骤5: 上传人员(memberSave)...');
    let uploadResult: any;
    try {
      uploadResult = await irisRequest(endpoint, '/memberSave', requestData, 20000);
    } catch (e) {
      uploadResult = { errorCode: -1, errorInfo: e instanceof Error ? e.message : String(e) };
    }
    log(`上传响应: errorCode=${uploadResult.errorCode}`);

    const uploadSuccess = uploadResult.errorCode === 0 || uploadResult.errorCode === '0';
    if (!uploadSuccess) {
      log(`上传失败: errorCode=${uploadResult.errorCode}`);
      // 失败也要重新锁定
      try {
        await irisRequest(endpoint, '/memberSaveState', { ip: new URL(endpoint).hostname, state: 1 }, 10000);
      } catch (e) {}
      return NextResponse.json({ success: false, error: `上传失败: errorCode=${uploadResult.errorCode}`, logs }, { status: 200 });
    }
    log('上传成功');

    // 重新锁定
    log('步骤6: 重新锁定设备...');
    try {
      const relockResult: any = await irisRequest(endpoint, '/memberSaveState', {
        ip: new URL(endpoint).hostname, state: 1,
      }, 10000);
      log(`重新锁定: errorCode=${relockResult.errorCode}`);
    } catch (e) {
      log(`重新锁定异常: ${e instanceof Error ? e.message : String(e)}`);
    }

    // === 步骤7: AES 加密存储（保存原始 JPEG 数据） ===
    log('步骤7: AES 加密存储虹膜数据...');
    const { saveIrisData } = await import('@/lib/iris-data');
    const irisPayload = {
      staffNum: testPersonId,
      staffNumDec: testPersonId,
      memberName: testPersonName,
      irisLeftImage: selectedMember.irisLeftImage, // 原始 JPEG
      irisRightImage: selectedMember.irisRightImage,
      faceImage: '',
    };
    const savedPath = saveIrisData(testCredentialId, irisPayload);
    log(`加密文件已保存: ${savedPath}`);

    // === 步骤8: 保存凭证到数据库（type=7 虹膜） ===
    log('步骤8: 保存虹膜凭证到数据库...');
    const { upsertCredential } = await import('@/lib/db-credentials');
    await upsertCredential({
      person_id: testPersonId,
      person_name: testPersonName,
      credential_id: testCredentialId,
      type: 7,
      auth_type_list: '7',
      auth_model: 1,
      iris_data_path: savedPath,
    });
    log(`数据库凭证已保存: credentialId=${testCredentialId}`);

    // === 步骤9: 从设备删除数据 ===
    log('步骤9: 从虹膜设备删除数据(memberDelete)...');
    let deleteResult: any;
    try {
      deleteResult = await irisRequest(endpoint, '/memberDelete', { staffNum: testPersonId }, 10000);
    } catch (e) {
      deleteResult = { errorCode: -1, errorInfo: e instanceof Error ? e.message : String(e) };
    }
    log(`删除响应: errorCode=${deleteResult.errorCode}`);
    if (deleteResult.errorCode === 0 || deleteResult.errorCode === '0') {
      log('设备数据删除成功');
    } else {
      log(`设备数据删除失败: errorCode=${deleteResult.errorCode}（数据已入库，需手动清理）`);
    }

    // === 步骤10: 添加密码凭证 ===
    log('步骤10: 添加密码凭证(用户编码: 11112222)...');
    await upsertCredential({
      person_id: testPersonId,
      person_name: testPersonName,
      credential_id: passwordCredentialId,
      type: 5,
      content: '11112222',
      auth_type_list: '5',
      auth_model: 1,
    });
    log(`密码凭证已保存: credentialId=${passwordCredentialId}`);

    log('=== 下发完成 ===');

    return NextResponse.json({
      success: true,
      credentialId: testCredentialId,
      passwordCredentialId,
      personId: testPersonId,
      personName: testPersonName,
      logs,
      availableMembers: allMembers.map((m: any) => ({ name: m.name, staffNum: m.staffNum })),
    });

  } catch (error) {
    console.error('[ProvisionFromExisting] 异常:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
      logs,
    }, { status: 500 });
  }
}

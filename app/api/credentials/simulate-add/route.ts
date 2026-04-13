/**
 * 模拟添加凭证 API
 * POST /api/credentials/simulate-add
 *
 * 只执行添加操作，不执行删除。
 * 用于调试：测试"先删除 → 再添加"是否能成功。
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getCredentialById } from '@/lib/db-credentials';
import { getDeviceConfigs } from '@/lib/sync-queue';
import {
  syncToIrisDevice,
  syncToPalmDeviceMQTT,
} from '@/lib/device-sync';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

// 从 content 解析虹膜数据
function parseIrisContent(content: string): { leftIris: string; rightIris: string } {
  const SEPARATOR = '|==BMP-SEP==|';
  if (content.includes(SEPARATOR)) {
    const parts = content.split(SEPARATOR);
    return { leftIris: parts[0] || '', rightIris: parts[1] || '' };
  }
  return { leftIris: content, rightIris: '' };
}

// 从 featureData 提取 userId
function extractUserIdFromFeature(featureData: string): string {
  if (!featureData) return '';
  const firstCaret = featureData.indexOf('^');
  if (firstCaret < 0) return '';
  const beforeCaret = featureData.substring(0, firstCaret);
  const match = beforeCaret.match(/([a-z][a-z0-9_-]{2,20})$/);
  if (match) return match[1];
  const lastEq = beforeCaret.lastIndexOf('=');
  if (lastEq >= 0) return beforeCaret.substring(lastEq + 1).trim();
  return '';
}

// 示例人脸图片
function getSampleFaceImage(): string {
  try {
    const filePath = join(process.cwd(), 'data', 'face_photo_sample.txt');
    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf-8').trim();
    }
  } catch (error) {
    console.warn('[SimulateAdd] 无法读取人脸图片文件，使用默认值');
  }
  // 返回一个最小有效 JPEG
  return '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
}

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

    // 获取凭证数据
    const credential = await getCredentialById(credential_id);
    if (!credential) {
      return NextResponse.json(
        { success: false, error: '凭证不存在' },
        { status: 404 }
      );
    }

    // 只有虹膜(7)和掌纹(8)需要同步
    if (credential.type !== 7 && credential.type !== 8) {
      return NextResponse.json({
        success: true,
        message: '该凭证类型无需同步到设备',
      });
    }

    // 获取设备配置
    const devices = await getDeviceConfigs();
    const deviceType = credential.type === 7 ? 'iris' : 'palm';
    const device = devices.find(d => d.device_type === deviceType);

    if (!device) {
      return NextResponse.json({
        success: false,
        error: `未配置${deviceType === 'iris' ? '虹膜' : '掌纹'}设备`,
      });
    }

    console.log(`[SimulateAdd] 执行添加: credential_id=${credential_id}, type=${credential.type}`);

    let syncResult: { success: boolean; error?: string; response?: any };

    if (credential.type === 7) {
      // 虹膜添加
      const { leftIris, rightIris } = parseIrisContent(credential.content || '');
      console.log(`[SimulateAdd] 虹膜添加: staffNum=${credential.person_id}, name=${credential.person_name}`);

      // 保存发送数据到文件（模拟下发2.json）
      const sendData = {
        staffNum: credential.person_id,
        staffNumDec: credential.person_id,
        memberName: credential.person_name,
        irisLeftImage: leftIris,
        irisRightImage: rightIris,
        faceImage: getSampleFaceImage(),
      };
      try {
        const dataDir = join(process.cwd(), 'data');
        if (!existsSync(dataDir)) {
          mkdirSync(dataDir, { recursive: true });
        }
        const sendFilePath = join(dataDir, '模拟下发2.json');
        writeFileSync(sendFilePath, JSON.stringify(sendData, null, 2), 'utf-8');
        console.log(`[SimulateAdd] 数据已保存到: ${sendFilePath}`);
      } catch (e) {
        console.error('[SimulateAdd] 保存数据文件失败:', e);
      }

      syncResult = await syncToIrisDevice(
        device.endpoint,
        {
          staffNum: credential.person_id,
          staffNumDec: credential.person_id,
          memberName: credential.person_name,
          irisLeftImage: leftIris,
          irisRightImage: rightIris,
          faceImage: getSampleFaceImage(),
        },
        false
      );
    } else {
      // 掌纹添加
      const userId = extractUserIdFromFeature(credential.palm_feature || '') || credential.person_id;
      console.log(`[SimulateAdd] 掌纹添加: userId=${userId}`);

      syncResult = await syncToPalmDeviceMQTT(device.endpoint, {
        userId,
        featureData: credential.palm_feature || '',
      });
    }

    if (syncResult.success) {
      return NextResponse.json({
        success: true,
        message: `${deviceType === 'iris' ? '虹膜' : '掌纹'}设备添加成功`,
        response: syncResult.response,
      });
    } else {
      return NextResponse.json({
        success: false,
        error: syncResult.error,
      });
    }
  } catch (error) {
    console.error('[SimulateAdd] 添加失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    );
  }
}
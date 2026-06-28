/**
 * 虹膜 JPEG→BMP 直接转换测试 API（24位 RGB，无灰度）
 * POST /api/device/iris/convert
 *
 * 读取 test_member.json，将 JPEG base64 直接转为 24位 BMP base64，
 * 不经过灰度处理，保持原始 RGB 像素数据。
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getDeviceConfigs } from '@/lib/sync-queue';
import { irisRequest } from '@/lib/device-sync';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

function bjt(): string {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

// JPEG → 8位灰度 BMP 转换（top-down 存储，高度为负）
function convertJpegToBmp(base64Data: string): string {
  if (!base64Data) return '';
  const imageBuffer = Buffer.from(base64Data, 'base64');
  // 如果已经是 BMP，直接返回
  if (imageBuffer[0] === 0x42 && imageBuffer[1] === 0x4D) return base64Data;

  const jpeg = require('jpeg-js');
  const decoded = jpeg.decode(imageBuffer, { useTArray: true });
  const { width, height, data } = decoded;

  // 8位 BMP: 有256色调色板
  const rowSize = width;
  const padding = (4 - (rowSize % 4)) % 4;
  const pixelDataSize = (rowSize + padding) * height;
  const fileSize = 54 + 256 * 4 + pixelDataSize; // 54头 + 1024调色板 + 像素

  const bmp = Buffer.alloc(fileSize);
  let o = 0;

  // BMP 文件头 (14 字节)
  bmp.write('BM', o); o += 2;
  bmp.writeUInt32LE(fileSize, o); o += 4;
  bmp.writeUInt16LE(0, o); o += 2;
  bmp.writeUInt16LE(0, o); o += 2;
  bmp.writeUInt32LE(54 + 1024, o); o += 4; // 像素数据偏移

  // DIB 头 (40 字节)
  bmp.writeUInt32LE(40, o); o += 4;
  bmp.writeInt32LE(width, o); o += 4;
  bmp.writeInt32LE(-height, o); o += 4;     // 负高度 = top-down
  bmp.writeUInt16LE(1, o); o += 2;
  bmp.writeUInt16LE(8, o); o += 2;          // 8位
  bmp.writeUInt32LE(0, o); o += 4;
  bmp.writeUInt32LE(pixelDataSize, o); o += 4;
  bmp.writeInt32LE(2835, o); o += 4;
  bmp.writeInt32LE(2835, o); o += 4;
  bmp.writeUInt32LE(256, o); o += 4;
  bmp.writeUInt32LE(0, o); o += 4;

  // 灰度调色板 (256 × 4字节)
  for (let i = 0; i < 256; i++) {
    bmp[o++] = i; bmp[o++] = i; bmp[o++] = i; bmp[o++] = 0;
  }

  // 像素数据（top-down 存储，从上到下）
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      bmp[o++] = Math.round(0.299 * data[srcIdx] + 0.587 * data[srcIdx + 1] + 0.114 * data[srcIdx + 2]);
    }
    for (let p = 0; p < padding; p++) bmp[o++] = 0;
  }

  return bmp.toString('base64');
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
    const testMemberPath = join(dataDir, 'iris_test_members', 'test_member.json');

    if (!existsSync(testMemberPath)) {
      return NextResponse.json({
        success: false,
        error: `测试数据不存在: ${testMemberPath}`,
        logs,
      }, { status: 404 });
    }

    const testMember = JSON.parse(readFileSync(testMemberPath, 'utf-8'));
    log(`成员: ${testMember.name} (${testMember.staffNum})`);
    log(`原始 JPEG left: ${testMember.irisLeftImage?.length || 0} chars, right: ${testMember.irisRightImage?.length || 0} chars`);

    // JPEG → BMP 转换（top-down 8位灰度）
    log('开始 JPEG→BMP 转换（8位灰度，top-down）...');
    const leftIrisBmp = convertJpegToBmp(testMember.irisLeftImage);
    const rightIrisBmp = convertJpegToBmp(testMember.irisRightImage);
    log(`转换后 BMP left: ${leftIrisBmp.length} chars, right: ${rightIrisBmp.length} chars`);
    log(`BMP 前缀: ${leftIrisBmp.substring(0, 30)}`);

    // 计算 BMP 文件大小（字节）
    const leftBmpSize = Math.floor(leftIrisBmp.length * 3 / 4);
    const rightBmpSize = Math.floor(rightIrisBmp.length * 3 / 4);
    log(`BMP 估算大小 left: ${leftBmpSize} bytes, right: ${rightBmpSize} bytes`);

    // 构建 payload
    const requestData: any = {
      staffNum: testMember.staffNum,
      cardNum: '',
      cardType: 0,
      name: testMember.name,
      openDoor: 1,
      purview: 30,
      purviewStartTime: 0,
      purviewEndTime: 0,
      singleIrisAllowed: 0,
      leftIrisImage: leftIrisBmp,
      rightIrisImage: rightIrisBmp,
      faceImage: '',
    };

    // 锁定设备
    log('锁定设备...');
    const lockResult: any = await irisRequest(endpoint, '/memberSaveState', {
      ip: new URL(endpoint).hostname,
      state: 1,
    }, 10000);
    log(`锁定: errorCode=${lockResult.errorCode}`);

    if (lockResult.errorCode !== 0 && lockResult.errorCode !== '0') {
      return NextResponse.json({ success: false, error: `锁定失败`, logs }, { status: 200 });
    }

    // 上传
    log('上传人员数据 (memberSave)...');
    let uploadResult: any;
    try {
      uploadResult = await irisRequest(endpoint, '/memberSave', requestData, 30000);
    } catch (e) {
      uploadResult = { errorCode: -1, errorInfo: e instanceof Error ? e.message : String(e) };
    }
    log(`上传响应: errorCode=${uploadResult.errorCode}, errorInfo=${uploadResult.errorInfo || ''}`);

    // 重新锁定
    log('重新锁定设备...');
    try {
      await irisRequest(endpoint, '/memberSaveState', {
        ip: new URL(endpoint).hostname, state: 1,
      }, 10000);
    } catch (e) {}

    return NextResponse.json({
      success: uploadResult.errorCode === 0 || uploadResult.errorCode === '0',
      errorCode: uploadResult.errorCode,
      errorInfo: uploadResult.errorInfo,
      logs,
    });

  } catch (error) {
    console.error('[IrisConvert] 异常:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
      logs,
    }, { status: 500 });
  }
}

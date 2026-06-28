/**
 * 测试下发 3: 使用 iris_user_123_simple_20260317_214108.json
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getDeviceConfigs } from '@/lib/sync-queue';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { convertToBmpBase64 } from '@/lib/device-sync';

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
    const devices = await getDeviceConfigs();
    const irisDevice = devices.find(d => d.device_type === 'iris');
    if (!irisDevice) return NextResponse.json({ success: false, error: '未找到虹膜设备配置', logs }, { status: 404 });
    const endpoint = irisDevice.endpoint;
    log(`设备地址: ${endpoint}`);

    const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
    const memberPath = join(dataDir, 'iris_test_members', 'iris_user_123_simple_20260317_214108.json');
    if (!existsSync(memberPath)) return NextResponse.json({ success: false, error: '文件不存在', logs }, { status: 404 });

    const raw = JSON.parse(readFileSync(memberPath, 'utf-8'));
    const member = raw['0'] || Object.values(raw)[0] as any;
    log(`成员: ${member.name} (${member.staffNum})`);

    log('BMP转换...');
    const leftBmp = await convertToBmpBase64(member.irisLeftImage);
    const rightBmp = await convertToBmpBase64(member.irisRightImage);
    log(`BMP left: ${leftBmp.length} chars, right: ${rightBmp.length} chars`);

    const requestData: any = {
      staffNum: member.staffNum, cardNum: '', cardType: 0,
      name: member.name, openDoor: member.openDoor ? 1 : 0,
      purview: member.purview ?? 30, purviewStartTime: 0, purviewEndTime: 0,
      singleIrisAllowed: 0, leftIrisImage: leftBmp, rightIrisImage: rightBmp, faceImage: '',
    };

    log('锁定设备...');
    const lockResult: any = await apiCall(endpoint, '/memberSaveState', { ip: new URL(endpoint).hostname, state: 1 }, 10000);
    log(`锁定: errorCode=${lockResult.errorCode}`);

    log('等待8秒...');
    await new Promise(resolve => setTimeout(resolve, 8000));

    log('上传(memberSave)...');
    let uploadResult: any;
    try { uploadResult = await apiCall(endpoint, '/memberSave', requestData, 30000); }
    catch (e) { uploadResult = { errorCode: -1, errorInfo: e instanceof Error ? e.message : String(e) }; }
    log(`上传响应: errorCode=${uploadResult.errorCode}, errorInfo=${uploadResult.errorInfo || ''}`);

    log('重新锁定...');
    try { await apiCall(endpoint, '/memberSaveState', { ip: new URL(endpoint).hostname, state: 1 }, 10000); } catch (e) {}

    return NextResponse.json({
      success: uploadResult.errorCode === 0 || uploadResult.errorCode === '0',
      errorCode: uploadResult.errorCode, errorInfo: uploadResult.errorInfo, logs,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '未知错误', logs }, { status: 500 });
  }
}

/**
 * 虹膜设备测试上传 API
 * POST /api/test/iris-upload
 *
 * 用法：
 *   fetch('/api/test/iris-upload', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ file: 'iris_test.json' }),
 *   });
 *
 * 从 data/ 目录读取 JSON 文件，按完整流程发送到虹膜设备：
 * 锁定 → 等待8秒 → 上传(memberSave) → 等待500ms → 解锁
 */

import { NextRequest, NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getDatabase, initDatabase } from '@/lib/database';
import { SAMPLE_FACE_IMAGE_BASE64 } from '@/lib/sample-face-image';

// 东八区时间
function bjt(): string {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

// 调用虹膜设备接口（使用 fetch，与 lib/device-sync.ts 一致）
async function callIrisApi(endpoint: string, path: string, body?: object): Promise<any> {
  const url = `${endpoint}${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  return response.json();
}

export async function POST(request: NextRequest) {
  const logs: string[] = [];
  const log = (msg: string) => {
    const line = `[${bjt()}] ${msg}`;
    console.log(line);
    logs.push(line);
  };

  try {
    const body = await request.json();
    const fileName = body.file || 'iris_test.json';

    if (!fileName.endsWith('.json') || fileName.includes('..') || fileName.includes('/')) {
      return NextResponse.json({ success: false, error: '无效的文件名' }, { status: 400 });
    }

    const dataDir = join(process.env.DATA_DIR || process.cwd(), 'data');
    const filePath = join(dataDir, fileName);

    if (!existsSync(filePath)) {
      return NextResponse.json({
        success: false,
        error: `文件不存在: ${filePath}`,
      }, { status: 404 });
    }

    const fileContent = readFileSync(filePath, 'utf-8');
    let requestData: any;
    try {
      requestData = JSON.parse(fileContent);
    } catch {
      return NextResponse.json({ success: false, error: 'JSON 解析失败' }, { status: 400 });
    }

    // 替换 faceImage 为硬编码样本（与 iris-add 一致）
    requestData.faceImage = SAMPLE_FACE_IMAGE_BASE64;
    log(`faceImage 已替换为内置样本，长度: ${SAMPLE_FACE_IMAGE_BASE64.length}`);

    await initDatabase();
    const db = getDatabase();

    let endpoint = 'http://192.168.3.202:9003';
    try {
      const result = await db.execute({
        sql: "SELECT value FROM settings WHERE key = 'irisEndpoint'",
        args: [],
      });
      if (result.rows.length > 0) {
        endpoint = result.rows[0].value as string;
      }
    } catch (e) {
      log('读取设置失败，使用默认 endpoint');
    }

    log(`读取文件: ${filePath}`);
    log(`设备地址: ${endpoint}`);
    log(`staffNum: ${requestData.staffNum}, name: ${requestData.name}`);
    log(`leftIrisImage 长度: ${requestData.leftIrisImage?.length || 0}`);
    log(`rightIrisImage 长度: ${requestData.rightIrisImage?.length || 0}`);

    const startTime = Date.now();

    // === 步骤1: 锁定设备 ===
    log('步骤1: 锁定设备...');
    let lockResult: any;
    try {
      lockResult = await callIrisApi(endpoint, '/memberSaveState', {
        ip: new URL(endpoint).hostname,
        state: 1,
      });
    } catch (e) {
      return NextResponse.json({
        success: false,
        step: 'lock',
        error: `锁定异常: ${e instanceof Error ? e.message : String(e)}`,
        logs,
      }, { status: 200 });
    }
    log(`锁定响应: ${JSON.stringify(lockResult)}`);
    if (lockResult.errorCode !== 0 && lockResult.errorCode !== '0') {
      return NextResponse.json({
        success: false,
        step: 'lock',
        error: `锁定失败: errorCode=${lockResult.errorCode}`,
        logs,
      }, { status: 200 });
    }
    log('锁定成功');

    // === 等待8秒 ===
    log('等待8秒...');
    await new Promise(resolve => setTimeout(resolve, 8000));

    // === 步骤2: 上传人员 ===
    const bodySize = Buffer.byteLength(JSON.stringify(requestData));
    log(`步骤2: 上传人员(memberSave), body 大小: ${(bodySize / 1024).toFixed(1)}KB...`);
    let saveResult: any;
    try {
      saveResult = await callIrisApi(endpoint, '/memberSave', requestData);
    } catch (e) {
      // 打印完整错误链，包括 cause（底层错误）
      const errMsg = e instanceof Error ? e.message : String(e);
      const causeMsg = e instanceof Error && 'cause' in e ? (e.cause instanceof Error ? (e.cause as Error).message : String(e.cause)) : '';
      const stack = e instanceof Error ? (e.stack || '').split('\n').slice(0, 5).join(' | ') : '';
      console.error('[IrisTest] memberSave 完整错误:', errMsg);
      if (causeMsg) console.error('[IrisTest]   cause:', causeMsg);
      console.error('[IrisTest]   stack:', stack);
      saveResult = { errorCode: -1, errorInfo: `${errMsg}${causeMsg ? ' | ' + causeMsg : ''}` };
    }
    log(`上传响应: ${JSON.stringify(saveResult)}`);

    // === 等待500ms ===
    log('等待500ms...');
    await new Promise(resolve => setTimeout(resolve, 500));

    // === 步骤3: 解锁设备 ===
    log('步骤3: 解锁设备...');
    try {
      const unlockResult = await callIrisApi(endpoint, '/memberSaveState', {
        ip: new URL(endpoint).hostname,
        state: 0,
      });
      log(`解锁响应: ${JSON.stringify(unlockResult)}`);
      if (unlockResult.errorCode === 0 || unlockResult.errorCode === '0') {
        log('解锁成功');
      } else {
        log(`解锁失败: errorCode=${unlockResult.errorCode}`);
      }
    } catch (e) {
      log(`解锁异常: ${e instanceof Error ? e.message : String(e)}`);
    }

    const durationMs = Date.now() - startTime;
    const uploadSuccess = saveResult.errorCode === 0 || saveResult.errorCode === '0';

    log(`上传${uploadSuccess ? '成功' : '失败'}, 总耗时: ${durationMs}ms`);

    return NextResponse.json({
      success: uploadSuccess,
      file: fileName,
      endpoint,
      duration_ms: durationMs,
      response: saveResult,
      error: uploadSuccess ? undefined : `errorCode=${saveResult.errorCode}, errorInfo=${saveResult.errorInfo || ''}`,
      logs,
    });

  } catch (error) {
    console.error('[IrisTest] 异常:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
      logs,
    }, { status: 500 });
  }
}

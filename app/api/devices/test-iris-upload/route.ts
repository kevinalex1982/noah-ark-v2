/**
 * 虹膜设备测试上传 API
 * POST /api/devices/test-iris-upload
 *
 * 从 data/iris_last_request.json 读取已转换的 BMP 数据，
 * 按 锁定→500ms→上传→200ms→解锁 流程发送到虹膜设备。
 * 使用 Node.js http.request 避免 fetch keep-alive 复用连接问题。
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getDeviceConfigs } from '@/lib/sync-queue';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import http from 'http';

function bjt(): string {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

/**
 * 用 Node.js http.request 发送请求，每条请求使用独立 TCP 连接
 */
function httpRequest(endpoint: string, path: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint + path);
    const postData = body ? JSON.stringify(body) : '';

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`解析失败: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('请求超时'));
    });

    if (postData) req.write(postData);
    req.end();
  });
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

    // 读取最后一次虹膜下发 payload
    const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
    const filePath = join(dataDir, 'iris_last_request.json');
    if (!existsSync(filePath)) {
      return NextResponse.json({
        success: false,
        error: '文件不存在: iris_last_request.json，请先点击"模拟添加凭证"生成数据',
        logs,
      }, { status: 404 });
    }

    const payload = JSON.parse(readFileSync(filePath, 'utf-8'));
    log(`读取 payload: staffNum=${payload.staffNum}, name=${payload.name}`);
    log(`leftIrisImage: ${payload.leftIrisImage?.length || 0} chars, rightIrisImage: ${payload.rightIrisImage?.length || 0} chars`);

    const startTime = Date.now();

    // === 步骤1: 锁定设备 ===
    log('步骤1: 锁定设备...');
    const lockResult: any = await httpRequest(endpoint, '/memberSaveState', {
      ip: new URL(endpoint).hostname,
      state: 1,
    });
    log(`锁定响应: ${JSON.stringify(lockResult)}`);
    if (lockResult.errorCode !== 0 && lockResult.errorCode !== '0') {
      return NextResponse.json({ success: false, step: 'lock', error: `锁定失败: errorCode=${lockResult.errorCode}`, logs }, { status: 200 });
    }
    log('锁定成功');

    // === 等待 300ms ===
    log('等待 300ms...');
    await new Promise(resolve => setTimeout(resolve, 300));

    // === 步骤2: 上传人员 ===
    log('步骤2: 上传人员(memberSave)...');
    let saveResult: any;
    try {
      saveResult = await httpRequest(endpoint, '/memberSave', payload);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      log(`上传异常: ${errMsg}`);
      saveResult = { errorCode: -1, errorInfo: errMsg };
    }
    log(`上传响应: ${JSON.stringify(saveResult)}`);

    // === 等待 200ms ===
    log('等待 200ms...');
    await new Promise(resolve => setTimeout(resolve, 200));

    // === 步骤3: 解锁设备 ===
    log('步骤3: 解锁设备...');
    try {
      const unlockResult: any = await httpRequest(endpoint, '/memberSaveState', {
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

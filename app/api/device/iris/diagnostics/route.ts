/**
 * 虹膜设备短间隔并发诊断测试 API
 * POST /api/device/iris/diagnostics
 *
 * 目的：判断短间隔指令 + 并发请求是否会导致虹膜设备崩溃
 *
 * Guard 模式：独立调用 + setTimeout 间隔，但 members查询+锁定 用 Promise.all 并发
 * Queue 模式：所有请求入队，严格按间隔串行执行
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getDeviceConfigs } from '@/lib/sync-queue';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { convertToBmpBase64 } from '@/lib/device-sync';
import { aesEncrypt } from '@/lib/crypto';

function bjt(): string {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

// ============================================================
// 底层 HTTP 请求（独立 TCP 连接）
// ============================================================
import http from 'http';

function httpRequestRaw(
  endpoint: string,
  path: string,
  body?: object,
  timeout: number = 15000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint + path);
    const postData = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData), 'Connection': 'close' },
      agent: false,
      timeout,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('解析失败: ' + data)); } });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('请求超时')); });
    if (postData) req.write(postData);
    req.end();
  });
}

// ============================================================
// 读取测试成员数据
// ============================================================
function readTestMember(): { member: any; log: string } | null {
  const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
  const testMemberPath = join(dataDir, 'iris_test_members', 'iris_user_123_full_20260317_214108.json');
  if (!existsSync(testMemberPath)) {
    return null;
  }
  const raw = JSON.parse(readFileSync(testMemberPath, 'utf-8'));
  const member = raw['0'] || Object.values(raw)[0] as any;
  return { member, log: testMemberPath };
}

// ============================================================
// Guard 模式测试（并发发起查询+锁定，观察设备反应）
// ============================================================
async function runGuardTest(endpoint: string, intervalMs: number): Promise<string[]> {
  const logs: string[] = [];
  const log = (msg: string) => { const line = `[${bjt()}] [Guard] ${msg}`; console.log(line); logs.push(line); };

  log('=== Guard 模式并发测试开始 ===');
  log(`指令间隔: ${intervalMs}ms`);

  // 步骤1: 并发发送 "查询数量" + "锁定"（这是最可能导致崩溃的并发场景）
  log('步骤1: 并发发送 members查询 + 锁定指令 (Promise.all)...');
  const membersPromise = httpRequestRaw(endpoint, '/members', { count: 100, key: '', lastStaffNumDec: '', needImages: 0 }, 10000);
  const lockPromise = httpRequestRaw(endpoint, '/memberSaveState', { ip: new URL(endpoint).hostname, state: 1 }, 10000);

  const [membersResult, lockResult] = await Promise.allSettled([membersPromise, lockPromise]);
  log(`members查询: ${membersResult.status === 'fulfilled' ? `errorCode=${(membersResult.value as any)?.errorCode}` : 'rejected: ' + (membersResult as PromiseRejectedResult).reason}`);
  log(`锁定指令: ${lockResult.status === 'fulfilled' ? `errorCode=${(lockResult.value as any)?.errorCode}` : 'rejected: ' + (lockResult as PromiseRejectedResult).reason}`);

  // 从 members 结果中提取要删除的 staffNum 列表
  let staffNumsToDelete: string[] = [];
  if (membersResult.status === 'fulfilled' && (membersResult.value as any)?.errorCode === 0 && (membersResult.value as any)?.body) {
    staffNumsToDelete = (membersResult.value as any).body.map((m: any) => m.staffNum).filter(Boolean);
    log(`发现 ${staffNumsToDelete.length} 个成员待删除`);
  }

  // 步骤2: 逐个删除成员
  for (const staffNum of staffNumsToDelete) {
    try {
      const delResult = await httpRequestRaw(endpoint, '/memberDelete', { staffNum }, 10000);
      log(`删除 ${staffNum}: errorCode=${delResult.errorCode}`);
    } catch (e: any) {
      log(`删除 ${staffNum} 异常: ${e.message}`);
    }
    if (intervalMs > 0) await new Promise(r => setTimeout(r, intervalMs));
  }

  // 步骤3: 读取测试成员，转换BMP
  const testMemberData = readTestMember();
  if (!testMemberData) {
    log('❌ 找不到测试成员数据文件');
    return logs;
  }
  const testMember = testMemberData.member;
  log(`测试成员: ${testMember.name} (${testMember.staffNum})`);

  log('步骤3: BMP转换...');
  const leftIrisBmp = await convertToBmpBase64(testMember.irisLeftImage);
  const rightIrisBmp = await convertToBmpBase64(testMember.irisRightImage);
  log(`BMP转换完成: left=${leftIrisBmp.length} chars, right=${rightIrisBmp.length} chars`);

  const requestData = {
    staffNum: aesEncrypt('11112222'),
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

  // 步骤4: 并发测试 — 锁定+上传+重新锁定 同时发送（极端并发场景）
  log('步骤4: 并发发送 锁定+上传+重新锁定 (Promise.all)...');

  const lockUploadPromise = httpRequestRaw(endpoint, '/memberSaveState', { ip: new URL(endpoint).hostname, state: 1 }, 10000)
    .then(v => { log(`上传前锁定: errorCode=${v.errorCode}`); return v; })
    .catch(e => { log(`上传前锁定异常: ${e.message}`); });

  const uploadPromise = httpRequestRaw(endpoint, '/memberSave', requestData, 30000)
    .then(v => {
      log(`上传响应: errorCode=${v.errorCode}`);
      const success = v.errorCode === 0 || v.errorCode === '0';
      if (!success) log(`⚠️ 上传失败: errorCode=${v.errorCode}, errorInfo=${v.errorInfo || ''}`);
      return v;
    })
    .catch(e => { log(`❌ 上传异常: ${e.message}`); });

  const relockPromise = httpRequestRaw(endpoint, '/memberSaveState', { ip: new URL(endpoint).hostname, state: 1 }, 10000)
    .then(v => { log(`重新锁定: errorCode=${v.errorCode}`); return v; })
    .catch(e => { log(`重新锁定异常: ${e.message}`); });

  await Promise.allSettled([lockUploadPromise, uploadPromise, relockPromise]);

  log('=== Guard 模式测试完成 ===');
  return logs;
}

// ============================================================
// Queue 模式测试（所有请求通过队列串行执行）
// ============================================================

// 简化版队列（只用于诊断测试，不修改 device-sync 的全局队列）
interface QueueItem {
  fn: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  label: string;
}

async function processQueue(items: QueueItem[], intervalMs: number, logs: string[]): Promise<void> {
  for (const item of items) {
    const log = (msg: string) => { const line = `[${bjt()}] [Queue] ${msg}`; console.log(line); logs.push(line); };
    log(`执行: ${item.label}`);
    try {
      const result = await item.fn();
      item.resolve(result);
    } catch (e) {
      item.reject(e);
    }
    if (intervalMs > 0 && items.indexOf(item) < items.length - 1) {
      log(`等待 ${intervalMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
}

async function runQueueTest(endpoint: string, intervalMs: number): Promise<string[]> {
  const logs: string[] = [];
  const log = (msg: string) => { const line = `[${bjt()}] [Queue] ${msg}`; console.log(line); logs.push(line); };

  log('=== Queue 模式并发测试开始 ===');
  log(`指令间隔: ${intervalMs}ms`);

  // 步骤1: 并发发送 "查询数量" + "锁定"（通过队列串行执行，不是真正并发）
  log('步骤1: 入队 members查询 + 锁定指令（队列串行）...');
  let membersResult: any = null;
  let lockResult: any = null;

  const queue: QueueItem[] = [
    {
      label: 'members查询',
      fn: () => httpRequestRaw(endpoint, '/members', { count: 100, key: '', lastStaffNumDec: '', needImages: 0 }, 10000),
      resolve: (v) => { membersResult = v; },
      reject: (e) => { membersResult = { error: e.message }; },
    },
    {
      label: '锁定指令',
      fn: () => httpRequestRaw(endpoint, '/memberSaveState', { ip: new URL(endpoint).hostname, state: 1 }, 10000),
      resolve: (v) => { lockResult = v; },
      reject: (e) => { lockResult = { error: e.message }; },
    },
  ];

  await processQueue(queue, intervalMs, logs);
  log(`members查询: ${membersResult?.errorCode ?? membersResult?.error}`);
  log(`锁定指令: ${lockResult?.errorCode ?? lockResult?.error}`);

  // 提取要删除的 staffNum
  let staffNumsToDelete: string[] = [];
  if (membersResult?.errorCode === 0 && membersResult?.body) {
    staffNumsToDelete = membersResult.body.map((m: any) => m.staffNum).filter(Boolean);
    log(`发现 ${staffNumsToDelete.length} 个成员待删除`);
  }

  // 步骤2: 逐个删除成员（通过队列）
  const deleteQueue: QueueItem[] = staffNumsToDelete.map(staffNum => ({
    label: `删除 ${staffNum}`,
    fn: () => httpRequestRaw(endpoint, '/memberDelete', { staffNum }, 10000),
    resolve: (v) => { log(`删除 ${staffNum}: errorCode=${v.errorCode}`); },
    reject: (e) => { log(`删除 ${staffNum} 异常: ${e.message}`); },
  }));
  await processQueue(deleteQueue, intervalMs, logs);

  // 步骤3: 读取测试成员
  const testMemberData = readTestMember();
  if (!testMemberData) {
    log('❌ 找不到测试成员数据文件');
    return logs;
  }
  const testMember = testMemberData.member;
  log(`测试成员: ${testMember.name} (${testMember.staffNum})`);

  log('步骤3: BMP转换...');
  const leftIrisBmp = await convertToBmpBase64(testMember.irisLeftImage);
  const rightIrisBmp = await convertToBmpBase64(testMember.irisRightImage);
  log(`BMP转换完成: left=${leftIrisBmp.length} chars, right=${rightIrisBmp.length} chars`);

  // 步骤4: 队列串行 — 锁定 → 间隔 → 上传 → 间隔 → 重新锁定
  log('步骤4: 构建上传队列（锁定 → 间隔 → 上传 → 间隔 → 重新锁定）...');
  const requestData = {
    staffNum: aesEncrypt('11112222'),
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

  const uploadQueue: QueueItem[] = [
    {
      label: '上传前锁定',
      fn: () => httpRequestRaw(endpoint, '/memberSaveState', { ip: new URL(endpoint).hostname, state: 1 }, 10000),
      resolve: (v) => { log(`上传前锁定: errorCode=${(v as any)?.errorCode}`); },
      reject: (e) => { log(`上传前锁定异常: ${e.message}`); },
    },
    {
      label: 'memberSave上传',
      fn: () => httpRequestRaw(endpoint, '/memberSave', requestData, 30000),
      resolve: (v) => {
        const uploadResult = v as any;
        log(`上传响应: errorCode=${uploadResult.errorCode}`);
        const uploadSuccess = uploadResult.errorCode === 0 || uploadResult.errorCode === '0';
        if (!uploadSuccess) {
          log(`⚠️ 上传失败: errorCode=${uploadResult.errorCode}, errorInfo=${uploadResult.errorInfo || ''}`);
        }
      },
      reject: (e) => { log(`❌ 上传异常: ${e.message}`); },
    },
    {
      label: '重新锁定',
      fn: () => httpRequestRaw(endpoint, '/memberSaveState', { ip: new URL(endpoint).hostname, state: 1 }, 10000),
      resolve: (v) => { log(`重新锁定: errorCode=${(v as any)?.errorCode}`); },
      reject: (e) => { log(`重新锁定异常: ${e.message}`); },
    },
  ];
  await processQueue(uploadQueue, intervalMs, logs);

  log('=== Queue 模式测试完成 ===');
  return logs;
}

// ============================================================
// POST Handler
// ============================================================
export async function POST(request: NextRequest) {
  const allLogs: string[] = [];
  const log = (msg: string) => { const line = `[${bjt()}] [Diagnostics] ${msg}`; console.log(line); allLogs.push(line); };

  try {
    await initDatabase();

    const body = await request.json();
    const mode = body.mode as 'guard' | 'queue';
    const intervalMs = typeof body.intervalMs === 'number' ? body.intervalMs : 1500;

    if (!['guard', 'queue'].includes(mode)) {
      return NextResponse.json({ success: false, error: 'mode 必须是 "guard" 或 "queue"' }, { status: 400 });
    }

    // 获取虹膜设备
    const devices = await getDeviceConfigs();
    const irisDevice = devices.find(d => d.device_type === 'iris');
    if (!irisDevice) {
      return NextResponse.json({ success: false, error: '未找到虹膜设备配置' }, { status: 404 });
    }
    const endpoint = irisDevice.endpoint;
    log(`设备地址: ${endpoint}`);
    log(`模式: ${mode === 'guard' ? 'Guard（并发发起）' : 'Queue（队列串行）'}`);
    log(`指令间隔: ${intervalMs}ms`);

    let logs: string[];
    if (mode === 'guard') {
      logs = await runGuardTest(endpoint, intervalMs);
    } else {
      logs = await runQueueTest(endpoint, intervalMs);
    }

    // 保存日志到文件
    const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
    const diagDir = join(dataDir, 'iris-diagnostics');
    if (!existsSync(diagDir)) mkdirSync(diagDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${mode}_test_${timestamp}.log`;
    const filePath = join(diagDir, fileName);
    writeFileSync(filePath, logs.join('\n'), 'utf-8');
    log(`日志已保存: ${filePath}`);

    return NextResponse.json({
      success: true,
      mode,
      logFile: fileName,
      logs,
    });

  } catch (error) {
    console.error('[IrisDiagnostics] 异常:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
      logs: allLogs,
    }, { status: 500 });
  }
}

/**
 * 获取虹膜设备成员 API
 * POST /api/device/iris/members
 *
 * 从虹膜设备获取成员列表（包含虹膜图像），保存到本地用于测试。
 * 使用 irisRequest（通过命令队列），避免并发请求导致设备异常。
 *
 * 请求体：{ count?: number, needImages?: boolean }
 * 默认：count=100, needImages=true
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getDeviceConfigs } from '@/lib/sync-queue';
import { irisRequest } from '@/lib/device-sync';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// 东八区时间
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

    const body = await request.json().catch(() => ({}));
    const count = body.count || 100;
    const needImages = body.needImages !== false; // default true

    // 找虹膜设备
    const devices = await getDeviceConfigs();
    const irisDevice = devices.find(d => d.device_type === 'iris');
    if (!irisDevice) {
      return NextResponse.json({ success: false, error: '未找到虹膜设备配置', logs }, { status: 404 });
    }
    const endpoint = irisDevice.endpoint;
    log(`设备地址: ${endpoint}`);

    // 调用 /members 接口
    log(`获取成员列表: count=${count}, needImages=${needImages}`);
    const startTime = Date.now();

    const responseData: any = await irisRequest(endpoint, '/members', {
      count,
      key: '',
      lastStaffNumDec: '',
      needImages: needImages ? 1 : 0,
    }, 30000);

    const durationMs = Date.now() - startTime;
    log(`响应耗时: ${durationMs}ms`);
    log(`errorCode: ${responseData.errorCode}`);

    if (responseData.errorCode !== 0 && responseData.errorCode !== '0') {
      return NextResponse.json({
        success: false,
        error: `获取失败: errorCode=${responseData.errorCode}`,
        logs,
      }, { status: 200 });
    }

    const members = responseData.body || [];
    log(`获取到 ${members.length} 个成员`);

    // 分析图像格式
    let imageFormat = 'unknown';
    if (members.length > 0 && needImages) {
      const m = members[0];
      if (m.irisLeftImage) {
        const header = m.irisLeftImage.substring(0, 10);
        imageFormat = header.startsWith('BM') ? 'BMP' : header.startsWith('\xff\xd8') ? 'JPEG' : 'unknown';
      }
    }

    // 保存到本地文件
    const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
    const outputDir = join(dataDir, 'iris_test_members');
    mkdirSync(outputDir, { recursive: true });

    const outputFile = join(outputDir, 'device_members.json');
    writeFileSync(outputFile, JSON.stringify({ members, _meta: { count: members.length, format: imageFormat, timestamp: new Date().toISOString() } }, null, 2));
    log(`已保存到: ${outputFile}`);

    // 如果有图像且 needImages=true，单独保存第一个成员的完整数据用于测试
    if (members.length > 0 && needImages && members[0].irisLeftImage) {
      const testFile = join(outputDir, 'test_member.json');
      const testMember = {
        staffNum: members[0].staffNum,
        name: members[0].name,
        irisLeftImage: members[0].irisLeftImage,
        irisRightImage: members[0].irisRightImage,
        faceImage: members[0].faceImage || '',
        _format: imageFormat,
      };
      writeFileSync(testFile, JSON.stringify(testMember, null, 2));
      log(`已保存测试成员到: ${testFile}`);
    }

    return NextResponse.json({
      success: true,
      count: members.length,
      format: imageFormat,
      sampleMember: members.length > 0 ? {
        staffNum: members[0].staffNum,
        name: members[0].name,
        hasLeftImage: !!members[0].irisLeftImage,
        hasRightImage: !!members[0].irisRightImage,
        leftImageLength: members[0].irisLeftImage?.length || 0,
        rightImageLength: members[0].irisRightImage?.length || 0,
      } : null,
      savePath: outputFile,
      logs,
    });

  } catch (error) {
    console.error('[IrisMembers] 异常:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
      logs,
    }, { status: 500 });
  }
}

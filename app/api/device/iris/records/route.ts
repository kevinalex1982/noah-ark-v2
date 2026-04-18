/**
 * 虹膜设备代理 API
 * POST /api/device/iris/records
 * 查询虹膜设备识别记录
 */

import { NextResponse } from 'next/server';
import { getIrisEndpoint } from '@/lib/settings';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { startTime, endTime, count, lastCreateTime } = body;

    const endpoint = getIrisEndpoint();
    console.log(`[IrisProxy] 查询虹膜设备: ${endpoint}`);
    console.log(`[IrisProxy] startTime: ${startTime}, endTime: ${endTime}, count: ${count}, lastCreateTime: ${lastCreateTime}`);

    const requestBody = {
      count: count || 10,
      endTime: endTime || Date.now(),
      key: '',
      lastCreateTime: lastCreateTime || 0, // 关键参数：只返回比这个时间更新的记录
      needImages: 0,
      startTime: startTime || Date.now() - 3000,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

    try {
      const response = await fetch(`${endpoint}/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const data = await response.json();
      console.log(`[IrisProxy] 响应: errorCode=${data.errorCode}, 记录数=${data.body?.length || 0}`);

      return NextResponse.json({
        success: data.errorCode === 0 || data.errorCode === '0',
        data: data,
      });

    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      console.error(`[IrisProxy] 请求失败:`, fetchError.message);
      return NextResponse.json({
        success: false,
        error: '连接不上',
      }, { status: 401 });
    }

  } catch (error) {
    console.error('[IrisProxy] 异常:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 }
    );
  }
}
/**
 * 虹膜设备代理 API
 * POST /api/device/iris/records
 * 查询虹膜设备识别记录
 */

import { NextResponse } from 'next/server';
import { getIrisEndpoint } from '@/lib/settings';
import { irisRequest } from '@/lib/device-sync';

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
      lastCreateTime: lastCreateTime || 0,
      needImages: 0,
      startTime: startTime || Date.now() - 3000,
    };

    try {
      const data: any = await irisRequest(endpoint, '/records', requestBody, 10000);
      console.log(`[IrisProxy] 响应: errorCode=${data.errorCode}, 记录数=${data.body?.length || 0}`);

      return NextResponse.json({
        success: data.errorCode === 0 || data.errorCode === '0',
        data: data,
      });

    } catch (fetchError: any) {
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
/**
 * 掌纹设备代理 API
 * POST /api/device/palm/query
 * 代理前端请求到掌纹设备，避免跨域问题
 */

import { NextResponse } from 'next/server';
import http from 'http';
import { getPalmEndpoint } from '@/lib/settings';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { request: requestCode } = body;

    const endpoint = getPalmEndpoint();
    console.log(`[PalmProxy] 查询掌纹设备: ${endpoint}, request: ${requestCode}`);

    // 解析 endpoint
    const url = new URL(endpoint);
    const host = url.hostname;
    const port = parseInt(url.port) || 80;

    // sendData 不编码
    const sendData = JSON.stringify({ request: requestCode || '103' });
    const path = `/api?sendData=${sendData}`;

    return new Promise<Response>((resolve) => {
      const req = http.request(
        {
          hostname: host,
          port: port,
          path: path,
          method: 'POST',
          agent: false,
          timeout: 5000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            console.log(`[PalmProxy] 响应: ${data}`);
            try {
              const json = JSON.parse(data);
              resolve(NextResponse.json({
                success: true,
                data: json,
              }));
            } catch {
              resolve(NextResponse.json({
                success: false,
                error: 'JSON解析失败',
                raw: data,
              }));
            }
          });
        }
      );

      req.on('error', (error) => {
        console.error(`[PalmProxy] 请求失败:`, error.message);
        resolve(NextResponse.json({
          success: false,
          error: '连接不上',
        }, { status: 401 }));
      });

      req.on('timeout', () => {
        console.error(`[PalmProxy] 请求超时`);
        req.destroy();
        resolve(NextResponse.json({
          success: false,
          error: '连接不上',
        }, { status: 401 }));
      });

      req.end();
    });

  } catch (error) {
    console.error('[PalmProxy] 异常:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 }
    );
  }
}
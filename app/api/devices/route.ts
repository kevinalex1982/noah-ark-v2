/**
 * 设备状态缓存 API
 * GET /api/devices
 * 返回后端轮巡缓存的设备状态，不主动发请求到设备
 *
 * 轮巡由后端 device-poller.ts 自动执行
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getDeviceConfigs } from '@/lib/sync-queue';
import { getCachedDeviceStates } from '@/lib/device-poller';

export async function GET(request: NextRequest) {
  try {
    await initDatabase();

    const typeFilter = request.nextUrl.searchParams.get('type'); // palm | iris | null

    const devices = await getDeviceConfigs();
    const cacheStates = await getCachedDeviceStates();
    const cacheMap = new Map(devices.map((d, i) => [d.device_id, cacheStates[i]]));

    console.log('[API /devices] devices:', devices.map(d => d.device_id), 'cacheStates:', cacheStates.map((c, i) => `${devices[i]?.device_id}=${c.online}`));

    // 过滤
    const filteredDevices = typeFilter
      ? devices.filter(d => d.device_type === typeFilter)
      : devices;

    const deviceResults = filteredDevices.map(device => {
      const cache = cacheMap.get(device.device_id);
      return {
        id: device.device_id,
        name: device.device_name,
        type: device.device_type,
        ip: device.endpoint.replace('http://', '').split(':')[0],
        port: parseInt(device.endpoint.split(':').pop() || '0'),
        endpoint: device.endpoint,
        status: cache?.online ? 'online' : 'offline',
        lastSync: cache?.online ? cache.last_check : null,
        credential_count: cache?.credential_count ?? null,
      };
    });

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      devices: deviceResults,
    });
  } catch (error) {
    console.error('[API] 获取设备状态失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

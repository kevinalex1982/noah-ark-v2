/**
 * 系统设置 API
 * GET: 获取设置
 * POST: 更新设置
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSettings, updateSettings } from '@/lib/settings';

// GET /api/settings - 获取设置
export async function GET() {
  try {
    const settings = getSettings();
    return NextResponse.json({
      success: true,
      settings,
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}

// POST /api/settings - 更新设置
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // 验证参数
    const updates: {
      authTimeout?: number;
      successReturnTime?: number;
      irisEndpoint?: string;
      palmEndpoint?: string;
      deviceId?: string;
      maxPassLogs?: number;
      mqttBroker?: string;
      mqttUsername?: string;
      mqttPassword?: string;
      aesEnabled?: boolean;
    } = {};

    if (typeof body.authTimeout === 'number' && body.authTimeout > 0) {
      updates.authTimeout = Math.min(body.authTimeout, 300); // 最大300秒
    }

    if (typeof body.successReturnTime === 'number' && body.successReturnTime > 0) {
      updates.successReturnTime = Math.min(body.successReturnTime, 60); // 最大60秒
    }

    if (typeof body.irisEndpoint === 'string' && body.irisEndpoint.trim()) {
      updates.irisEndpoint = body.irisEndpoint.trim();
    }

    if (typeof body.palmEndpoint === 'string' && body.palmEndpoint.trim()) {
      updates.palmEndpoint = body.palmEndpoint.trim();
    }

    if (typeof body.deviceId === 'string' && body.deviceId.trim()) {
      updates.deviceId = body.deviceId.trim();
    }

    if (typeof body.maxPassLogs === 'number' && body.maxPassLogs >= 100) {
      updates.maxPassLogs = Math.min(body.maxPassLogs, 10000); // 最大10000条
    }

    if (typeof body.mqttBroker === 'string' && body.mqttBroker.trim()) {
      updates.mqttBroker = body.mqttBroker.trim();
    }

    if (typeof body.mqttUsername === 'string') {
      updates.mqttUsername = body.mqttUsername;
    }

    if (typeof body.mqttPassword === 'string') {
      updates.mqttPassword = body.mqttPassword;
    }

    if (typeof body.aesEnabled === 'boolean') {
      updates.aesEnabled = body.aesEnabled;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({
        success: false,
        error: '无效的参数',
      }, { status: 400 });
    }

    const settings = updateSettings(updates);

    // 如果修改了虹膜/掌纹设备地址，同步更新 device_config 数据库表
    // （MQTT 凭证下发使用 device_config 中的 endpoint，不是 settings.json）
    if (updates.irisEndpoint || updates.palmEndpoint) {
      try {
        const { getDatabase } = await import('@/lib/database');
        const db = getDatabase();
        const now = new Date().toISOString();

        if (updates.irisEndpoint) {
          const result = await db.execute({
            sql: `UPDATE device_config SET endpoint = ?, updated_at = ? WHERE device_type = 'iris'`,
            args: [updates.irisEndpoint, now],
          });
          console.log(`[Settings] 虹膜设备地址已更新: ${updates.irisEndpoint}, 影响行数: ${result.rowsAffected}`);
        }

        if (updates.palmEndpoint) {
          const result = await db.execute({
            sql: `UPDATE device_config SET endpoint = ?, updated_at = ? WHERE device_type = 'palm'`,
            args: [updates.palmEndpoint, now],
          });
          console.log(`[Settings] 掌纹设备地址已更新: ${updates.palmEndpoint}, 影响行数: ${result.rowsAffected}`);
        }
      } catch (error: any) {
        console.error('[Settings] 更新 device_config 失败:', error.message);
        // 不抛出错误，settings.json 已保存成功
      }
    }

    // 如果修改了设备ID或MQTT连接设置，需要刷新MQTT订阅和状态上报
    if (updates.deviceId || updates.mqttBroker || updates.mqttUsername || updates.mqttPassword) {
      try {
        const { refreshMqttSubscription } = await import('@/lib/mqtt-client');
        refreshMqttSubscription();
        console.log('[Settings] MQTT订阅已刷新');
      } catch (error: any) {
        console.error('[Settings] 刷新MQTT订阅失败:', error.message);
      }
    }

    return NextResponse.json({
      success: true,
      settings,
      message: '设置已保存并立即生效',
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
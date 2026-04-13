/**
 * MQTT 测试 API
 * 模拟 MQTT 下发消息并直接处理
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getDeviceConfigs, addToSyncQueue } from '@/lib/sync-queue';
import { processSyncQueue } from '@/lib/device-sync';

export async function POST(request: NextRequest) {
  try {
    await initDatabase();

    const body = await request.json();
    const { action, credentialType, personId, personName, content, irisLeftImage, irisRightImage, palmFeature } = body;

    console.log('[MQTT-Test] 模拟下发:', { action, credentialType, personId, personName });

    // 获取设备配置
    const devices = await getDeviceConfigs();
    const targetDevice = credentialType === 7
      ? devices.find(d => d.device_type === 'iris')
      : devices.find(d => d.device_type === 'palm');

    if (!targetDevice) {
      return NextResponse.json({
        success: false,
        error: `未找到${credentialType === 7 ? '虹膜' : '掌纹'}设备`,
      });
    }

    // 添加到队列
    const queueId = await addToSyncQueue({
      message_id: `mqtt-test-${Date.now()}`,
      device_id: targetDevice.device_id,
      credential_id: Date.now(),
      action: action || 'passport-add',
      payload: {
        personId,
        personName,
        credentialId: Date.now(),
        credentialType,
        content,
        irisLeftImage,
        irisRightImage,
        palmFeature,
      },
      max_retries: 3,
    });

    console.log(`[MQTT-Test] 已加入队列 #${queueId}`);

    // 立即处理队列
    console.log('[MQTT-Test] 开始处理队列...');
    const result = await processSyncQueue();
    console.log('[MQTT-Test] 队列处理完成:', result);

    return NextResponse.json({
      success: true,
      queueId,
      processed: result,
      device: targetDevice.device_name,
    });
  } catch (error: any) {
    console.error('[MQTT-Test] 错误:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
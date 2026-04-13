/**
 * 模拟更新凭证 API
 * POST /api/credentials/simulate-update
 *
 * 模拟MQTT下发端的更新操作：
 * 1. 从数据库读取凭证数据
 * 2. 通过 MQTT handler 处理（handlePassportUpdate）
 * 3. 执行完整的删除+添加流程
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { getCredentialById } from '@/lib/db-credentials';
import { getDeviceConfigs } from '@/lib/sync-queue';
import { handlePassportUpdate } from '@/lib/device-sync';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// 保存模拟更新的数据到文件（方便排查）
function saveSimulateUpdateLog(credentialId: number, data: any): void {
  try {
    const logDir = join(process.cwd(), 'data', 'mqtt_logs');
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    const fileName = `simulate-update_${credentialId}_${Date.now()}.json`;
    const filePath = join(logDir, fileName);
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[SimulateUpdate] 数据已保存到: ${fileName}`);
  } catch (error) {
    console.error('[SimulateUpdate] 保存日志失败:', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await initDatabase();

    const body = await request.json();
    const { credential_id, person_name } = body;

    if (!credential_id) {
      return NextResponse.json(
        { success: false, error: '缺少 credential_id' },
        { status: 400 }
      );
    }

    // 获取现有凭证数据
    const existing = await getCredentialById(credential_id);
    if (!existing) {
      return NextResponse.json(
        { success: false, error: '凭证不存在' },
        { status: 404 }
      );
    }

    console.log(`[SimulateUpdate] 更新凭证 ${credential_id}, type=${existing.type}`);

    // 只有虹膜(7)和掌纹(8)需要同步到设备
    if (existing.type !== 7 && existing.type !== 8) {
      return NextResponse.json({
        success: true,
        message: '数据库已更新，该凭证类型无需同步到设备',
      });
    }

    // 获取设备配置
    const devices = await getDeviceConfigs();
    const deviceType = existing.type === 7 ? 'iris' : 'palm';
    const device = devices.find(d => d.device_type === deviceType);

    if (!device) {
      return NextResponse.json({
        success: false,
        error: `未配置${deviceType === 'iris' ? '虹膜' : '掌纹'}设备`,
      });
    }

    // 构造 MQTT payload（和 MQTT 消息格式一致）
    const payload = {
      personId: existing.person_id,
      personName: person_name || existing.person_name,
      credentialId: existing.credential_id,
      credentialType: existing.type,
      content: existing.content || undefined,  // 虹膜数据在 content 中
      palmFeature: existing.palm_feature || undefined,  // 掌纹数据
      authTypeList: existing.auth_type_list?.split(',').map(Number) || [],
      action: 'update',
    };

    // 保存日志
    saveSimulateUpdateLog(credential_id, { device, payload });

    // 调用 MQTT handler 处理（统一的处理逻辑）
    const result = await handlePassportUpdate(device, payload);

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: `更新成功`,
        response: result.response,
      });
    } else {
      return NextResponse.json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    console.error('[SimulateUpdate] 更新失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    );
  }
}
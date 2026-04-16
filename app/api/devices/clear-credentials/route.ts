/**
 * 清空设备凭证数据 API
 * POST /api/devices/clear-credentials
 *
 * 功能：
 * 1. 只清空已连接设备（离线设备跳过）
 * 2. 删除设备上的所有凭证
 * 3. 记录清空操作日志到 sync_logs 表
 * 4. 清理数据库中的 credentials、sync_queue、sync_logs 相关记录
 *
 * 设备接口说明：
 * - 掌纹设备：POST /api?sendData={"request":"107"} （删除全部用户信息）
 * - 虹膜设备：获取所有人员 -> 逐个调用 memberDelete 删除
 */

import { NextResponse } from 'next/server';
import * as http from 'http';
import { getDeviceConfigs } from '@/lib/sync-queue';
import { checkDeviceStatus, clearIrisDevice } from '@/lib/device-sync';
import { initDatabase, getDatabase } from '@/lib/database';

// 清空结果类型
interface ClearResult {
  device_id: string;
  device_name: string;
  device_type: string;
  status: 'success' | 'failed' | 'skipped';
  message?: string;
  duration_ms: number;
}

/**
 * 清空掌纹设备所有用户（107 接口）
 * ⚠️ 必须使用 Node.js http 模块，sendData 不能编码！
 */
async function clearPalmDevice(
  endpoint: string
): Promise<{ success: boolean; response?: string; error?: string }> {
  const startTime = Date.now();
  console.log(`[PalmClear] 清空掌纹设备：${endpoint}`);

  // 解析 endpoint
  const url = new URL(endpoint);
  const host = url.hostname;
  const port = parseInt(url.port) || 80;

  // ⚠️ 关键：sendData 不能编码！
  const sendData = '{"request":"107"}';
  const path = `/api?sendData=${sendData}`;

  console.log(`[PalmClear] 请求路径: ${path}`);

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: host,
        port: port,
        path: path,
        method: 'POST',
        agent: false,
        timeout: 30000,
      },
      (res) => {
        const responseTime = Date.now() - startTime;
        console.log(`[PalmClear] HTTP 状态: ${res.statusCode}, 耗时: ${responseTime}ms`);

        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          console.log(`[PalmClear] 响应: ${data}`);

          try {
            const json = JSON.parse(data);
            // 响应码 200 表示成功
            if (json.code === '200') {
              console.log(`[PalmClear] ✅ 清空成功`);
              resolve({ success: true, response: data });
            } else {
              console.log(`[PalmClear] ❌ 清空失败: code=${json.code}, des=${json.des}`);
              resolve({
                success: false,
                error: `掌纹设备返回错误：code=${json.code}, response=${json.response}, des=${json.des}`
              });
            }
          } catch {
            console.error(`[PalmClear] JSON 解析失败: ${data}`);
            resolve({ success: false, error: 'JSON 解析失败: ' + data });
          }
        });
      }
    );

    req.on('error', (error) => {
      const responseTime = Date.now() - startTime;
      console.error(`[PalmClear] 请求失败 (${responseTime}ms):`, error.message);
      resolve({ success: false, error: error.message });
    });

    req.on('timeout', () => {
      console.error(`[PalmClear] 请求超时`);
      req.destroy();
      resolve({ success: false, error: '请求超时' });
    });

    req.end();
  });
}

export async function POST() {
  const startTime = Date.now();
  
  try {
    // 确保数据库已初始化
    await initDatabase();
    const db = getDatabase();
    
    // 1. 获取所有设备配置
    const devices = await getDeviceConfigs();
    
    console.log(`[Clear] 开始清空凭证，共 ${devices.length} 台设备`);
    
    const results: ClearResult[] = [];
    
    // 2. 遍历所有设备
    for (const device of devices) {
      const deviceStartTime = Date.now();
      
      try {
        // 3. 检查设备在线状态
        const statusResult = await checkDeviceStatus(device.device_type, device.endpoint);

        if (!statusResult.online) {
          console.log(`[Clear] 设备离线，跳过：${device.device_id}`);
          results.push({
            device_id: device.device_id,
            device_name: device.device_name,
            device_type: device.device_type,
            status: 'skipped',
            message: '设备离线',
            duration_ms: Date.now() - deviceStartTime,
          });
          continue;
        }
        
        console.log(`[Clear] 设备在线，开始清空：${device.device_id} (${device.device_type})`);
        
        // 4. 调用设备 API 清空凭证
        let clearSuccess = false;
        let clearMessage = '';

        if (device.device_type === 'palm') {
          // 掌纹设备：POST /api?sendData={"request":"107"} （删除全部用户信息）
          const result = await clearPalmDevice(device.endpoint);
          if (result.success) {
            clearSuccess = true;
            clearMessage = '掌纹凭证清空成功';
          } else {
            clearMessage = result.error || '掌纹设备清空失败';
          }
        } else if (device.device_type === 'iris') {
          // 虹膜设备：获取所有人员 -> 逐个删除
          console.log(`[Clear] 虹膜设备：开始逐个删除人员...`);
          const result = await clearIrisDevice(device.endpoint);
          if (result.success) {
            clearSuccess = true;
            clearMessage = `虹膜凭证清空成功，删除 ${result.deleted} 个人员`;
            if (result.failed > 0) {
              clearMessage += `，失败 ${result.failed} 个`;
            }
          } else {
            clearMessage = `虹膜设备清空失败：删除 ${result.deleted}，失败 ${result.failed}`;
            if (result.errors.length > 0) {
              clearMessage += ` - ${result.errors[0]}`;
            }
          }
        } else {
          clearMessage = `未知的设备类型：${device.device_type}`;
        }

        const durationMs = Date.now() - deviceStartTime;

        results.push({
          device_id: device.device_id,
          device_name: device.device_name,
          device_type: device.device_type,
          status: clearSuccess ? 'success' : 'failed',
          message: clearMessage,
          duration_ms: durationMs,
        });

        console.log(`[Clear] 设备清空完成：${device.device_id}, 状态：${clearSuccess ? 'success' : 'failed'}`);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const durationMs = Date.now() - deviceStartTime;

        console.error(`[Clear] 设备清空失败：${device.device_id}, 错误：${errorMessage}`);

        results.push({
          device_id: device.device_id,
          device_name: device.device_name,
          device_type: device.device_type,
          status: 'failed',
          message: errorMessage,
          duration_ms: durationMs,
        });
      }
    }

    // 5. 所有设备处理完后，统一清空数据库（避免外键约束问题）
    const hasSuccess = results.some(r => r.status === 'success');
    if (hasSuccess) {
      try {
        console.log('[Clear] 开始清空数据库记录...');

        // 删除顺序很重要：sync_logs (queue_id) -> sync_queue (id)
        await db.execute('DELETE FROM sync_logs');
        await db.execute('DELETE FROM sync_queue');
        await db.execute('DELETE FROM credentials');

        console.log('[Clear] 数据库记录已清空');
      } catch (dbError) {
        console.error('[Clear] 清空数据库失败:', dbError);
      }
    }
    
    // 统计结果
    const successCount = results.filter(r => r.status === 'success').length;
    const failedCount = results.filter(r => r.status === 'failed').length;
    const skippedCount = results.filter(r => r.status === 'skipped').length;
    
    console.log(`[Clear] 清空完成，总计：${results.length}, 成功：${successCount}, 失败：${failedCount}, 跳过：${skippedCount}`);
    
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        total: results.length,
        success: successCount,
        failed: failedCount,
        skipped: skippedCount,
      },
      results,
    });
    
  } catch (error) {
    console.error('[Clear] 清空凭证失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

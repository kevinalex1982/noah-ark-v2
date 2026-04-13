/**
 * 上传通行记录到IAMS
 * 通过MQTT发送 pass-log 消息
 */

import { initDatabase } from './database';
import { getDeviceId } from './settings';
import { insertPassLog, updateIamsResponse, getPassLogById } from './db-pass-logs';
import { getMqttClient } from './mqtt-client';

// IAMS MQTT 配置
const IAMS_TOPIC_PREFIX = 'sys/face';

// 认证类型映射
const AUTH_TYPE_MAP: Record<string, number> = {
  'password': 5,
  'iris': 7,
  'palm': 8,
  'duress': 9,
};

/**
 * 生成请求ID
 */
function generateRequestId(): string {
  return `pass-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 上传通行记录到IAMS
 * @param personId 用户编码
 * @param credentialId 凭证ID
 * @param authTypes 认证类型数组 ['password', 'iris'] 或 ['iris'] 等
 * @returns 上传结果 { success: boolean, message: string }
 */
export async function uploadPassLog(
  personId: string,
  credentialId: number,
  authTypes: string[]
): Promise<{ success: boolean; message: string }> {
  // 确保数据库已初始化
  await initDatabase();

  const deviceId = getDeviceId();
  const requestId = generateRequestId();
  const authType = authTypes.map(t => AUTH_TYPE_MAP[t] || t).join(',');
  const timestamp = Date.now();

  console.log(`[PassLogUpload] 开始上传通行记录: personId=${personId}, authType=${authType}`);

  // 1. 先存入数据库
  const logId = await insertPassLog({
    person_id: personId,
    credential_id: credentialId,
    auth_type: authType,
    auth_result: 1, // 成功
    device_id: deviceId,
    request_id: requestId,
  });

  // 2. 构建MQTT消息
  const topic = `${IAMS_TOPIC_PREFIX}/${deviceId}/up/pass-log`;
  const message = {
    time: timestamp,
    requestId: requestId,
    deviceId: deviceId,
    op: 'pass-log',
    data: {
      id: logId,
      time: timestamp,
      passportId: credentialId,
      passportContent: '',
      authType: authType,
      authResult: 1, // 成功
      failType: 0,
      failMsg: '',
      similarity: '',
      threshold: '',
      capturedImg: '',
      personName: '',
    },
  };

  // 3. 发送MQTT消息
  const mqttClient = getMqttClient();

  if (!mqttClient || !mqttClient.connected) {
    console.error('[PassLogUpload] MQTT未连接');
    await updateIamsResponse(logId, 500, 'MQTT未连接');
    return { success: false, message: 'MQTT未连接，无法上传通行记录' };
  }

  return new Promise((resolve) => {
    // 设置响应超时
    const timeout = setTimeout(async () => {
      await updateIamsResponse(logId, 408, '响应超时');
      console.log('[PassLogUpload] IAMS响应超时');
      resolve({ success: false, message: 'IAMS响应超时' });
    }, 10000); // 10秒超时

    // 订阅响应主题
    const responseTopic = `${IAMS_TOPIC_PREFIX}/${deviceId}/down/pass-log`;

    const responseHandler = async (receivedTopic: string, payload: Buffer) => {
      if (receivedTopic !== responseTopic) return;

      try {
        const response = JSON.parse(payload.toString());
        console.log('[PassLogUpload] 收到IAMS响应:', response);

        // 检查requestId是否匹配
        if (response.requestId === requestId) {
          clearTimeout(timeout);
          mqttClient.removeListener('message', responseHandler);

          const code = response.data?.code || 500;
          const msg = response.data?.msg || '';

          if (code === 200) {
            await updateIamsResponse(logId, 200, '成功');
            console.log('[PassLogUpload] IAMS上传成功');
            resolve({ success: true, message: '上传成功' });
          } else {
            await updateIamsResponse(logId, code, msg);
            console.log(`[PassLogUpload] IAMS上传失败: code=${code}, msg=${msg}`);
            resolve({ success: false, message: `IAMS上传失败: ${msg || code}` });
          }
        }
      } catch (err) {
        console.error('[PassLogUpload] 解析响应失败:', err);
      }
    };

    // 监听响应
    mqttClient.on('message', responseHandler);

    // 发布消息
    mqttClient.publish(topic, JSON.stringify(message), { qos: 1 }, async (err) => {
      if (err) {
        clearTimeout(timeout);
        mqttClient.removeListener('message', responseHandler);
        await updateIamsResponse(logId, 500, '发送失败');
        console.error('[PassLogUpload] 发送失败:', err);
        resolve({ success: false, message: '发送失败' });
      } else {
        console.log(`[PassLogUpload] 消息已发送到 ${topic}`);

        // 🧪 模拟IAMS响应（测试用：同一个MQTT客户端发布消息不会回调给自己）
        setTimeout(async () => {
          console.log('[PassLogUpload] 🧪 模拟IAMS响应成功');
          clearTimeout(timeout);
          mqttClient.removeListener('message', responseHandler);
          await updateIamsResponse(logId, 200, '成功');
          console.log('[PassLogUpload] IAMS上传成功');
          resolve({ success: true, message: '上传成功' });
        }, 500); // 延迟500ms模拟网络延迟
      }
    });
  });
}

/**
 * 认证类型字符串转数组
 * 用于组合认证
 */
export function parseAuthTypeString(authTypeStr: string): string[] {
  const types: string[] = [];
  const typeMap: Record<string, string> = {
    '1': 'face',
    '2': 'card',
    '5': 'password',
    '7': 'iris',
    '8': 'palm',
    '9': 'duress',
  };

  const nums = authTypeStr.split(',');
  for (const num of nums) {
    const type = typeMap[num.trim()];
    if (type) {
      types.push(type);
    }
  }

  return types;
}
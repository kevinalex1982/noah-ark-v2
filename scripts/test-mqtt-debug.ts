/**
 * 测试 MQTT 消息流程
 * 用于调试 MQTT 客户端和服务端的通信
 */

import mqtt, { MqttClient } from 'mqtt';
import * as fs from 'fs';
import * as path from 'path';

const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const DEVICE_ID = 'iris-device-001';
const TOPIC_PREFIX = 'sys/face';

function timestamp(): string {
  return new Date().toISOString();
}

async function main() {
  console.log(`[${timestamp()}] ========== MQTT 测试开始 ==========`);

  // 1. 连接 MQTT Broker
  console.log(`[${timestamp()}] 步骤1: 连接 MQTT Broker: ${MQTT_BROKER}`);

  const client: MqttClient = await new Promise((resolve, reject) => {
    const c = mqtt.connect(MQTT_BROKER, {
      clientId: `test-debug-${Date.now()}`,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
      clean: true,
    });

    c.on('connect', () => {
      console.log(`[${timestamp()}] ✅ 连接成功`);
      resolve(c);
    });

    c.on('error', (err) => {
      console.error(`[${timestamp()}] ❌ 连接失败: ${err.message}`);
      reject(err);
    });

    setTimeout(() => {
      reject(new Error('连接超时（10秒）'));
    }, 10000);
  });

  // 2. 订阅响应主题
  console.log(`[${timestamp()}] 步骤2: 订阅响应主题`);

  const responseTopics = [
    `${TOPIC_PREFIX}/${DEVICE_ID}/up/passport-add-result`,
    `${TOPIC_PREFIX}/${DEVICE_ID}/up/passport-update-result`,
    `${TOPIC_PREFIX}/${DEVICE_ID}/up/passport-delete-result`,
  ];

  await new Promise<void>((resolve, reject) => {
    client.subscribe(responseTopics, { qos: 1 }, (err) => {
      if (err) {
        console.error(`[${timestamp()}] ❌ 订阅失败: ${err.message}`);
        reject(err);
      } else {
        console.log(`[${timestamp()}] ✅ 已订阅响应主题`);
        resolve();
      }
    });
  });

  // 3. 设置消息监听
  let responseReceived = false;
  let responseTimeout: NodeJS.Timeout;

  client.on('message', (topic: string, payload: Buffer) => {
    console.log(`\n[${timestamp()}] ========== 收到响应 ==========`);
    console.log(`[${timestamp()}] 主题: ${topic}`);
    console.log(`[${timestamp()}] 内容: ${payload.toString()}`);
    console.log(`[${timestamp()}] ==============================\n`);

    try {
      const response = JSON.parse(payload.toString());
      if (response.status === 'success') {
        console.log(`[${timestamp()}] ✅ 服务端处理成功`);
      } else {
        console.log(`[${timestamp()}] ❌ 服务端处理失败: ${response.error}`);
      }
    } catch (e) {
      console.log(`[${timestamp()}] ⚠️ 无法解析响应`);
    }

    responseReceived = true;
    clearTimeout(responseTimeout);
  });

  // 4. 发送测试消息（passport-add）
  console.log(`[${timestamp()}] 步骤3: 发送测试消息`);

  const testMessage = {
    messageId: `test-debug-${Date.now()}`,
    deviceId: DEVICE_ID,
    personId: 'test-debug-user',
    personName: '测试用户',
    idCard: '123456789012345678',
    credentialId: Date.now(),
    credentialType: 7,  // 虹膜
    content: 'test-iris-left|==BMP-SEP==|test-iris-right',
    irisLeftImage: 'test-iris-left',
    irisRightImage: 'test-iris-right',
    authTypeList: [7],
    action: 'add',
    timestamp: Date.now(),
  };

  const sendTopic = `${TOPIC_PREFIX}/${DEVICE_ID}/down/passport-add`;
  const payload = JSON.stringify(testMessage);

  console.log(`[${timestamp()}] 发送主题: ${sendTopic}`);
  console.log(`[${timestamp()}] 消息ID: ${testMessage.messageId}`);
  console.log(`[${timestamp()}] 消息大小: ${payload.length} 字符`);

  await new Promise<void>((resolve, reject) => {
    client.publish(sendTopic, payload, { qos: 1 }, (err) => {
      if (err) {
        console.error(`[${timestamp()}] ❌ 发送失败: ${err.message}`);
        reject(err);
      } else {
        console.log(`[${timestamp()}] ✅ 消息发送成功，等待服务端响应...`);
        resolve();
      }
    });
  });

  // 5. 等待响应
  console.log(`[${timestamp()}] 步骤4: 等待服务端响应（最多30秒）`);

  await new Promise<void>((resolve) => {
    responseTimeout = setTimeout(() => {
      if (!responseReceived) {
        console.log(`\n[${timestamp()}] ⚠️ 30秒内未收到响应`);
        console.log(`[${timestamp()}] 可能原因：`);
        console.log(`  1. Next.js 服务未启动或未连接到 MQTT Broker`);
        console.log(`  2. 服务端处理消息时出错`);
        console.log(`  3. 服务端未订阅正确的主题`);
      }
      resolve();
    }, 30000);

    const checkInterval = setInterval(() => {
      if (responseReceived) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 1000);
  });

  // 6. 清理
  console.log(`\n[${timestamp()}] ========== 测试结束 ==========`);

  client.end();
  process.exit(0);
}

main().catch((error) => {
  console.error(`[${timestamp()}] ❌ 测试失败:`, error.message);
  process.exit(1);
});
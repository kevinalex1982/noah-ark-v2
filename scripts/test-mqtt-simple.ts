/**
 * 测试 MQTT 消息流程（简化版）
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
  console.log(`\n========================================`);
  console.log(`[${timestamp()}] MQTT 测试开始`);
  console.log(`========================================\n`);

  // 1. 连接 MQTT Broker
  console.log(`[${timestamp()}] [步骤1] 连接 MQTT Broker: ${MQTT_BROKER}`);

  const client: MqttClient = await new Promise((resolve, reject) => {
    const c = mqtt.connect(MQTT_BROKER, {
      clientId: `test-simple-${Date.now()}`,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
      clean: true,
    });

    c.on('connect', () => {
      console.log(`[${timestamp()}] ✅ 连接成功\n`);
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

  // 2. 发送测试消息
  console.log(`[${timestamp()}] [步骤2] 发送测试消息`);

  const testMessage = {
    messageId: `test-${Date.now()}`,
    deviceId: DEVICE_ID,
    personId: 'test-user-001',
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
  console.log(`[${timestamp()}] personId: ${testMessage.personId}`);

  await new Promise<void>((resolve) => {
    client.publish(sendTopic, payload, { qos: 1 }, (err) => {
      if (err) {
        console.error(`[${timestamp()}] ❌ 发送失败: ${err.message}`);
      } else {
        console.log(`[${timestamp()}] ✅ 消息已发送\n`);
      }
      resolve();
    });
  });

  // 3. 等待几秒让服务端处理
  console.log(`[${timestamp()}] [步骤3] 等待5秒让服务端处理...`);
  await new Promise(r => setTimeout(r, 5000));

  // 4. 检查数据库是否有记录
  console.log(`\n[${timestamp()}] [步骤4] 检查数据库记录`);

  const { execSync } = await import('child_process');
  try {
    const result = execSync(`sqlite3 data/noah-ark.db "SELECT id, message_id, action, status FROM sync_queue ORDER BY id DESC LIMIT 5"`, { encoding: 'utf-8' });
    console.log(`[${timestamp()}] sync_queue 记录:\n${result || '(空)'}`);
  } catch (e) {
    console.log(`[${timestamp()}] ⚠️ 无法读取数据库`);
  }

  // 清理
  client.end();
  console.log(`\n[${timestamp()}] 测试结束`);
  process.exit(0);
}

main().catch((error) => {
  console.error(`\n[${timestamp()}] ❌ 测试失败:`, error.message);
  process.exit(1);
});
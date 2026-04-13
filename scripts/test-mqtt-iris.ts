/**
 * MQTT 虹膜发送测试脚本
 * 测试 person_id=123456 的虹膜数据发送
 */

const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');

// 读取虹膜数据
const irisDataPath = path.join(process.cwd(), 'data', 'iris_user_123_full_20260317_214108.json');
const irisData = JSON.parse(fs.readFileSync(irisDataPath, 'utf-8'));
const user = Array.isArray(irisData) ? irisData[0] : irisData;

// 修改person_id为123456
const personId = '123456';
const personName = 'mqtt_test_user';

// 构造MQTT消息
const message = {
  messageId: `test-iris-mqtt-${Date.now()}`,
  deviceId: 'iris-device-001',
  personId: personId,
  personName: personName,
  idCard: user.staffNumDec,
  credentialId: Date.now(),
  credentialType: 7,
  content: user.irisLeftImage + '|==BMP-SEP==|' + user.irisRightImage,
  action: 'add',
  timestamp: Date.now()
};

console.log('=== MQTT 虹膜发送测试 ===');
console.log('person_id:', personId);
console.log('person_name:', personName);
console.log('content长度:', message.content.length);
console.log('messageId:', message.messageId);
console.log('');

// 连接MQTT broker
const broker = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
console.log('连接MQTT broker:', broker);

const client = mqtt.connect(broker, {
  username: process.env.MQTT_USERNAME || '',
  password: process.env.MQTT_PASSWORD || '',
  clientId: `mqtt-test-${Date.now()}`,
  reconnectPeriod: 0,  // 不自动重连
  connectTimeout: 10000
});

client.on('connect', () => {
  console.log('✅ MQTT连接成功');

  const topic = 'sys/face/iris-device-001/down/passport-add';
  const payload = JSON.stringify(message);

  console.log('发送主题:', topic);
  console.log('发送时间:', new Date().toISOString());

  client.publish(topic, payload, { qos: 1 }, (err: Error | null) => {
    if (err) {
      console.error('❌ 发送失败:', err);
      process.exit(1);
    }

    console.log('✅ 消息已发送');
    console.log('');
    console.log('等待服务器处理...');

    // 等待30秒后检查结果
    setTimeout(async () => {
      client.end();

      // 检查数据库结果
      const { execSync } = require('child_process');
      const dbPath = path.join(process.cwd(), 'data', 'noah-ark.db');

      try {
        const result = execSync(`sqlite3 "${dbPath}" "SELECT id, status, error_message FROM sync_queue WHERE message_id='${message.messageId}'"`, { encoding: 'utf-8' });
        console.log('');
        console.log('=== 数据库结果 ===');
        console.log(result || '未找到记录');

        // 检查credentials表
        const credResult = execSync(`sqlite3 "${dbPath}" "SELECT credential_id, person_id, person_name FROM credentials WHERE person_id='${personId}'"`, { encoding: 'utf-8' });
        console.log('');
        console.log('=== 凭证表结果 ===');
        console.log(credResult || '未找到凭证');
      } catch (e: unknown) {
        console.error('查询数据库失败:', (e as Error).message);
      }

      process.exit(0);
    }, 30000);
  });
});

client.on('error', (err: Error) => {
  console.error('❌ MQTT连接错误:', err.message);
  process.exit(1);
});

client.on('close', () => {
  console.log('MQTT连接已关闭');
});

// 60秒超时
setTimeout(() => {
  console.error('❌ 测试超时');
  client.end();
  process.exit(1);
}, 60000);
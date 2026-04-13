/**
 * MQTT 虹膜压力测试
 * 循环5次：添加 → 删除
 * 时间间隔：锁定200ms → 添加 → 200ms解锁 → 500ms → 删除 → 500ms
 */

const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');

// 测试配置
const TEST_PERSON_ID = '123456';
const TEST_PERSON_NAME = 'test_user';
const TEST_LOOPS = 5;

// 日志保存路径
const LOG_DIR = path.join(__dirname, '../docs/测试');
const LOG_FILE = path.join(LOG_DIR, `压力测试日志_${new Date().toISOString().replace(/[:.]/g, '-')}.md`);

// 测试结果
const testResults = [];

function log(msg) {
  const time = new Date().toISOString();
  const line = `[${time}] ${msg}`;
  console.log(line);
  testResults.push(line);
}

function saveLog() {
  const content = `# MQTT 虹膜压力测试日志

## 测试时间
${new Date().toLocaleString('zh-CN')}

## 测试配置
- person_id: ${TEST_PERSON_ID}
- person_name: ${TEST_PERSON_NAME}
- 循环次数: ${TEST_LOOPS}

## 测试流程

每轮流程：
1. 锁定设备
2. 等待 200ms
3. 添加数据
4. 等待 200ms
5. 解锁设备
6. 等待 500ms
7. 删除数据
8. 等待 500ms
9. 下一轮

## 完整日志

\`\`\`
${testResults.join('\n')}
\`\`\`
`;

  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
  fs.writeFileSync(LOG_FILE, content, 'utf-8');
  console.log(`\n日志已保存到: ${LOG_FILE}`);
}

// 读取虹膜数据
function loadIrisData() {
  const irisDataPath = path.join(__dirname, '../data/iris_user_123_full_20260317_214108.json');
  const irisData = JSON.parse(fs.readFileSync(irisDataPath, 'utf-8'));
  const user = Array.isArray(irisData) ? irisData[0] : irisData;
  return {
    leftIris: user.irisLeftImage,
    rightIris: user.irisRightImage,
    staffNumDec: user.staffNumDec
  };
}

// 发送MQTT消息
function sendMqttMessage(client, action, message) {
  return new Promise((resolve, reject) => {
    const topic = `sys/face/iris-device-001/down/${action}`;
    const payload = JSON.stringify(message);

    log(`[MQTT] 发送到: ${topic}`);
    log(`[MQTT] messageId: ${message.messageId}`);

    client.publish(topic, payload, { qos: 1 }, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// 检查数据库状态
function checkDbStatus(messageId) {
  const { execSync } = require('child_process');
  const dbPath = path.join(__dirname, '../data/noah-ark.db');

  try {
    const result = execSync(`sqlite3 "${dbPath}" "SELECT status, error_message FROM sync_queue WHERE message_id='${messageId}'"`, { encoding: 'utf-8' });
    return result.trim();
  } catch (e) {
    return `查询失败: ${e.message}`;
  }
}

// 等待队列处理完成
async function waitForQueueProcess(messageId, maxWait = 90000) {
  const startTime = Date.now();
  const { execSync } = require('child_process');
  const dbPath = path.join(__dirname, '../data/noah-ark.db');

  while (Date.now() - startTime < maxWait) {
    try {
      const result = execSync(`sqlite3 "${dbPath}" "SELECT status FROM sync_queue WHERE message_id='${messageId}'"`, { encoding: 'utf-8' });
      const status = result.trim();
      if (status === 'success' || status === 'failed') {
        return status;
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 2000));
  }
  return 'timeout';
}

// 主测试流程
async function main() {
  log('=== 开始MQTT虹膜压力测试 ===');
  log(`测试person_id: ${TEST_PERSON_ID}`);
  log(`循环次数: ${TEST_LOOPS}`);

  const irisData = loadIrisData();
  const broker = process.env.MQTT_BROKER || 'mqtt://localhost:1883';

  // 连接MQTT
  log(`连接MQTT broker: ${broker}`);
  const client = mqtt.connect(broker, {
    username: process.env.MQTT_USERNAME || '',
    password: process.env.MQTT_PASSWORD || '',
    clientId: `mqtt-stress-test-${Date.now()}`,
    reconnectPeriod: 0,
    connectTimeout: 10000
  });

  await new Promise((resolve, reject) => {
    client.on('connect', resolve);
    client.on('error', reject);
    setTimeout(() => reject(new Error('连接超时')), 10000);
  });
  log('[MQTT] 连接成功');

  try {
    // 先清空数据库测试数据
    const { execSync } = require('child_process');
    const dbPath = path.join(__dirname, '../data/noah-ark.db');
    execSync(`sqlite3 "${dbPath}" "DELETE FROM credentials WHERE person_id='${TEST_PERSON_ID}'"`);
    execSync(`sqlite3 "${dbPath}" "DELETE FROM sync_queue WHERE message_id LIKE 'stress-iris-%'"`);
    log('[准备] 数据库测试数据已清理');

    // 等待5秒
    log('[准备] 等待5秒...');
    await new Promise(r => setTimeout(r, 5000));

    // 循环测试
    for (let i = 1; i <= TEST_LOOPS; i++) {
      log('');
      log(`==================== 第 ${i} 轮测试 ====================`);

      const credentialId = Date.now();

      // 1. 添加
      log(`[第${i}轮-添加] 发送添加消息`);
      const addMessage = {
        messageId: `stress-iris-add-${i}-${credentialId}`,
        deviceId: 'iris-device-001',
        personId: TEST_PERSON_ID,
        personName: TEST_PERSON_NAME,
        idCard: irisData.staffNumDec,
        credentialId: credentialId,
        credentialType: 7,
        content: irisData.leftIris + '|==BMP-SEP==|' + irisData.rightIris,
        action: 'add',
        timestamp: Date.now()
      };

      await sendMqttMessage(client, 'passport-add', addMessage);
      const addStatus = await waitForQueueProcess(addMessage.messageId, 60000);
      log(`[第${i}轮-添加] 状态: ${addStatus}`);
      log(`[第${i}轮-添加] 数据库: ${checkDbStatus(addMessage.messageId)}`);

      // 等待500ms
      log(`[第${i}轮] 等待500ms...`);
      await new Promise(r => setTimeout(r, 500));

      // 2. 删除
      log(`[第${i}轮-删除] 发送删除消息`);
      const deleteMessage = {
        messageId: `stress-iris-delete-${i}-${credentialId}`,
        deviceId: 'iris-device-001',
        personId: TEST_PERSON_ID,
        credentialId: credentialId,
        action: 'delete',
        timestamp: Date.now()
      };

      await sendMqttMessage(client, 'passport-delete', deleteMessage);
      const deleteStatus = await waitForQueueProcess(deleteMessage.messageId, 30000);
      log(`[第${i}轮-删除] 状态: ${deleteStatus}`);
      log(`[第${i}轮-删除] 数据库: ${checkDbStatus(deleteMessage.messageId)}`);

      // 等待500ms后下一轮
      log(`[第${i}轮] 等待500ms后下一轮...`);
      await new Promise(r => setTimeout(r, 500));
    }

    log('');
    log('=== 测试完成 ===');

  } finally {
    client.end();
    saveLog();
  }
}

main().catch(err => {
  console.error('测试失败:', err);
  testResults.push(`[错误] ${err.message}`);
  saveLog();
  process.exit(1);
});
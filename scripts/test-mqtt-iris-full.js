/**
 * MQTT 虹膜完整流程测试
 * 按1添加 → 按2修改 → 按3删除
 *
 * 测试日志保存到: docs/测试/
 */

const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');

// 测试配置
const TEST_PERSON_ID = '123456';
const TEST_PERSON_NAME = 'test_user';
const TEST_CREDENTIAL_ID = Date.now(); // 使用固定ID，保证增删改操作同一记录

// 日志保存路径
const LOG_DIR = path.join(__dirname, '../docs/测试');
const LOG_FILE = path.join(LOG_DIR, `测试日志_${new Date().toISOString().replace(/[:.]/g, '-')}.md`);

// 测试结果
const testResults = [];

function log(msg) {
  const time = new Date().toISOString();
  const line = `[${time}] ${msg}`;
  console.log(line);
  testResults.push(line);
}

function saveLog() {
  const content = `# MQTT 虹膜测试日志

## 测试时间
${new Date().toLocaleString('zh-CN')}

## 测试配置
- person_id: ${TEST_PERSON_ID}
- person_name: ${TEST_PERSON_NAME}
- credential_id: ${TEST_CREDENTIAL_ID}

## 测试流程

### 0. 清空测试数据

\`\`\`
${testResults.filter(r => r.includes('[清空]') || r.includes('[清空]')).join('\n')}
\`\`\`

### 1. 添加虹膜 (passport-add)

\`\`\`
${testResults.filter(r => r.includes('[添加]') || r.includes('[MQTT]')).join('\n')}
\`\`\`

### 2. 修改虹膜 (passport-update)

\`\`\`
${testResults.filter(r => r.includes('[修改]') || r.includes('[MQTT]')).join('\n')}
\`\`\`

### 3. 删除虹膜 (passport-delete)

\`\`\`
${testResults.filter(r => r.includes('[删除]') || r.includes('[MQTT]')).join('\n')}
\`\`\`

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
async function waitForQueueProcess(messageId, maxWait = 60000) {
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

// 清空设备上的测试数据
async function clearTestData(client) {
  log('=== 清空设备测试数据 ===');

  // 先删除设备上的数据（如果有）
  const deleteMessage = {
    messageId: `test-iris-clear-${Date.now()}`,
    deviceId: 'iris-device-001',
    personId: TEST_PERSON_ID,
    credentialId: TEST_CREDENTIAL_ID,
    action: 'delete',
    timestamp: Date.now()
  };

  await sendMqttMessage(client, 'passport-delete', deleteMessage);
  log('[清空] 删除消息已发送，等待处理...');

  // 等待处理完成
  await new Promise(r => setTimeout(r, 5000));

  // 删除数据库中的测试数据
  const { execSync } = require('child_process');
  const dbPath = path.join(__dirname, '../data/noah-ark.db');
  try {
    execSync(`sqlite3 "${dbPath}" "DELETE FROM credentials WHERE person_id='${TEST_PERSON_ID}'"`);
    execSync(`sqlite3 "${dbPath}" "DELETE FROM sync_queue WHERE message_id LIKE 'test-iris-%'"`);
    log('[清空] 数据库测试数据已清理');
  } catch (e) {
    log(`[清空] 数据库清理失败: ${e.message}`);
  }

  // 等待5秒让设备恢复
  log('[清空] 等待5秒让设备恢复...');
  await new Promise(r => setTimeout(r, 5000));
}

// 主测试流程
async function main() {
  log('=== 开始MQTT虹膜测试 ===');
  log(`测试person_id: ${TEST_PERSON_ID}`);
  log(`测试credential_id: ${TEST_CREDENTIAL_ID}`);

  const irisData = loadIrisData();
  const broker = process.env.MQTT_BROKER || 'mqtt://localhost:1883';

  // 连接MQTT
  log(`连接MQTT broker: ${broker}`);
  const client = mqtt.connect(broker, {
    username: process.env.MQTT_USERNAME || '',
    password: process.env.MQTT_PASSWORD || '',
    clientId: `mqtt-test-${Date.now()}`,
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
    // ==================== 0. 清空测试数据 ====================
    log('');
    await clearTestData(client);
    // ==================== 1. 添加虹膜 ====================
    log('');
    log('=== [添加] 开始添加虹膜 ===');

    const addMessage = {
      messageId: `test-iris-add-${TEST_CREDENTIAL_ID}`,
      deviceId: 'iris-device-001',
      personId: TEST_PERSON_ID,
      personName: TEST_PERSON_NAME,
      idCard: irisData.staffNumDec,
      credentialId: TEST_CREDENTIAL_ID,
      credentialType: 7,
      content: irisData.leftIris + '|==BMP-SEP==|' + irisData.rightIris,
      action: 'add',
      timestamp: Date.now()
    };

    await sendMqttMessage(client, 'passport-add', addMessage);
    log('[添加] 消息已发送，等待处理...');

    const addStatus = await waitForQueueProcess(addMessage.messageId);
    log(`[添加] 队列状态: ${addStatus}`);
    log(`[添加] 数据库结果: ${checkDbStatus(addMessage.messageId)}`);

    // 等待10秒让设备恢复
    log('[添加] 等待10秒让设备恢复...');
    await new Promise(r => setTimeout(r, 10000));

    // ==================== 2. 修改虹膜 ====================
    log('');
    log('=== [修改] 开始修改虹膜 ===');

    const updateMessage = {
      messageId: `test-iris-update-${TEST_CREDENTIAL_ID}`,
      deviceId: 'iris-device-001',
      personId: TEST_PERSON_ID,
      personName: TEST_PERSON_NAME + '_updated', // 修改姓名
      idCard: irisData.staffNumDec,
      credentialId: TEST_CREDENTIAL_ID, // 使用相同的credential_id
      credentialType: 7,
      content: irisData.leftIris + '|==BMP-SEP==|' + irisData.rightIris,
      action: 'update',
      timestamp: Date.now()
    };

    await sendMqttMessage(client, 'passport-update', updateMessage);
    log('[修改] 消息已发送，等待处理...');

    const updateStatus = await waitForQueueProcess(updateMessage.messageId, 90000); // 更新需要更长时间（删除+添加）
    log(`[修改] 队列状态: ${updateStatus}`);
    log(`[修改] 数据库结果: ${checkDbStatus(updateMessage.messageId)}`);

    // 等待10秒让设备恢复
    log('[修改] 等待10秒让设备恢复...');
    await new Promise(r => setTimeout(r, 10000));

    // ==================== 3. 删除虹膜 ====================
    log('');
    log('=== [删除] 开始删除虹膜 ===');

    const deleteMessage = {
      messageId: `test-iris-delete-${TEST_CREDENTIAL_ID}`,
      deviceId: 'iris-device-001',
      personId: TEST_PERSON_ID,
      credentialId: TEST_CREDENTIAL_ID,
      action: 'delete',
      timestamp: Date.now()
    };

    await sendMqttMessage(client, 'passport-delete', deleteMessage);
    log('[删除] 消息已发送，等待处理...');

    const deleteStatus = await waitForQueueProcess(deleteMessage.messageId);
    log(`[删除] 队列状态: ${deleteStatus}`);
    log(`[删除] 数据库结果: ${checkDbStatus(deleteMessage.messageId)}`);

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
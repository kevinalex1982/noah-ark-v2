/**
 * MQTT 测试客户端
 * 用于测试 Broker 是否正常工作
 */

const mqtt = require('mqtt');

console.log('[Test Client] 🚀 正在连接 mqtt://localhost:1883 ...');

const client = mqtt.connect('mqtt://localhost:1883', {
  clientId: `test-client-${Date.now()}`,
  reconnectPeriod: 5000,
  connectTimeout: 30000,
});

client.on('connect', () => {
  console.log('[Test Client] ✅ 连接到 Broker 成功');
  
  // 订阅主题
  client.subscribe('sys/face/+/down/passport-add', (err) => {
    if (err) {
      console.error('[Test Client] ❌ 订阅失败:', err);
    } else {
      console.log('[Test Client] ✅ 订阅成功：sys/face/+/down/passport-add');
    }
  });
  
  // 发送测试消息
  setTimeout(() => {
    const testMessage = {
      messageId: 'test-' + Date.now(),
      deviceId: 'device-001',
      personId: 'person-001',
      personName: '测试人员',
      credentialId: 1,
      credentialType: 1,
      action: 'add',
      timestamp: Date.now(),
    };
    
    console.log('[Test Client] 📤 发送测试消息...');
    client.publish('sys/face/device-001/down/passport-add', JSON.stringify(testMessage), { qos: 1 }, (err) => {
      if (err) {
        console.error('[Test Client] ❌ 发送失败:', err);
      } else {
        console.log('[Test Client] ✅ 消息发送成功');
      }
    });
  }, 1000);
});

client.on('message', (topic, message) => {
  console.log('[Test Client] 📥 收到消息:', topic);
  console.log('[Test Client] 📄 Payload:', message.toString());
});

client.on('error', (err) => {
  console.error('[Test Client] ❌ 错误:', err.message);
});

client.on('close', () => {
  console.log('[Test Client] 🔌 连接已断开');
});

client.on('reconnect', () => {
  console.log('[Test Client] 🔄 正在重新连接...');
});

// 10 秒后退出
setTimeout(() => {
  console.log('[Test Client] ⏹️ 测试完成，退出');
  client.end();
  process.exit(0);
}, 10000);

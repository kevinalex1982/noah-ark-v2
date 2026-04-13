/**
 * 简单的 MQTT Broker - 使用 Aedes
 * 用于模拟 IAMS 平台
 * 
 * Aedes 是现代、轻量、维护中的 MQTT Broker 库
 * 替代已停止维护的 Mosca
 */

const net = require('net');

async function startBroker() {
  // 动态导入 ES Module - Aedes v1.0+ 导出 Aedes 类
  const { Aedes } = await import('aedes');
  
  // 使用静态方法 createBroker()
  const broker = await Aedes.createBroker();
  const server = net.createServer(broker.handle);

  server.listen(1883, () => {
    console.log('[MQTT Broker] ✅ ====================================');
    console.log('[MQTT Broker] ✅  MQTT Broker 启动成功');
    console.log('[MQTT Broker] ✅  端口：1883');
    console.log('[MQTT Broker] ✅  协议：TCP/MQTT');
    console.log('[MQTT Broker] ✅ ====================================');
    console.log('[MQTT Broker] 🎯 等待客户端连接...');
  });

  broker.on('client', (client) => {
    console.log('[MQTT Broker] 📡 新客户端连接:', client.id);
  });

  broker.on('clientDisconnect', (client) => {
    console.log('[MQTT Broker] 🔌 客户端断开:', client ? client.id : 'unknown');
  });

  broker.on('publish', (packet, client) => {
    if (client) {
      console.log('[MQTT Broker] 📤 收到消息:', packet.topic);
      if (packet.payload && packet.payload.length > 0) {
        const payloadStr = packet.payload.toString('utf8');
        console.log('[MQTT Broker] 📄 Payload:', payloadStr.substring(0, 200));
      }
    }
  });

  broker.on('subscribe', (subscriptions, client) => {
    if (client) {
      console.log('[MQTT Broker] 📥 客户端订阅:', client.id, '-', subscriptions.map(s => s.topic).join(', '));
    }
  });

  broker.on('unsubscribe', (subscriptions, client) => {
    if (client) {
      console.log('[MQTT Broker] 📤 客户端取消订阅:', client.id, '-', subscriptions.join(', '));
    }
  });

  broker.on('clientError', (client, error) => {
    console.error('[MQTT Broker] ❌ 客户端错误:', client ? client.id : 'unknown', error.message);
  });

  broker.on('connectionError', (conn, error) => {
    console.error('[MQTT Broker] ❌ 连接错误:', error.message);
  });

  process.on('SIGINT', () => {
    console.log('\n[MQTT Broker] ⏹️ 正在关闭...');
    broker.close(() => {
      server.close(() => {
        console.log('[MQTT Broker] ✅ 已关闭');
        process.exit(0);
      });
    });
  });
}

startBroker().catch(err => {
  console.error('[MQTT Broker] ❌ 启动失败:', err);
  process.exit(1);
});

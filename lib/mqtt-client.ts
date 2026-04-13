/**
 * MQTT 客户端模块
 * 模拟 IAMS 上级平台，接收凭证下发指令
 *
 * ⚠️ 注意：所有错误必须本地捕获，不能 propagate 到进程级别
 */

import mqtt, { MqttClient } from 'mqtt';
import { getDeviceConfigs, initSyncTables, addToSyncQueue, addSyncLog, updateQueueStatus } from './sync-queue';
import { handlePassportAdd, handlePassportUpdate, handlePassportDelete, clearIrisDevice, clearPalmDevice } from './device-sync';
import { getMqttBroker, getMqttUsername, getMqttPassword, getDeviceId } from './settings';
import { getDeviceAttrs, updateDeviceAttrs, clearPassportVer } from './db-device-attrs';
import { clearAllCredentials, upsertCredential, updateCredentialAttributes, getCredentialById, deleteCredential } from './db-credentials';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

// 东八区时间格式化
function bjt(): string {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

// 简单内存队列
const messageQueue: Array<{
  deviceId: string;
  action: string;
  message: any;
}> = [];

let isProcessing = false;

// 处理队列
// ⚠️ 关键：成功失败都记录到数据库，都从内存队列移除，不重试
async function processQueue() {
  if (isProcessing || messageQueue.length === 0) {
    return;
  }

  isProcessing = true;

  while (messageQueue.length > 0) {
    const item = messageQueue.shift();
    if (!item) break;

    console.log(`${bjt()} [MQTT] 队列处理 ${item.action}, 剩余 ${messageQueue.length} 条`);

    try {
      const result = await processMessage(item.deviceId, item.action, item.message);

      // ⚠️ IAMS 期望的响应格式（参考 IAMS_protocol.txt 第149-159行）
      // 响应主题和下发主题的op一样，只是 down 改成 up
      const requestId = item.message.requestId || item.message.messageId;

      // ⚠️ 从请求中提取需要返回的字段
      const reqData = item.message.data || {};

      // ⚠️ 使用 result.code（如果有），否则根据 success 计算
      const responseCode = result.code ?? (result.success ? 200 : 500);

      const responsePayload = {
        time: Date.now(),
        requestId: requestId,
        deviceId: item.deviceId,
        op: item.action,
        data: {
          code: responseCode,
          msg: result.error || result.response || '',
          passportVer: reqData.passportVer || '',   // ⚠️ 凭证库版本号，从请求中获取
          opId: reqData.opId || '',                 // ⚠️ 操作id，从请求中获取
          personType: reqData.personType || 'n',    // ⚠️ 人员类型，从请求中获取
        }
      };

      // ⚠️ 响应主题：sys/face/{deviceId}/up/{action}
      await publishUpstream(item.deviceId, item.action, responsePayload);
      console.log(`${bjt()} [MQTT] 响应 ${item.action} code=${responseCode}`);

      if (result.success) {
        console.log(`${bjt()} [MQTT] ✅ ${item.action} 成功`);
      } else {
        console.log(`${bjt()} [MQTT] ❌ ${item.action} 失败: ${result.error}`);
      }

    } catch (e: any) {
      console.error(`${bjt()} [MQTT] ❌ ${item.action} 异常: ${e.message}`);

      // 发送异常响应
      const requestId = item.message.requestId || item.message.messageId;
      const reqData = item.message.data || {};

      await publishUpstream(item.deviceId, item.action, {
        time: Date.now(),
        requestId: requestId,
        deviceId: item.deviceId,
        op: item.action,
        data: {
          code: 402,  // ⚠️ 系统错误
          msg: e.message,
          passportVer: reqData.passportVer || '',
          opId: reqData.opId || '',
          personType: reqData.personType || 'n',
        }
      });
    }

    // 等待200ms再处理下一个
    if (messageQueue.length > 0) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  isProcessing = false;
}

// 处理单条消息
// ⚠️ 关键：保存下发记录到数据库，成功失败都记录
// ⚠️ IAMS 格式：从 message.data.xxx 读取数据，op 从 message.op 获取
// ⚠️ deviceId 是认证终端ID，跟虹膜/掌纹设备无关，只有 type 才决定操作哪个设备
// ⚠️ passport-del 消息没有 type，需要先查数据库获取凭证类型
async function processMessage(
  deviceId: string,
  action: string,
  message: any
): Promise<{ success: boolean; error?: string; response?: string; code?: number }> {
  const startTime = Date.now();

  // ⚠️ IAMS 格式：从 message.data 读取业务数据
  const data = message.data || {};
  const op = message.op || action;  // 操作类型优先从 message.op 获取
  let credentialType = data.type;  // 凭证类型：5=密码, 7=虹膜, 8=掌纹, 9=胁迫码

  // ⚠️ passport-del 消息没有 type，需要先查数据库获取凭证类型
  if (op === 'passport-del' && !credentialType && data.id) {
    const cred = await getCredentialById(data.id);
    if (cred) {
      credentialType = cred.type;
      console.log(`${bjt()} [MQTT] 删除: 查得凭证类型=${credentialType}`);
    } else {
      console.log(`${bjt()} [MQTT] 删除: 凭证不存在`);
      return { success: true, response: '凭证不存在', code: 404 };
    }
  }

  // 判断是否需要操作物理设备
  const needDevice = credentialType === 7 || credentialType === 8;  // 虹膜或掌纹

  // 如果需要设备，获取对应的设备配置
  let device: any = null;
  if (needDevice) {
    const devices = await getDeviceConfigs();
    // 根据凭证类型找对应设备
    if (credentialType === 7) {
      device = devices.find(d => d.device_type === 'iris');
    } else if (credentialType === 8) {
      device = devices.find(d => d.device_type === 'palm');
    }

    if (!device) {
      const deviceType = credentialType === 7 ? '虹膜' : '掌纹';
      return { success: false, error: `${deviceType}设备未配置` };
    }

    console.log(`${bjt()} [MQTT] 设备: ${device.device_name} (${device.device_type}), endpoint=${device.endpoint}`);
  }

  // 解析虹膜数据（从 content 字段）
  let irisLeftImage = '';
  let irisRightImage = '';

  if (data.type === 7 && data.content) {
    const irisData = parseIrisContent(data.content);
    irisLeftImage = irisData.leftIris;
    irisRightImage = irisData.rightIris;
  }

  // ⚠️ IAMS 字段映射：data.id -> credentialId, data.type -> credentialType
  // ⚠️ passport-del 消息没有 personId，需要用 credentialId 查数据库
  const payload = {
    personId: data.personId,
    personName: data.personName || data.personId || '',  // 默认用 personId
    credentialId: data.id,           // ⚠️ id -> credentialId
    credentialType: data.type,       // ⚠️ type -> credentialType
    content: data.content,
    irisLeftImage,
    irisRightImage,
    palmFeature: data.type === 8 ? data.content : undefined,  // 掌纹特征在 content 中
    authTypeList: data.authTypeList ? data.authTypeList.split(',').map(Number) : [],
    showInfo: data.showInfo,
    tags: data.tags,
    enable: data.enable,
    authModel: data.authModel,
    boxList: data.boxList,
  };

  // ⚠️ 关键：先保存到 sync_queue（创建下发记录）
  // 密码(5)和胁迫码(9)不进下发记录（纯数据库操作）
  const needSyncLog = credentialType === 7 || credentialType === 8;  // 虹膜或掌纹

  const queueId = needSyncLog ? await addToSyncQueue({
    message_id: message.requestId,   // ⚠️ requestId -> message_id
    device_id: deviceId,
    credential_id: data.id,
    action: op,  // passport-add, passport-update, passport-del
    payload: payload,
  }) : 0;

  if (needSyncLog) {
    console.log(`${bjt()} [MQTT] 记录: queueId=${queueId}, op=${op}, credentialId=${data.id}`);
  }

  // 执行设备同步
  // ⚠️ 注意：passport-del 不是 passport-delete
  let result: { success: boolean; response?: string; error?: string };

  try {
    // ⚠️ 密码(5)和胁迫码(9)不需要设备，直接存数据库
    if (credentialType === 5 || credentialType === 9) {
      if (op === 'passport-add') {
        // ⚠️ 检查凭证是否已存在
        const existingCred = await getCredentialById(data.id);
        if (existingCred) {
          console.log(`${bjt()} [MQTT] 凭证已存在, 跳过`);
          result = { success: true, response: '凭证已存在' };
        } else {
          await upsertCredential({
            person_id: data.personId || '',
            person_name: data.personName || data.personId || '',  // 默认用 personId
            credential_id: data.id,
            type: credentialType,
            content: data.content || null,
            auth_type_list: data.authTypeList || null,
            show_info: Array.isArray(data.showInfo) ? data.showInfo.join('|') : (data.showInfo || null),
            tags: Array.isArray(data.tags) ? data.tags.join(',') : (data.tags || null),
            auth_model: data.authModel ?? 1,
            box_list: data.boxList || null,
            enable: data.enable ?? 1,
          });
          result = { success: true, response: '已保存到数据库' };
          console.log(`${bjt()} [MQTT] 密码/胁迫码 已保存: type=${credentialType}`);
        }
      } else if (op === 'passport-update') {
        await updateCredentialAttributes(data.id, {
          show_info: Array.isArray(data.showInfo) ? data.showInfo.join('|') : (data.showInfo || null),
          tags: Array.isArray(data.tags) ? data.tags.join(',') : (data.tags || null),
          auth_model: data.authModel ?? 1,
          auth_type_list: data.authTypeList || null,
          box_list: data.boxList || null,
          enable: data.enable ?? 1,
        });
        result = { success: true, response: '属性已更新' };
        console.log(`${bjt()} [MQTT] 密码/胁迫码 属性已更新`);
      } else if (op === 'passport-del') {
        const cred = await getCredentialById(data.id);
        if (cred) {
          await deleteCredential(data.id);
          result = { success: true, response: '已从数据库删除' };
        } else {
          result = { success: true, response: '凭证不存在' };
        }
        console.log(`${bjt()} [MQTT] 密码/胁迫码 已删除`);
      } else {
        result = { success: false, error: `未知操作: ${op}` };
      }
    } else if (op === 'passport-add') {
      result = await handlePassportAdd(device, payload);
    } else if (op === 'passport-update') {
      result = await handlePassportUpdate(device, payload);
    } else if (op === 'passport-del') {  // ⚠️ 不是 passport-delete
      // ⚠️ passport-del 没有 personId，用 credentialId 查数据库
      result = await handlePassportDelete(device, {
        credentialId: data.id,
        personId: data.personId,  // 可能为空
      });
    } else {
      result = { success: false, error: `未知操作: ${op}` };
    }
  } catch (error: any) {
    result = { success: false, error: error.message };
  }

  const durationMs = Date.now() - startTime;

  // ⚠️ 密码/胁迫码不进下发记录，只有虹膜/掌纹才进
  if (needSyncLog) {
    if (result.success) {
      await updateQueueStatus(queueId, 'success');
      await addSyncLog({
        queue_id: queueId,
        device_id: deviceId,
        device_type: device?.device_type,
        action: action,
        status: 'success',
        response: result.response,
        duration_ms: durationMs,
      });
      console.log(`${bjt()} [MQTT] ✅ 下发成功, 耗时${durationMs}ms`);
    } else {
      await updateQueueStatus(queueId, 'failed', result.error);
      await addSyncLog({
        queue_id: queueId,
        device_id: deviceId,
        device_type: device?.device_type,
        action: action,
        status: 'failed',
        error_message: result.error,
        duration_ms: durationMs,
      });
      console.log(`${bjt()} [MQTT] ❌ 下发失败: ${result.error}`);
    }
  }

  return result;
}

// 保存 MQTT 接收的数据到文件（方便排查问题）
// ⚠️ 只保留最近 5 条日志文件
function saveMqttMessage(action: string, message: any): void {
  const logDir = join(process.env.DATA_DIR || process.cwd(), 'mqtt_logs');
  const fileName = `${action}_${Date.now()}.json`;
  const filePath = join(logDir, fileName);

  console.log(`[${bjt()}] [MQTT] 📁 尝试保存消息到: ${filePath}`);

  try {
    // 确保目录存在
    if (!existsSync(logDir)) {
      console.log(`[${bjt()}] [MQTT] 创建目录: ${logDir}`);
      mkdirSync(logDir, { recursive: true });
    }

    writeFileSync(filePath, JSON.stringify(message, null, 2), 'utf-8');
    console.log(`[${bjt()}] [MQTT] ✅ 消息已保存: ${fileName}`);

    // ⚠️ 清理旧文件，只保留最近 5 条
    cleanupMqttLogs(logDir, 5);
  } catch (error: any) {
    console.error(`[${bjt()}] [MQTT] ❌ 保存消息失败: ${error.message}`);
    console.error(`[${bjt()}] [MQTT] 目录: ${logDir}, 文件: ${fileName}`);
  }
}

// 清理 mqtt_logs 目录，只保留最近 N 条文件
function cleanupMqttLogs(logDir: string, keepCount: number): void {
  try {
    const files = require('fs').readdirSync(logDir)
      .filter((f: string) => f.endsWith('.json'))
      .sort()
      .reverse(); // 按时间倒序，最新的在前

    if (files.length > keepCount) {
      const filesToDelete = files.slice(keepCount);
      for (const f of filesToDelete) {
        require('fs').unlinkSync(join(logDir, f));
        console.log(`[${bjt()}] [MQTT] 🗑️ 删除旧日志: ${f}`);
      }
      console.log(`[${bjt()}] [MQTT] 已清理 ${filesToDelete.length} 条旧日志，保留 ${keepCount} 条`);
    }
  } catch (error: any) {
    console.warn(`[${bjt()}] [MQTT] 清理日志失败: ${error.message}`);
  }
}

// 记录MQTT指令事件到文件
// ⚠️ 直接写入文件，不走HTTP API（服务端调用HTTP可能失败）
async function recordMqttEvent(deviceId: string, op: string, message: any, credentialType?: number): Promise<void> {
  try {
    const data = message.data || message;

    // 如果没有传入 credentialType，尝试从 message 或 data 中获取
    let credType = credentialType || data.type || message.credentialType || 0;

    // 如果是删除操作且没有类型，尝试从数据库查询
    if (!credType && (op === 'passport-del' || op === 'passport-update') && data.id) {
      const { getCredentialById } = await import('./db-credentials');
      const cred = await getCredentialById(data.id);
      if (cred) {
        credType = cred.type;
      }
    }

    // 构造事件记录（不记录长字符串如图片、特征）
    const event = {
      id: `evt-${Date.now()}`,
      time: new Date().toLocaleString('zh-CN'),
      deviceId: deviceId,
      op: op,
      personId: data.personId || message.personId || '',
      credentialId: data.id || message.credentialId || 0,
      credentialType: credType,  // 添加凭证类型
      authModel: data.authModel || message.authModel || 1,
      authTypeList: data.authTypeList || message.authTypeList || '',
      boxList: data.boxList || message.boxList || '',
      showInfo: Array.isArray(data.showInfo) ? data.showInfo.join('|') : (data.showInfo || ''),
      tags: Array.isArray(data.tags) ? data.tags.join(',') : (data.tags || ''),
      enable: data.enable || 1,
    };

    // 直接写入文件
    const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('fs');
    const { join } = require('path');

    const filePath = join(process.env.DATA_DIR || process.cwd(), 'mqttevent.json');
    const dataDir = join(process.env.DATA_DIR || process.cwd());

    // 确保目录存在
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    // 读取现有记录
    let events = [];
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        events = JSON.parse(content || '[]');
      } catch (e) {
        events = [];
      }
    }

    // 添加新记录到开头
    events.unshift(event);

    // 保留最近200条
    if (events.length > 200) {
      events = events.slice(0, 200);
    }

    // 写入文件
    writeFileSync(filePath, JSON.stringify(events, null, 2), 'utf-8');
    console.log(`[${bjt()}] [MQTT] ✅ 已记录事件: ${op}`);
  } catch (error: any) {
    // 记录失败不影响主流程
    console.warn(`[${bjt()}] [MQTT] 记录事件异常: ${error.message}`);
  }
}

// 获取MQTT配置（从系统设置读取）
function getMqttConfig() {
  const broker = getMqttBroker();
  const username = getMqttUsername();
  const password = getMqttPassword();

  console.log(`[MQTT] 配置的Broker地址: ${broker}`);
  console.log(`[MQTT] 配置的用户名: ${username}`);

  return {
    broker: broker,
    username: username,
    password: password,
    clientId: `noah-ark-server-${Date.now()}`,
    reconnectPeriod: 10000, // 10 秒重连一次
    connectTimeout: 30000,
    protocolVersion: 4 as const, // MQTT 3.1.1
    protocol: 'mqtt' as const, // 明确指定协议
  };
}

// 订阅主题前缀
const TOPIC_PREFIX = 'sys/face';

// 凭证下发消息格式 (IAMS 协议)
interface PassportAddMessage {
  messageId: string,           // 消息唯一 ID
  deviceId: string,            // 目标设备 ID
  personId: string,            // 人员 ID
  personName: string,          // 人员姓名
  credentialId: number,        // 凭证 ID
  credentialType: number,      // 凭证类型：1=人脸，5=密码，7=虹膜，8=掌纹
  content?: string,            // 凭证内容 (Base64)
                               // 虹膜(type=7): 用 |==BMP-SEP==| 分隔左右眼，没有分隔符则只有左眼
                               // 掌纹(type=8): 掌纹特征数据
                               // 密码(type=5): 密码明文
                               // 胁迫码(type=9): 胁迫码明文
  irisLeftImage?: string,      // 左眼虹膜图像 (旧格式，兼容)
  irisRightImage?: string,     // 右眼虹膜图像 (旧格式，兼容)
  palmFeature?: string,        // 掌纹特征 (旧格式，兼容)
  authTypeList?: number[],     // 授权类型列表
  action: 'add' | 'update' | 'delete',  // 操作类型
  timestamp: number,           // 时间戳
}

/**
 * 从 content 字段解析虹膜图片
 * 新格式：content 字段用 |==BMP-SEP==| 分隔左右眼，没有分隔符则只有左眼
 */
function parseIrisContent(content: string): { leftIris: string; rightIris: string } {
  const SEPARATOR = '|==BMP-SEP==|';

  if (content.includes(SEPARATOR)) {
    const parts = content.split(SEPARATOR);
    return {
      leftIris: parts[0] || '',
      rightIris: parts[1] || '',
    };
  } else {
    // 没有分隔符，只有左眼
    return {
      leftIris: content,
      rightIris: '',
    };
  }
}

// ⚠️ 关键：使用全局变量保存 MQTT 客户端，避免 Next.js HMR 重置
declare global {
  var mqttClientGlobal: {
    client: MqttClient | null;
    isConnected: boolean;
    initError: Error | null;
  } | undefined;
}

// 初始化全局变量
if (!global.mqttClientGlobal) {
  global.mqttClientGlobal = {
    client: null,
    isConnected: false,
    initError: null,
  };
  console.log(`[${bjt()}] [MQTT] 初始化全局变量`);
}

// 状态上报定时器
let statusReportTimer: NodeJS.Timeout | null = null;

/**
 * 状态上报函数
 * 每10秒向IAMS平台上报设备状态
 */
async function reportStatus(): Promise<void> {
  const client = global.mqttClientGlobal?.client;
  if (!client || !global.mqttClientGlobal?.isConnected) {
    return;
  }

  const deviceId = getDeviceId();
  const now = Date.now();
  const requestId = `${now}`;

  // 获取本机IP（简化处理）
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let ip = '127.0.0.1';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ip = iface.address;
        break;
      }
    }
  }

  // 从数据库读取配置项
  let attrs;
  try {
    attrs = await getDeviceAttrs();
  } catch (e) {
    // 如果读取失败，使用默认值
    attrs = {
      passportVer: '',
      model: 1,
      doorModel: 1,
      passRulerList: [],
      warnRulerList: [],
    };
  }

  // 提取规则列表的ID（只上报ID，不是完整对象）
  const passRulerIds = extractRuleIds(attrs.passRulerList);
  const warnRulerIds = extractRuleIds(attrs.warnRulerList);

  const message = {
    time: now,
    requestId: requestId,
    deviceId: deviceId,
    op: 'report-status',
    data: {
      deviceId: deviceId,
      deviceTime: now,
      ip: ip,
      passportVer: attrs.passportVer || `${deviceId}${now}`,  // 如果为空则生成临时版本
      model: attrs.model,
      doorModel: attrs.doorModel,
      passRulerList: passRulerIds,
      warnRulerList: warnRulerIds,
    },
  };

  const topic = `${TOPIC_PREFIX}/${deviceId}/up/report-status`;

  client.publish(topic, JSON.stringify(message), { qos: 0 }, (err) => {
    if (err) {
      console.error(`[${bjt()}] [MQTT] ❌ 状态上报失败:`, err.message);
    }
  });
}

/**
 * 从规则列表中提取ID
 * 规则可能是对象 {id: xxx} 或直接是数字
 */
function extractRuleIds(rules: any[]): number[] {
  if (!Array.isArray(rules)) return [];

  return rules.map(rule => {
    if (typeof rule === 'number') return rule;
    if (typeof rule === 'object' && rule.id) return rule.id;
    return 0;
  }).filter(id => id > 0);
}

/**
 * 启动状态上报定时器
 */
function startStatusReport(): void {
  if (statusReportTimer) {
    clearInterval(statusReportTimer);
  }

  // 立即发送一次
  reportStatus();

  // 每10秒发送一次
  statusReportTimer = setInterval(() => {
    reportStatus();
  }, 10000);

  console.log(`[${bjt()}] [MQTT] 状态上报定时器已启动（每10秒）`);
}

/**
 * 停止状态上报定时器
 */
function stopStatusReport(): void {
  if (statusReportTimer) {
    clearInterval(statusReportTimer);
    statusReportTimer = null;
    console.log(`[${bjt()}] [MQTT] 状态上报定时器已停止`);
  }
}

/**
 * 初始化 MQTT 客户端
 * ⚠️ 连接失败不会抛出异常，只记录日志
 * ⚠️ 不等待连接完成，直接返回（异步连接）
 */
export async function initMqttClient(): Promise<MqttClient | null> {
  // 如果客户端已存在，直接返回
  if (global.mqttClientGlobal!.client) {
    console.log(`[${bjt()}] [MQTT] 客户端已存在，返回现有实例，isConnected =`, global.mqttClientGlobal!.isConnected);
    return global.mqttClientGlobal!.client;
  }

  try {
    // 初始化同步表
    await initSyncTables();

    // ⚠️ 确保设备配置已初始化
    await getDeviceConfigs();

    // 获取MQTT配置
    const config = getMqttConfig();

    console.log(`[${bjt()}] [MQTT] 正在连接 broker: ${config.broker}`);

    const client = mqtt.connect(config.broker, {
      username: config.username,
      password: config.password,
      clientId: config.clientId,
      reconnectPeriod: config.reconnectPeriod,
      connectTimeout: config.connectTimeout,
      clean: true,
      protocolVersion: config.protocolVersion,
      protocol: config.protocol,
    });

    // 保存到全局变量
    global.mqttClientGlobal!.client = client;

    // ⚠️ 关键：不等待连接完成，直接注册事件处理器后返回

    // ✅ 修复：使用 on 而不是 once，确保每次重连成功都能触发
    client.on('connect', (connack) => {
      console.log(`[${bjt()}] [MQTT] ✅ 连接成功`);
      console.log(`[${bjt()}] [MQTT] CONNACK:`, connack);
      global.mqttClientGlobal!.isConnected = true;
      global.mqttClientGlobal!.initError = null;

      // 启动状态上报定时器
      startStatusReport();
    });

    // 注册持续的事件处理器（只注册一次）
    client.on('message', async (topic: string, payload: Buffer) => {
      console.log(`[${bjt()}] [MQTT] 📥 收到消息: ${topic}`);
      try {
        await handleMessage(topic, payload);
      } catch (error) {
        console.error(`[${bjt()}] [MQTT] ❌ 处理消息失败:`, error);
      }
    });

    client.on('error', (error: Error) => {
      console.error(`[${bjt()}] [MQTT] ❌ 连接错误: ${error.message}`);
      global.mqttClientGlobal!.initError = error;
    });

    client.on('close', () => {
      console.log(`[${bjt()}] [MQTT] 🔌 连接已断开`);
      global.mqttClientGlobal!.isConnected = false;

      // 停止状态上报定时器
      stopStatusReport();
    });

    // ⚠️ 重连事件 - 无限重连，不限制次数
    client.on('reconnect', () => {
      console.log(`[${bjt()}] [MQTT] 🔄 正在重新连接... (间隔 ${config.reconnectPeriod / 1000}秒)`);
    });

    client.on('offline', () => {
      console.log(`[${bjt()}] [MQTT] 📴 客户端离线`);
    });

    // 订阅所有设备的下行主题
    subscribeToTopics(client);

    console.log('[MQTT] 初始化完成（异步连接），返回客户端');
    return global.mqttClientGlobal!.client;
  } catch (error) {
    console.error('[MQTT] ❌ 初始化失败:', error);
    global.mqttClientGlobal!.initError = error as Error;
    global.mqttClientGlobal!.isConnected = false;
    return null;
  }
}

/**
 * 订阅主题
 */
function subscribeToTopics(client: MqttClient): void {
  if (!client) {
    console.warn('[MQTT] ⚠️ 客户端未初始化，无法订阅');
    return;
  }

  // 获取配置的设备ID
  const { getDeviceId } = require('./settings');
  const deviceId = getDeviceId();

  // 订阅凭证下发主题（通配符匹配所有设备）
  const topics = [
    `${TOPIC_PREFIX}/+/down/passport-add`,      // 凭证新增
    `${TOPIC_PREFIX}/+/down/passport-update`,    // 凭证更新
    `${TOPIC_PREFIX}/+/down/passport-del`,       // ⚠️ 凭证删除（不是 passport-delete）
    `${TOPIC_PREFIX}/+/down/device-config`,      // 设备配置
    `${TOPIC_PREFIX}/+/down/attr-set`,           // ⚠️ IAMS配置项下发
    `${TOPIC_PREFIX}/+/down/reset-passport`,     // ⚠️ IAMS重置凭证库
    `${TOPIC_PREFIX}/${deviceId}/up/pass-log`,   // 🧪 模拟IAMS接收通行记录（使用配置的设备ID）
  ];

  console.log(`[MQTT] 订阅通行记录主题，设备ID: ${deviceId}`);

  client.subscribe(topics, { qos: 1 }, (err) => {
    if (err) {
      console.error('[MQTT] ❌ 订阅主题失败:', err);
    } else {
      console.log('[MQTT] ✅ 订阅主题成功:', topics);
    }
  });
}

/**
 * 处理接收到的消息
 * 加入队列，串行处理
 */
async function handleMessage(topic: string, payload: Buffer): Promise<void> {
  const receiveTime = Date.now();
  const receiveDate = new Date().toISOString();

  const topicParts = topic.split('/');

  if (topicParts.length < 5) {
    console.warn(`[MQTT] 无效主题: ${topic}`);
    return;
  }

  const deviceId = topicParts[2];
  const direction = topicParts[3]; // up 或 down
  const action = topicParts[4];

  // 解析消息
  let message: any;
  try {
    message = JSON.parse(payload.toString('utf-8'));
  } catch (error) {
    console.error(`[MQTT] JSON解析失败`);
    return;
  }

  // 🧪 模拟IAMS响应：收到上行 pass-log 消息，自动回复成功响应
  if (direction === 'up' && action === 'pass-log') {
    console.log(`${bjt()} [MQTT] 通行记录上报: authType=${message.data?.authType}`);

    // 发送成功响应到下行主题
    const responseTopic = `${TOPIC_PREFIX}/${deviceId}/down/pass-log`;
    const responsePayload = {
      requestId: message.requestId,
      data: {
        code: 200,
        msg: 'success',
      },
    };

    if (global.mqttClientGlobal?.client) {
      global.mqttClientGlobal.client.publish(responseTopic, JSON.stringify(responsePayload), { qos: 1 }, (err) => {
        if (err) {
          console.error(`${bjt()} [MQTT] 通行记录响应失败:`, err);
        }
      });
    }
    return; // 不走队列处理
  }

  // ⚠️ IAMS配置项下发：收到 attr-set 消息，存入数据库并发送响应
  if (action === 'attr-set') {
    console.log(`${bjt()} [MQTT] 收到配置下发 (attr-set)`);

    try {
      // 存入数据库（使用顶部导入的 updateDeviceAttrs）
      await updateDeviceAttrs({
        passportVer: message.data?.passportVer,
        model: message.data?.model,
        doorModel: message.data?.doorModel,
        passRulerList: message.data?.passRulerList,
        warnRulerList: message.data?.warnRulerList,
      });

      console.log(`${bjt()} [MQTT] 配置已保存`);

      // ⚠️ 必须响应，否则IAMS认为设备异常
      const responsePayload = {
        time: Date.now(),
        requestId: message.requestId,
        deviceId: deviceId,
        op: 'attr-set',
        data: {
          code: 200,
          msg: 'success',
        }
      };

      await publishUpstream(deviceId, 'attr-set', responsePayload);
      console.log(`${bjt()} [MQTT] 配置响应已发送`);
    } catch (e: any) {
      console.error(`${bjt()} [MQTT] 配置处理失败: ${e.message}`);

      // 失败也要响应
      const responsePayload = {
        time: Date.now(),
        requestId: message.requestId,
        deviceId: deviceId,
        op: 'attr-set',
        data: {
          code: 500,
          msg: e.message,
        }
      };

      await publishUpstream(deviceId, 'attr-set', responsePayload);
    }

    return; // 不走队列处理
  }

  // ⚠️ IAMS重置凭证库：收到 reset-passport 消息，清空凭证并发送响应
  if (action === 'reset-passport') {
    console.log(`${bjt()} [MQTT] 收到重置凭证库指令`);

    try {
      // 1. 清空所有凭证（数据库）
      const count = await clearAllCredentials();
      console.log(`${bjt()} [MQTT] 已清空数据库 ${count} 条凭证`);

      // 2. 清空版本号
      await clearPassportVer();
      console.log(`${bjt()} [MQTT] 版本号已清空`);

      // 3. 清空物理设备（各自独立try-catch，互不影响）
      const devices = await getDeviceConfigs();

      // 清空虹膜设备
      const irisDevice = devices.find(d => d.device_type === 'iris');
      if (irisDevice) {
        console.log(`${bjt()} [虹膜] 开始清空设备...`);

        try {
          const irisQueueId = await addToSyncQueue({
            message_id: `reset-iris-${Date.now()}`,
            device_id: irisDevice.device_id,
            action: 'reset-passport',
            payload: { device_type: 'iris', endpoint: irisDevice.endpoint },
          });

          const irisResult = await clearIrisDevice(irisDevice.endpoint);
          console.log(`${bjt()} [虹膜] 清空完成: 删除${irisResult.deleted}个, 失败${irisResult.failed}个`);

          await updateQueueStatus(irisQueueId, irisResult.success ? 'success' : 'failed');
          await addSyncLog({
            queue_id: irisQueueId,
            device_id: irisDevice.device_id,
            device_type: 'iris',
            action: 'reset-passport',
            status: irisResult.success ? 'success' : 'failed',
            response: irisResult.success ? `已清空${irisResult.deleted}个用户` : JSON.stringify(irisResult.errors),
            duration_ms: 0,
          });
        } catch (e: any) {
          console.error(`${bjt()} [虹膜] 清空异常: ${e.message}`);
        }
      } else {
        console.log(`${bjt()} [MQTT] 未找到虹膜设备`);
      }

      // 清空掌纹设备
      const palmDevice = devices.find(d => d.device_type === 'palm');
      if (palmDevice) {
        console.log(`${bjt()} [掌纹] 开始清空设备...`);

        try {
          const palmQueueId = await addToSyncQueue({
            message_id: `reset-palm-${Date.now()}`,
            device_id: palmDevice.device_id,
            action: 'reset-passport',
            payload: { device_type: 'palm', endpoint: palmDevice.endpoint },
          });

          const palmResult = await clearPalmDevice(palmDevice.endpoint);
          console.log(`${bjt()} [掌纹] 清空完成: ${palmResult.success ? '成功' : '失败'}`);

          await updateQueueStatus(palmQueueId, palmResult.success ? 'success' : 'failed');
          await addSyncLog({
            queue_id: palmQueueId,
            device_id: palmDevice.device_id,
            device_type: 'palm',
            action: 'reset-passport',
            status: palmResult.success ? 'success' : 'failed',
            response: palmResult.success ? '已清空' : JSON.stringify(palmResult.errors),
            duration_ms: 0,
          });
        } catch (e: any) {
          console.error(`${bjt()} [掌纹] 清空异常: ${e.message}`);
        }
      } else {
        console.log(`${bjt()} [MQTT] 未找到掌纹设备`);
      }

      // 4. 发送成功响应
      const responsePayload = {
        time: Date.now(),
        requestId: message.requestId,
        deviceId: deviceId,
        op: 'reset-passport',
        data: {
          code: 200,
          msg: '',
          result: {
            passportVer: ''
          }
        }
      };

      await publishUpstream(deviceId, 'reset-passport', responsePayload);
      console.log(`${bjt()} [MQTT] 重置响应已发送`);
    } catch (e: any) {
      console.error(`${bjt()} [MQTT] ❌ 重置失败: ${e.message}`);

      // 失败也要响应
      const responsePayload = {
        time: Date.now(),
        requestId: message.requestId,
        deviceId: deviceId,
        op: 'reset-passport',
        data: {
          code: 500,
          msg: e.message,
          result: {
            passportVer: ''
          }
        }
      };

      await publishUpstream(deviceId, 'reset-passport', responsePayload);
      console.log(`${bjt()} [MQTT] 重置失败响应已发送`);
    }

    return; // 不走队列处理
  }

  // 计算传输延迟（客户端发送时间 vs 服务端接收时间）
  const sendTime = message.timestamp || 0;
  const latency = sendTime > 0 ? (receiveTime - sendTime) : 0;

  console.log(`${bjt()} [MQTT] 收到消息: ${topic} | 操作: ${action} | personId: ${message.data?.personId || '(无)'} | 延迟: ${latency}ms`);

  // 保存消息到文件（调试用）
  saveMqttMessage(action, {
    receiveTime: receiveDate,
    latencyMs: latency,
    topic,
    deviceId,
    message,
    payloadSize: payload.length,
  });

  // 记录MQTT指令到事件文件（不记录长字符串）
  recordMqttEvent(deviceId, action, message);

  // 加入队列
  messageQueue.push({ deviceId, action, message });
  console.log(`[队列] 当前长度: ${messageQueue.length}`);

  // 触发处理
  processQueue();
}

/**
 * 发送消息到上行主题（向 IAMS 汇报）
 */
export async function publishUpstream(
  deviceId: string,
  topic: string,
  payload: object
): Promise<void> {
  if (!global.mqttClientGlobal?.client || !global.mqttClientGlobal.isConnected) {
    console.warn('[MQTT] ⚠️ 客户端未连接，跳过上行消息');
    return;
  }

  const fullTopic = `${TOPIC_PREFIX}/${deviceId}/up/${topic}`;
  const messageStr = JSON.stringify(payload);

  // ⚠️ 保存响应日志到 mqtt-log-reply 文件夹
  saveReplyLog(fullTopic, payload);

  return new Promise((resolve, reject) => {
    global.mqttClientGlobal!.client!.publish(fullTopic, messageStr, { qos: 1 }, (err) => {
      if (err) {
        console.error('[MQTT] ❌ 上行消息发送失败:', err);
        reject(err);
      } else {
        console.log('[MQTT] ✅ 发送上行消息:', fullTopic);
        resolve();
      }
    });
  });
}

/**
 * 保存响应日志到 mqtt-log-reply 文件夹
 */
function saveReplyLog(topic: string, payload: object): void {
  const logDir = join(process.env.DATA_DIR || process.cwd(), 'mqtt-log-reply');
  const fileName = `reply_${Date.now()}.json`;
  const filePath = join(logDir, fileName);

  try {
    // 确保目录存在
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    const logData = {
      sendTime: new Date().toISOString(),
      topic: topic,
      payload: payload
    };

    writeFileSync(filePath, JSON.stringify(logData, null, 2), 'utf-8');
    console.log(`[MQTT] 📤 响应日志已保存: ${fileName}`);

    // 清理旧文件，只保留最近 5 条
    cleanupReplyLogs(logDir, 5);
  } catch (error: any) {
    console.error(`[MQTT] ❌ 保存响应日志失败: ${error.message}`);
  }
}

/**
 * 清理响应日志，只保留最近 N 条
 */
function cleanupReplyLogs(logDir: string, keepCount: number): void {
  try {
    const files = require('fs').readdirSync(logDir)
      .filter((f: string) => f.startsWith('reply_') && f.endsWith('.json'))
      .sort()
      .reverse(); // 按时间倒序，最新的在前

    if (files.length > keepCount) {
      const filesToDelete = files.slice(keepCount);
      for (const f of filesToDelete) {
        require('fs').unlinkSync(join(logDir, f));
        console.log(`[MQTT] 🗑️ 删除旧响应日志: ${f}`);
      }
    }
  } catch (error: any) {
    console.warn(`[MQTT] 清理响应日志失败: ${error.message}`);
  }
}

/**
 * 发送胁迫告警到 IAMS
 * 主题: sys/face/{deviceId}/up/warn-event
 */
export async function sendWarnEvent(payload: {
  credentialId: number;
  warnContent?: string;
}): Promise<boolean> {
  const client = global.mqttClientGlobal?.client;
  if (!client || !global.mqttClientGlobal?.isConnected) {
    console.warn('[MQTT] ⚠️ 客户端未连接，无法发送告警');
    return false;
  }

  const deviceId = getDeviceId();
  const now = Date.now();
  const requestId = `${now}`;

  const message = {
    time: now,
    requestId: requestId,
    deviceId: deviceId,
    op: 'warn-event',
    data: {
      warnType: 1,
      passportId: payload.credentialId,
      createTime: now,
      warnLevel: 1,
      warnEventId: 1,
      warnContent: payload.warnContent || '胁迫码报警'
    }
  };

  const topic = `${TOPIC_PREFIX}/${deviceId}/up/warn-event`;

  return new Promise((resolve) => {
    client.publish(topic, JSON.stringify(message), { qos: 1 }, (err) => {
      if (err) {
        console.error('[MQTT] ❌ 发送胁迫告警失败:', err);
        resolve(false);
      } else {
        console.log(`[MQTT] ✅ 胁迫告警已发送: ${topic}, credentialId=${payload.credentialId}`);
        resolve(true);
      }
    });
  });
}

/**
 * 获取连接状态
 */
export function isMqttConnected(): boolean {
  const result = global.mqttClientGlobal?.isConnected ?? false;
  console.log('[MQTT] isMqttConnected 返回:', result, '(client:', global.mqttClientGlobal?.client ? '存在' : 'null', ')');
  return result;
}

/**
 * 获取初始化错误（如果有）
 */
export function getInitError(): Error | null {
  return global.mqttClientGlobal?.initError ?? null;
}

/**
 * 获取 MQTT 客户端实例
 * @returns MQTT 客户端，如果未初始化返回 null
 */
export function getMqttClient(): MqttClient | null {
  return global.mqttClientGlobal?.client ?? null;
}

/**
 * 重新订阅主题（当 deviceId 修改时调用）
 */
export function refreshMqttSubscription(): void {
  const client = global.mqttClientGlobal?.client;
  if (!client || !global.mqttClientGlobal?.isConnected) {
    console.log('[MQTT] 客户端未连接，跳过重新订阅');
    return;
  }
  console.log('[MQTT] 正在重新订阅主题...');
  subscribeToTopics(client);

  // 停止旧的定时器，用新的 deviceId 立即发送一次
  stopStatusReport();
  startStatusReport();
}

/**
 * 关闭 MQTT 客户端
 */
export async function closeMqttClient(): Promise<void> {
  if (global.mqttClientGlobal?.client) {
    await new Promise<void>((resolve) => {
      global.mqttClientGlobal!.client!.end(false, () => {
        console.log('[MQTT] ℹ️ 客户端已关闭');
        resolve();
      });
    });
    global.mqttClientGlobal!.client = null;
    global.mqttClientGlobal!.isConnected = false;
    global.mqttClientGlobal!.initError = null;
  }
}

/**
 * 模拟发送凭证下发消息（用于测试）
 */
export async function simulatePassportAdd(message: PassportAddMessage): Promise<void> {
  if (!global.mqttClientGlobal?.client || !global.mqttClientGlobal.isConnected) {
    console.warn('[MQTT] ⚠️ 客户端未连接，无法模拟发送');
    return;
  }

  const topic = `${TOPIC_PREFIX}/${message.deviceId}/down/passport-add`;
  
  return new Promise((resolve, reject) => {
    global.mqttClientGlobal!.client!.publish(topic, JSON.stringify(message), { qos: 1 }, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log('[MQTT] ✅ 模拟发送凭证:', topic);
        resolve();
      }
    });
  });
}

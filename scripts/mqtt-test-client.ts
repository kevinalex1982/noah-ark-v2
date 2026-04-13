/**
 * MQTT 测试客户端
 * 用于模拟 IAMS 下发凭证消息
 * ⚠️ 完全按照 IAMS 协议格式
 *
 * 使用方法：
 *   npx ts-node scripts/mqtt-test-client.ts
 */

import mqtt, { MqttClient } from 'mqtt';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { createClient } from '@libsql/client';

// ============ 配置 ============
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const IRIS_DEVICE_ID = 'iris-device-001';  // ⚠️ 数据库配置的设备ID
const PALM_DEVICE_ID = 'palm-device-001';  // ⚠️ 数据库配置的设备ID
const TOPIC_PREFIX = 'sys/face';

// ⚠️ 用户编码（personId）：存储身份证信息，为了安全叫"用户编码"
// 虹膜固定用 18个1，掌纹固定用 18个2
const IRIS_PERSON_ID = '111111111111111111';  // 虹膜用户编码（18位身份证格式）
const PALM_PERSON_ID = '222222222222222222';  // 掌纹用户编码（18位身份证格式）

// ============ 时间戳函数 ============
function timestamp(): string {
  return new Date().toISOString();
}

// ============ 数据加载 ============

interface IrisUserData {
  irisLeftImage: string;
  irisRightImage: string;
  staffNum: string;
  staffNumDec: string;
  name: string;
}

interface PalmUserData {
  userId: string;
  featureData: string;
}

/**
 * 加载虹膜测试数据
 */
function loadIrisData(): IrisUserData | null {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const files = fs.readdirSync(dataDir);
    const irisFile = files.find(f => f.startsWith('iris_user_') && f.endsWith('.json'));

    if (irisFile) {
      const content = fs.readFileSync(path.join(dataDir, irisFile), 'utf-8');
      const json = JSON.parse(content);
      const userData = Array.isArray(json) ? json[0] : json;

      if (userData.irisLeftImage) {
        console.log(`[${timestamp()}] [DataLoader] 从 ${irisFile} 加载虹膜数据成功`);
        console.log(`[${timestamp()}] [DataLoader] 用户: ${userData.name}, staffNum: ${userData.staffNum}`);
        console.log(`[${timestamp()}] [DataLoader] 左眼长度: ${userData.irisLeftImage?.length || 0}`);
        console.log(`[${timestamp()}] [DataLoader] 右眼长度: ${userData.irisRightImage?.length || 0}`);

        return {
          irisLeftImage: userData.irisLeftImage,
          irisRightImage: userData.irisRightImage || userData.irisLeftImage,
          staffNum: userData.staffNum || 'test-iris-001',
          staffNumDec: userData.staffNumDec || '123',
          name: userData.name || '测试用户',
        };
      }
    }
  } catch (error: any) {
    console.error(`[${timestamp()}] [DataLoader] 加载虹膜数据失败: ${error.message}`);
  }
  return null;
}

/**
 * 加载掌纹测试数据
 * ⚠️ userId 必须固定，掌纹特征数据是从设备抓取的
 */
function loadPalmData(): PalmUserData | null {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const files = fs.readdirSync(dataDir);
    const palmFile = files.find(f => f.startsWith('palm_user_kevin') && f.endsWith('.json'))
      || files.find(f => f.startsWith('palm_user_') && f.endsWith('.json'));

    if (palmFile) {
      const content = fs.readFileSync(path.join(dataDir, palmFile), 'utf-8');
      const json = JSON.parse(content);

      if (json.featureData) {
        // ⚠️ userId 必须从特征数据中提取（设备要求）
        const userId = json.userId || extractUserIdFromFeature(json.featureData) || 'kevin';
        console.log(`[${timestamp()}] [DataLoader] 从 ${palmFile} 加载掌纹数据成功`);
        console.log(`[${timestamp()}] [DataLoader] userId: ${userId}, featureData长度: ${json.featureData?.length || 0}`);

        return {
          userId,
          featureData: json.featureData,
        };
      }
    }
  } catch (error: any) {
    console.error(`[${timestamp()}] [DataLoader] 加载掌纹数据失败: ${error.message}`);
  }
  return null;
}

/**
 * 从 featureData 提取 userId
 */
function extractUserIdFromFeature(featureData: string): string | null {
  if (!featureData) return null;
  const firstCaret = featureData.indexOf('^');
  if (firstCaret < 0) return null;
  const beforeCaret = featureData.substring(0, firstCaret);
  const match = beforeCaret.match(/([a-z][a-z0-9_-]{2,20})$/);
  return match ? match[1] : null;
}

// ============ IAMS 消息构造 ============

/**
 * 生成唯一 requestId
 * ⚠️ 不能直接使用时间戳作为 requestId
 */
function generateRequestId(prefix: string): string {
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${Date.now()}-${random}`;
}

/**
 * IAMS 标准消息格式
 * ⚠️ 删除操作(passport-del)只需要部分字段
 */
interface IamsMessage {
  time: number;
  requestId: string;
  deviceId: string;
  op: string;
  data: {
    opId: string;
    passportVer: string;
    personId?: string;       // 删除操作不需要
    personName?: string;
    personType: string;
    id: number;
    type?: number;           // 删除操作不需要
    content?: string;
    showInfo?: string[];
    tags?: number[];
    startTime?: number | null;
    endTime?: number | null;
    enable?: number;         // 删除操作不需要
    authModel?: number;      // 删除操作不需要
    authTypeList?: string;   // 删除操作不需要
    boxList?: string;
  };
}

/**
 * 构造虹膜添加消息 (type=7, op=passport-add)
 * ⚠️ IAMS 格式：content 存放虹膜数据（左眼|==BMP-SEP==|右眼）
 */
function buildIrisAddMessage(irisData: IrisUserData): IamsMessage {
  const now = Date.now();
  const requestId = generateRequestId('iris-add');
  const passportVer = `${IRIS_DEVICE_ID}-${now}`;

  // ⚠️ content 字段：左眼|==BMP-SEP==|右眼
  const content = `${irisData.irisLeftImage}|==BMP-SEP==|${irisData.irisRightImage}`;

  return {
    time: now,
    requestId,
    deviceId: IRIS_DEVICE_ID,
    op: 'passport-add',
    data: {
      opId: '1',
      passportVer,
      personId: IRIS_PERSON_ID,  // ⚠️ 固定用户编码（18个1）
      personName: irisData.name,
      personType: 'n',
      id: 999999,  // ⚠️ 固定凭证ID
      type: 7,
      content,
      showInfo: ['欢迎', irisData.name],
      tags: [],
      startTime: null,
      endTime: null,
      enable: 1,
      authModel: 2,
      authTypeList: '5,7,9',
      boxList: 'rc10|rc20',
    },
  };
}

/**
 * 构造虹膜更新消息 (type=7, op=passport-update)
 * ⚠️ 更新不包含 content 字段！只更新属性信息
 */
function buildIrisUpdateMessage(irisData: IrisUserData, newName?: string): IamsMessage {
  const now = Date.now();
  const requestId = generateRequestId('iris-update');
  const passportVer = `${IRIS_DEVICE_ID}-${now}`;

  return {
    time: now,
    requestId,
    deviceId: IRIS_DEVICE_ID,
    op: 'passport-update',
    data: {
      opId: '1',
      passportVer,
      personId: IRIS_PERSON_ID,  // ⚠️ 固定用户编码（18个1）
      personName: newName || `${irisData.name}-已更新`,
      personType: 'n',
      id: 999999,  // ⚠️ 必须和添加时的凭证ID一致
      type: 7,
      // ⚠️ 不包含 content 字段！
      showInfo: ['欢迎', newName || `${irisData.name}-已更新`],
      tags: [],
      startTime: null,
      endTime: null,
      enable: 1,
      authModel: 2,
      authTypeList: '5,7,9',
      boxList: 'rc10|rc20',
    },
  };
}

/**
 * 构造虹膜删除消息 (type=7, op=passport-del)
 * ⚠️ 删除只需要 passportVer, opId, id, personType
 */
function buildIrisDeleteMessage(): IamsMessage {
  const now = Date.now();
  const requestId = generateRequestId('iris-del');
  const passportVer = `${IRIS_DEVICE_ID}-${now}`;

  return {
    time: now,
    requestId,
    deviceId: IRIS_DEVICE_ID,
    op: 'passport-del',  // ⚠️ 不是 passport-delete
    data: {
      opId: '1',
      passportVer,
      id: 999999,  // ⚠️ 固定凭证ID
      personType: 'n',
      // ⚠️ 删除只需要这4个字段
    },
  };
}

/**
 * 构造虹膜删除消息（指定credentialId）
 */
function buildIrisDeleteMessageCustom(credentialId: number): IamsMessage {
  const now = Date.now();
  const requestId = generateRequestId('iris-del');
  const passportVer = `${IRIS_DEVICE_ID}-${now}`;

  return {
    time: now,
    requestId,
    deviceId: IRIS_DEVICE_ID,
    op: 'passport-del',
    data: {
      opId: '1',
      passportVer,
      id: credentialId,
      personType: 'n',
    },
  };
}

/**
 * 构造掌纹添加消息 (type=8, op=passport-add)
 * ⚠️ content 存放掌纹特征数据
 */
function buildPalmAddMessage(palmData: PalmUserData): IamsMessage {
  const now = Date.now();
  const requestId = generateRequestId('palm-add');
  const passportVer = `${PALM_DEVICE_ID}-${now}`;

  return {
    time: now,
    requestId,
    deviceId: PALM_DEVICE_ID,
    op: 'passport-add',
    data: {
      opId: '1',
      passportVer,
      personId: PALM_PERSON_ID,  // ⚠️ 固定用户编码（18个2）
      personName: palmData.userId,
      personType: 'n',
      id: 888888,  // ⚠️ 固定凭证ID
      type: 8,
      content: palmData.featureData,  // ⚠️ 掌纹特征放在 content
      showInfo: ['欢迎', palmData.userId],
      tags: [],
      startTime: null,
      endTime: null,
      enable: 1,
      authModel: 2,
      authTypeList: '5,8,9',
      boxList: 'rc10|rc20',
    },
  };
}

/**
 * 构造掌纹更新消息 (type=8, op=passport-update)
 * ⚠️ 更新不包含 content 字段！只更新属性信息
 */
function buildPalmUpdateMessage(palmData: PalmUserData, newName?: string): IamsMessage {
  const now = Date.now();
  const requestId = generateRequestId('palm-update');
  const passportVer = `${PALM_DEVICE_ID}-${now}`;

  return {
    time: now,
    requestId,
    deviceId: PALM_DEVICE_ID,
    op: 'passport-update',
    data: {
      opId: '1',
      passportVer,
      personId: PALM_PERSON_ID,  // ⚠️ 固定用户编码（18个2）
      personName: newName || `${palmData.userId}-已更新`,
      personType: 'n',
      id: 888888,  // ⚠️ 必须和添加时的凭证ID一致
      type: 8,
      // ⚠️ 不包含 content 字段！
      showInfo: ['欢迎', newName || `${palmData.userId}-已更新`],
      tags: [],
      startTime: null,
      endTime: null,
      enable: 1,
      authModel: 2,
      authTypeList: '5,8,9',
      boxList: 'rc10|rc20',
    },
  };
}

/**
 * 构造掌纹删除消息 (type=8, op=passport-del)
 * ⚠️ 删除只需要 passportVer, opId, id, personType
 */
function buildPalmDeleteMessage(): IamsMessage {
  const now = Date.now();
  const requestId = generateRequestId('palm-del');
  const passportVer = `${PALM_DEVICE_ID}-${now}`;

  return {
    time: now,
    requestId,
    deviceId: PALM_DEVICE_ID,
    op: 'passport-del',  // ⚠️ 不是 passport-delete
    data: {
      opId: '1',
      passportVer,
      id: 888888,  // ⚠️ 固定凭证ID
      personType: 'n',
      // ⚠️ 删除只需要这4个字段
    },
  };
}

/**
 * 构造掌纹删除消息（指定credentialId）
 */
function buildPalmDeleteMessageCustom(credentialId: number): IamsMessage {
  const now = Date.now();
  const requestId = generateRequestId('palm-del');
  const passportVer = `${PALM_DEVICE_ID}-${now}`;

  return {
    time: now,
    requestId,
    deviceId: PALM_DEVICE_ID,
    op: 'passport-del',
    data: {
      opId: '1',
      passportVer,
      id: credentialId,
      personType: 'n',
    },
  };
}

// ============ 批量操作消息构造（功能7、8、9） ============

/**
 * 构造密码添加消息 (type=5, op=passport-add)
 * ⚠️ 密码只保存数据库，不下发到设备
 */
function buildPasswordAddMessage(personId: string, password: string, credentialId: number, personName: string, authTypeList: string): IamsMessage {
  const now = Date.now();
  const requestId = generateRequestId('pwd-add');
  const passportVer = `iris-device-001-${now}`;

  return {
    time: now,
    requestId,
    deviceId: IRIS_DEVICE_ID,  // 密码消息发到虹膜设备
    op: 'passport-add',
    data: {
      opId: '1',
      passportVer,
      personId,
      personName,
      personType: 'n',
      id: credentialId,
      type: 5,
      content: password,
      showInfo: ['欢迎', personName],
      tags: [],
      startTime: null,
      endTime: null,
      enable: 1,
      authModel: 2,
      authTypeList,
      boxList: '',
    },
  };
}

/**
 * 构造胁迫码添加消息 (type=9, op=passport-add)
 * ⚠️ 胁迫码只保存数据库，不下发到设备
 */
function buildDuressAddMessage(personId: string, duressCode: string, credentialId: number, authTypeList: string): IamsMessage {
  const now = Date.now();
  const requestId = generateRequestId('duress-add');
  const passportVer = `iris-device-001-${now}`;

  return {
    time: now,
    requestId,
    deviceId: IRIS_DEVICE_ID,
    op: 'passport-add',
    data: {
      opId: '1',
      passportVer,
      personId,
      personName: '',  // 胁迫码不需要显示姓名
      personType: 'n',
      id: credentialId,
      type: 9,
      content: duressCode,
      showInfo: [],
      tags: [],
      startTime: null,
      endTime: null,
      enable: 1,
      authModel: 2,
      authTypeList,
      boxList: '',
    },
  };
}

/**
 * 构造虹膜添加消息（指定personId和credentialId）
 */
function buildIrisAddMessageCustom(irisData: IrisUserData, personId: string, credentialId: number, authTypeList: string): IamsMessage {
  const now = Date.now();
  const requestId = generateRequestId('iris-add');
  const passportVer = `${IRIS_DEVICE_ID}-${now}`;
  const content = `${irisData.irisLeftImage}|==BMP-SEP==|${irisData.irisRightImage}`;

  return {
    time: now,
    requestId,
    deviceId: IRIS_DEVICE_ID,
    op: 'passport-add',
    data: {
      opId: '1',
      passportVer,
      personId,
      personName: irisData.name,
      personType: 'n',
      id: credentialId,
      type: 7,
      content,
      showInfo: ['欢迎', irisData.name],
      tags: [],
      startTime: null,
      endTime: null,
      enable: 1,
      authModel: 2,
      authTypeList,
      boxList: 'rc10|rc20',
    },
  };
}

/**
 * 构造掌纹添加消息（指定personId和credentialId）
 */
function buildPalmAddMessageCustom(palmData: PalmUserData, personId: string, credentialId: number, authTypeList: string): IamsMessage {
  const now = Date.now();
  const requestId = generateRequestId('palm-add');
  const passportVer = `${PALM_DEVICE_ID}-${now}`;

  return {
    time: now,
    requestId,
    deviceId: PALM_DEVICE_ID,
    op: 'passport-add',
    data: {
      opId: '1',
      passportVer,
      personId,
      personName: palmData.userId,
      personType: 'n',
      id: credentialId,
      type: 8,
      content: palmData.featureData,
      showInfo: ['欢迎', palmData.userId],
      tags: [],
      startTime: null,
      endTime: null,
      enable: 1,
      authModel: 2,
      authTypeList,
      boxList: 'rc10|rc20',
    },
  };
}

// ============ MQTT 客户端 ============

class MqttTestClient {
  private client: MqttClient | null = null;
  private irisData: IrisUserData | null = null;
  private palmData: PalmUserData | null = null;
  private pendingMessages: Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }> = new Map();

  constructor() {
    // 启动时加载数据
    this.irisData = loadIrisData();
    this.palmData = loadPalmData();
  }

  /**
   * 连接 MQTT Broker 并订阅响应主题
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`[${timestamp()}] [MQTT] 正在连接 ${MQTT_BROKER} ...`);

      this.client = mqtt.connect(MQTT_BROKER, {
        clientId: `mqtt-test-client-${Date.now()}`,
        reconnectPeriod: 5000,
        connectTimeout: 30000,
        clean: true,
      });

      this.client.on('connect', () => {
        console.log(`[${timestamp()}] [MQTT] ✅ 连接成功`);

        // ⚠️ 订阅响应主题（passport-add, passport-update, passport-del）
        const responseTopics = [
          `${TOPIC_PREFIX}/${IRIS_DEVICE_ID}/up/passport-add-result`,
          `${TOPIC_PREFIX}/${IRIS_DEVICE_ID}/up/passport-update-result`,
          `${TOPIC_PREFIX}/${IRIS_DEVICE_ID}/up/passport-del-result`,
          `${TOPIC_PREFIX}/${PALM_DEVICE_ID}/up/passport-add-result`,
          `${TOPIC_PREFIX}/${PALM_DEVICE_ID}/up/passport-update-result`,
          `${TOPIC_PREFIX}/${PALM_DEVICE_ID}/up/passport-del-result`,
        ];

        this.client!.subscribe(responseTopics, { qos: 1 }, (err) => {
          if (err) {
            console.error(`[${timestamp()}] [MQTT] ❌ 订阅响应主题失败: ${err.message}`);
          } else {
            console.log(`[${timestamp()}] [MQTT] ✅ 已订阅响应主题，等待服务端返回结果`);
          }
        });

        resolve();
      });

      // 接收服务端返回的结果
      this.client!.on('message', (topic: string, payload: Buffer) => {
        if (topic.includes('/up/') && topic.includes('-result')) {
          this.handleResponse(topic, payload);
        }
      });

      this.client.on('error', (err) => {
        console.error(`[${timestamp()}] [MQTT] ❌ 连接错误: ${err.message}`);
        reject(err);
      });

      this.client.on('close', () => {
        console.log(`[${timestamp()}] [MQTT] 🔌 连接已断开`);
      });
    });
  }

  /**
   * 处理服务端返回的响应
   */
  private handleResponse(topic: string, payload: Buffer): void {
    try {
      const response = JSON.parse(payload.toString());
      const requestId = response.requestId || response.messageId;

      console.log(`\n[${timestamp()}] [MQTT] 📥 收到服务端响应: ${topic}`);
      console.log(`[${timestamp()}] [MQTT] 📦 requestId: ${requestId}`);
      console.log(`[${timestamp()}] [MQTT] 📦 状态: ${response.status || (response.data?.code === 200 ? 'success' : 'failed')}`);
      if (response.error) {
        console.log(`[${timestamp()}] [MQTT] 📦 错误: ${response.error}`);
      }
      if (response.data?.msg) {
        console.log(`[${timestamp()}] [MQTT] 📦 消息: ${response.data.msg}`);
      }

      // 检查是否有等待该消息的 Promise
      const pending = this.pendingMessages.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingMessages.delete(requestId);

        if (response.status === 'success' || response.data?.code === 200) {
          pending.resolve(response);
        } else {
          pending.reject(new Error(response.error || response.data?.msg || '下发失败'));
        }
      }
    } catch (error: any) {
      console.error(`[${timestamp()}] [MQTT] ❌ 解析响应失败: ${error.message}`);
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.pendingMessages.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(new Error('客户端断开连接'));
    });
    this.pendingMessages.clear();

    if (this.client) {
      this.client.end();
      this.client = null;
    }
  }

  /**
   * 发送 IAMS 格式消息并等待响应
   * ⚠️ Topic: sys/face/{deviceId}/down/{op}
   */
  async sendMessage(message: IamsMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('MQTT客户端未连接'));
        return;
      }

      // ⚠️ IAMS 格式的 Topic: sys/face/{deviceId}/down/{op}
      const topic = `${TOPIC_PREFIX}/${message.deviceId}/down/${message.op}`;
      const payload = JSON.stringify(message);

      console.log(`[${timestamp()}] [MQTT] 📤 发送消息到: ${topic}`);
      console.log(`[${timestamp()}] [MQTT] 📦 requestId: ${message.requestId}`);
      console.log(`[${timestamp()}] [MQTT] 📦 操作: ${message.op}`);
      console.log(`[${timestamp()}] [MQTT] 📦 personId: ${message.data.personId}`);
      console.log(`[${timestamp()}] [MQTT] 📦 凭证ID: ${message.data.id}`);
      console.log(`[${timestamp()}] [MQTT] 📦 凭证类型: ${message.data.type}`);
      console.log(`[${timestamp()}] [MQTT] 📦 消息体大小: ${payload.length} 字符`);

      if (message.data.content) {
        console.log(`[${timestamp()}] [MQTT] 📦 content长度: ${message.data.content.length}`);
      }

      // 设置超时（60秒）
      const timeout = setTimeout(() => {
        this.pendingMessages.delete(message.requestId);
        reject(new Error('等待服务端响应超时（60秒）'));
      }, 60000);

      // 保存待处理的消息
      this.pendingMessages.set(message.requestId, { resolve, reject, timeout });

      this.client!.publish(topic, payload, { qos: 1 }, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pendingMessages.delete(message.requestId);
          console.error(`[${timestamp()}] [MQTT] ❌ 发送失败: ${err.message}`);
          reject(err);
        } else {
          console.log(`[${timestamp()}] [MQTT] ✅ 消息发送成功，等待服务端响应...`);
        }
      });
    });
  }

  /**
   * 执行虹膜新增
   */
  async doIrisAdd(): Promise<void> {
    if (!this.irisData) {
      console.error(`[${timestamp()}] ❌ 没有加载到虹膜数据`);
      return;
    }

    const message = buildIrisAddMessage(this.irisData);
    await this.sendMessage(message);
  }

  /**
   * 执行虹膜更新
   * ⚠️ 更新只修改属性，不操作设备
   */
  async doIrisUpdate(): Promise<void> {
    if (!this.irisData) {
      console.error(`[${timestamp()}] ❌ 没有加载到虹膜数据`);
      return;
    }

    const message = buildIrisUpdateMessage(this.irisData);
    await this.sendMessage(message);
  }

  /**
   * 执行虹膜删除
   */
  async doIrisDelete(): Promise<void> {
    const message = buildIrisDeleteMessage();
    await this.sendMessage(message);
  }

  /**
   * 执行掌纹新增
   */
  async doPalmAdd(): Promise<void> {
    if (!this.palmData) {
      console.error(`[${timestamp()}] ❌ 没有加载到掌纹数据`);
      return;
    }

    const message = buildPalmAddMessage(this.palmData);
    await this.sendMessage(message);
  }

  /**
   * 执行掌纹更新
   * ⚠️ 更新只修改属性，不操作设备
   */
  async doPalmUpdate(): Promise<void> {
    if (!this.palmData) {
      console.error(`[${timestamp()}] ❌ 没有加载到掌纹数据`);
      return;
    }

    const message = buildPalmUpdateMessage(this.palmData);
    await this.sendMessage(message);
  }

  /**
   * 执行掌纹删除
   */
  async doPalmDelete(): Promise<void> {
    const message = buildPalmDeleteMessage();
    await this.sendMessage(message);
  }

  // ============ 批量操作（功能7、8、9） ============

  /**
   * 功能7：清空所有凭证
   * 流程：查询数据库 → 获取所有凭证 → 逐个发送删除消息
   */
  async doClearAll(): Promise<void> {
    console.log(`[${timestamp()}] >>> 功能7: 清空所有凭证`);

    // 1. 直接查询SQLite数据库
    const dbPath = path.join(process.cwd(), 'data', 'noah-ark.db');

    if (!fs.existsSync(dbPath)) {
      console.error(`[${timestamp()}] ❌ 数据库文件不存在: ${dbPath}`);
      throw new Error('数据库文件不存在');
    }

    // 使用 @libsql/client
    const db = createClient({ url: `file:${dbPath}` });

    // 查询所有凭证
    const result = await db.execute('SELECT credential_id, person_id, type FROM credentials');
    const credentials = result.rows.map(row => ({
      credential_id: row.credential_id as number,
      person_id: row.person_id as string,
      type: row.type as number,
    }));

    console.log(`[${timestamp()}] 数据库中共有 ${credentials.length} 条凭证`);

    if (credentials.length === 0) {
      console.log(`[${timestamp()}] ✅ 没有凭证需要删除`);
      return;
    }

    // 2. 按类型分组
    const irisCredentials = credentials.filter(c => c.type === 7);
    const palmCredentials = credentials.filter(c => c.type === 8);
    const otherCredentials = credentials.filter(c => c.type !== 7 && c.type !== 8);

    console.log(`[${timestamp()}] 虹膜凭证: ${irisCredentials.length} 条`);
    console.log(`[${timestamp()}] 掌纹凭证: ${palmCredentials.length} 条`);
    console.log(`[${timestamp()}] 其他凭证(密码/胁迫码): ${otherCredentials.length} 条`);

    // 3. 删除虹膜凭证
    for (const cred of irisCredentials) {
      const message = buildIrisDeleteMessageCustom(cred.credential_id);
      console.log(`[${timestamp()}] 删除虹膜凭证: credentialId=${cred.credential_id}, personId=${cred.person_id}`);
      try {
        await this.sendMessage(message);
        console.log(`[${timestamp()}] ✅ 删除成功`);
      } catch (error: any) {
        console.error(`[${timestamp()}] ❌ 删除失败: ${error.message}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }

    // 4. 删除掌纹凭证
    for (const cred of palmCredentials) {
      const message = buildPalmDeleteMessageCustom(cred.credential_id);
      console.log(`[${timestamp()}] 删除掌纹凭证: credentialId=${cred.credential_id}, personId=${cred.person_id}`);
      try {
        await this.sendMessage(message);
        console.log(`[${timestamp()}] ✅ 删除成功`);
      } catch (error: any) {
        console.error(`[${timestamp()}] ❌ 删除失败: ${error.message}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }

    // 5. 其他凭证（密码、胁迫码）直接删除数据库记录
    if (otherCredentials.length > 0) {
      console.log(`[${timestamp()}] 删除密码/胁迫码凭证（直接删除数据库记录）...`);
      await db.execute('DELETE FROM credentials WHERE type IN (5, 9)');
      console.log(`[${timestamp()}] ✅ 已删除 ${otherCredentials.length} 条密码/胁迫码凭证`);
    }

    console.log(`[${timestamp()}] ✅ 功能7完成`);
  }

  /**
   * 功能8：添加测试用户凭证
   * 用户1: 密码+胁迫码+虹膜 (personId: 18个1)
   * 用户2: 密码+胁迫码+掌纹 (personId: 18个2)
   */
  async doAddTestUsers(): Promise<void> {
    console.log(`[${timestamp()}] >>> 功能8: 添加测试用户凭证`);

    const irisData = this.irisData;
    const palmData = this.palmData;

    if (!irisData) {
      console.error(`[${timestamp()}] ❌ 没有加载虹膜数据`);
      throw new Error('没有虹膜数据');
    }

    if (!palmData) {
      console.error(`[${timestamp()}] ❌ 没有加载掌纹数据`);
      throw new Error('没有掌纹数据');
    }

    const baseTime = Date.now();

    // ===== 测试用户1 (18个1) =====
    console.log(`[${timestamp()}] === 测试用户1 (personId: ${IRIS_PERSON_ID}) ===`);

    // 1. 密码 (type=5)
    const pwd1Id = baseTime + 5;
    const pwd1Msg = buildPasswordAddMessage(IRIS_PERSON_ID, '12345', pwd1Id, '测试用户1', '5,7,9');
    console.log(`[${timestamp()}] 步骤1: 添加密码凭证 (id=${pwd1Id})...`);
    try {
      await this.sendMessage(pwd1Msg);
      console.log(`[${timestamp()}] ✅ 密码凭证添加成功`);
    } catch (error: any) {
      console.error(`[${timestamp()}] ❌ 密码凭证添加失败: ${error.message}`);
    }
    await new Promise(r => setTimeout(r, 200));

    // 2. 胁迫码 (type=9)
    const duress1Id = baseTime + 9;
    const duress1Msg = buildDuressAddMessage(IRIS_PERSON_ID, '54321', duress1Id, '5,7,9');
    console.log(`[${timestamp()}] 步骤2: 添加胁迫码凭证 (id=${duress1Id})...`);
    try {
      await this.sendMessage(duress1Msg);
      console.log(`[${timestamp()}] ✅ 胁迫码凭证添加成功`);
    } catch (error: any) {
      console.error(`[${timestamp()}] ❌ 胁迫码凭证添加失败: ${error.message}`);
    }
    await new Promise(r => setTimeout(r, 200));

    // 3. 虹膜 (type=7)
    const iris1Id = baseTime + 7;
    const iris1Msg = buildIrisAddMessageCustom(irisData, IRIS_PERSON_ID, iris1Id, '5,7,9');
    console.log(`[${timestamp()}] 步骤3: 添加虹膜凭证 (id=${iris1Id})...`);
    try {
      await this.sendMessage(iris1Msg);
      console.log(`[${timestamp()}] ✅ 虹膜凭证添加成功`);
    } catch (error: any) {
      console.error(`[${timestamp()}] ❌ 虹膜凭证添加失败: ${error.message}`);
    }
    await new Promise(r => setTimeout(r, 200));

    // ===== 测试用户2 (18个2) =====
    console.log(`[${timestamp()}] === 测试用户2 (personId: ${PALM_PERSON_ID}) ===`);

    // 4. 密码 (type=5)
    const pwd2Id = baseTime + 105;
    const pwd2Msg = buildPasswordAddMessage(PALM_PERSON_ID, '123456', pwd2Id, '测试用户2', '5,8,9');
    // 发送到掌纹设备主题（密码实际不下发设备）
    pwd2Msg.deviceId = PALM_DEVICE_ID;
    pwd2Msg.data.passportVer = `${PALM_DEVICE_ID}-${baseTime}`;
    console.log(`[${timestamp()}] 步骤4: 添加密码凭证 (id=${pwd2Id})...`);
    try {
      await this.sendMessage(pwd2Msg);
      console.log(`[${timestamp()}] ✅ 密码凭证添加成功`);
    } catch (error: any) {
      console.error(`[${timestamp()}] ❌ 密码凭证添加失败: ${error.message}`);
    }
    await new Promise(r => setTimeout(r, 200));

    // 5. 胁迫码 (type=9)
    const duress2Id = baseTime + 109;
    const duress2Msg = buildDuressAddMessage(PALM_PERSON_ID, '654321', duress2Id, '5,8,9');
    duress2Msg.deviceId = PALM_DEVICE_ID;
    duress2Msg.data.passportVer = `${PALM_DEVICE_ID}-${baseTime}`;
    console.log(`[${timestamp()}] 步骤5: 添加胁迫码凭证 (id=${duress2Id})...`);
    try {
      await this.sendMessage(duress2Msg);
      console.log(`[${timestamp()}] ✅ 胁迫码凭证添加成功`);
    } catch (error: any) {
      console.error(`[${timestamp()}] ❌ 胁迫码凭证添加失败: ${error.message}`);
    }
    await new Promise(r => setTimeout(r, 200));

    // 6. 掌纹 (type=8)
    const palm2Id = baseTime + 108;
    const palm2Msg = buildPalmAddMessageCustom(palmData, PALM_PERSON_ID, palm2Id, '5,8,9');
    console.log(`[${timestamp()}] 步骤6: 添加掌纹凭证 (id=${palm2Id})...`);
    try {
      await this.sendMessage(palm2Msg);
      console.log(`[${timestamp()}] ✅ 掌纹凭证添加成功`);
    } catch (error: any) {
      console.error(`[${timestamp()}] ❌ 掌纹凭证添加失败: ${error.message}`);
    }

    console.log(`[${timestamp()}] ✅ 功能8完成`);
  }

  /**
   * 功能9：添加完整测试凭证（仅测试用户1）
   * 用户1: 密码+胁迫码+虹膜+掌纹 (personId: 18个1)
   */
  async doAddFullTestUser(): Promise<void> {
    console.log(`[${timestamp()}] >>> 功能9: 添加完整测试凭证（测试用户1）`);

    const irisData = this.irisData;
    const palmData = this.palmData;

    if (!irisData) {
      console.error(`[${timestamp()}] ❌ 没有加载虹膜数据`);
      throw new Error('没有虹膜数据');
    }

    if (!palmData) {
      console.error(`[${timestamp()}] ❌ 没有加载掌纹数据`);
      throw new Error('没有掌纹数据');
    }

    const baseTime = Date.now();
    const authTypeList = '5,7,8,9';

    console.log(`[${timestamp()}] === 测试用户1 (personId: ${IRIS_PERSON_ID}) ===`);

    // 1. 密码 (type=5)
    const pwdId = baseTime + 5;
    const pwdMsg = buildPasswordAddMessage(IRIS_PERSON_ID, '12345', pwdId, '测试用户1', authTypeList);
    console.log(`[${timestamp()}] 步骤1: 添加密码凭证 (id=${pwdId})...`);
    try {
      await this.sendMessage(pwdMsg);
      console.log(`[${timestamp()}] ✅ 密码凭证添加成功`);
    } catch (error: any) {
      console.error(`[${timestamp()}] ❌ 密码凭证添加失败: ${error.message}`);
    }
    await new Promise(r => setTimeout(r, 200));

    // 2. 胁迫码 (type=9)
    const duressId = baseTime + 9;
    const duressMsg = buildDuressAddMessage(IRIS_PERSON_ID, '54321', duressId, authTypeList);
    console.log(`[${timestamp()}] 步骤2: 添加胁迫码凭证 (id=${duressId})...`);
    try {
      await this.sendMessage(duressMsg);
      console.log(`[${timestamp()}] ✅ 胁迫码凭证添加成功`);
    } catch (error: any) {
      console.error(`[${timestamp()}] ❌ 胁迫码凭证添加失败: ${error.message}`);
    }
    await new Promise(r => setTimeout(r, 200));

    // 3. 虹膜 (type=7)
    const irisId = baseTime + 7;
    const irisMsg = buildIrisAddMessageCustom(irisData, IRIS_PERSON_ID, irisId, authTypeList);
    console.log(`[${timestamp()}] 步骤3: 添加虹膜凭证 (id=${irisId})...`);
    try {
      await this.sendMessage(irisMsg);
      console.log(`[${timestamp()}] ✅ 虹膜凭证添加成功`);
    } catch (error: any) {
      console.error(`[${timestamp()}] ❌ 虹膜凭证添加失败: ${error.message}`);
    }
    await new Promise(r => setTimeout(r, 200));

    // 4. 掌纹 (type=8) - ⚠️ 掌纹发给掌纹设备，但personId用18个1
    const palmId = baseTime + 8;
    const palmMsg = buildPalmAddMessageCustom(palmData, IRIS_PERSON_ID, palmId, authTypeList);
    // ⚠️ 修改personName为测试用户1
    palmMsg.data.personName = '测试用户1';
    palmMsg.data.showInfo = ['欢迎', '测试用户1'];
    console.log(`[${timestamp()}] 步骤4: 添加掌纹凭证 (id=${palmId})...`);
    try {
      await this.sendMessage(palmMsg);
      console.log(`[${timestamp()}] ✅ 掌纹凭证添加成功`);
    } catch (error: any) {
      console.error(`[${timestamp()}] ❌ 掌纹凭证添加失败: ${error.message}`);
    }

    console.log(`[${timestamp()}] ✅ 功能9完成`);
    console.log(`[${timestamp()}] 掌纹userId已存储到custom_id字段，识别时自动匹配`);
  }
}

// ============ 交互式菜单 ============

function printMenu(): void {
  console.log('\n========================================');
  console.log('  MQTT Test Client (IAMS Format)');
  console.log('========================================');
  console.log(`  Broker: ${MQTT_BROKER}`);
  console.log(`  Iris Device: ${IRIS_DEVICE_ID}`);
  console.log(`  Palm Device: ${PALM_DEVICE_ID}`);
  console.log('========================================');
  console.log('  基础操作:');
  console.log('  1. Iris Add (passport-add)');
  console.log('  2. Iris Update (passport-update, 只更新属性)');
  console.log('  3. Iris Delete (passport-del)');
  console.log('  4. Palm Add (passport-add)');
  console.log('  5. Palm Update (passport-update, 只更新属性)');
  console.log('  6. Palm Delete (passport-del)');
  console.log('========================================');
  console.log('  批量操作:');
  console.log('  7. 清空所有凭证 (删除虹膜+掌纹)');
  console.log('  8. 添加测试用户凭证 (用户1: 密码+胁迫码+虹膜, 用户2: 密码+胁迫码+掌纹)');
  console.log('  9. 添加完整测试凭证 (用户1: 密码+胁迫码+虹膜+掌纹)');
  console.log('========================================');
  console.log('  0. Exit');
  console.log('========================================');
}

async function main(): Promise<void> {
  console.log(`[${timestamp()}] MQTT Test Client starting...`);

  const mqttClient = new MqttTestClient();

  try {
    await mqttClient.connect();
  } catch (error: any) {
    console.error(`[${timestamp()}] Failed to connect MQTT: ${error.message}`);
    console.log(`[${timestamp()}] Make sure MQTT Broker is running: ${MQTT_BROKER}`);
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };

  // Main loop
  let running = true;
  while (running) {
    printMenu();
    const choice = await question('Select: ');

    try {
      switch (choice.trim()) {
        case '1':
          console.log(`\n[${timestamp()}] >>> Executing: Iris Add`);
          await mqttClient.doIrisAdd();
          break;

        case '2':
          console.log(`\n[${timestamp()}] >>> Executing: Iris Update (只更新属性)`);
          await mqttClient.doIrisUpdate();
          break;

        case '3':
          console.log(`\n[${timestamp()}] >>> Executing: Iris Delete`);
          await mqttClient.doIrisDelete();
          break;

        case '4':
          console.log(`\n[${timestamp()}] >>> Executing: Palm Add`);
          await mqttClient.doPalmAdd();
          break;

        case '5':
          console.log(`\n[${timestamp()}] >>> Executing: Palm Update (只更新属性)`);
          await mqttClient.doPalmUpdate();
          break;

        case '6':
          console.log(`\n[${timestamp()}] >>> Executing: Palm Delete`);
          await mqttClient.doPalmDelete();
          break;

        case '7':
          console.log(`\n[${timestamp()}] >>> Executing: 功能7 - 清空所有凭证`);
          await mqttClient.doClearAll();
          break;

        case '8':
          console.log(`\n[${timestamp()}] >>> Executing: 功能8 - 添加测试用户凭证`);
          await mqttClient.doAddTestUsers();
          break;

        case '9':
          console.log(`\n[${timestamp()}] >>> Executing: 功能9 - 添加完整测试凭证`);
          await mqttClient.doAddFullTestUser();
          break;

        case '0':
          console.log(`\n[${timestamp()}] Exiting...`);
          running = false;
          break;

        default:
          console.log(`\n[${timestamp()}] Invalid choice: ${choice}`);
      }
    } catch (error: any) {
      console.error(`[${timestamp()}] Error: ${error.message}`);
    }

    if (running) {
      await question('\nPress Enter to continue...');
    }
  }

  mqttClient.disconnect();
  rl.close();
  process.exit(0);
}

// 运行
main().catch((error) => {
  console.error(`[${timestamp()}] ❌ 程序异常:`, error);
  process.exit(1);
});
/**
 * 设备同步模块
 * 负责与虹膜设备和掌纹设备进行数据同步
 * 文档：docs/诺亚方舟项目/生物识别设备数据接口解析.md
 * @updated 2026-03-30 - 导出 convertToBmpBase64 函数
 */

import http from 'http';
import sharp from 'sharp';
import { getSampleFaceImage } from './sample-face-image';
import {
  getPendingQueueItems,
  updateQueueStatus,
  addSyncLog,
  getDeviceConfigs,
  type SyncStatus,
  type DeviceConfig,
} from './sync-queue';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// 东八区时间格式化
function bjt(): string {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

// 设备配置
const PALM_DEVICE_CONFIG = {
  endpoint: process.env.PALM_DEVICE_ENDPOINT || 'http://127.0.0.1:8080',
  timeout: 10000, // 10 秒
};

const IRIS_DEVICE_CONFIG = {
  endpoint: process.env.IRIS_DEVICE_ENDPOINT || 'http://192.168.3.202:9003',
  timeout: 10000, // 10 秒
};

// memberSave 接口超时
const IRIS_MEMBER_SAVE_TIMEOUT = 20000; // 20 秒

/**
 * 用 Node.js http.request 发送请求，每条请求使用独立 TCP 连接。
 * 虹膜设备不支持 keep-alive 连接复用，必须用独立连接。
 */
function httpRequest(
  endpoint: string,
  path: string,
  body?: object,
  timeout: number = 15000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint + path);
    const postData = body ? JSON.stringify(body) : '';

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Connection': 'close',  // 明确告诉设备请求完成后关闭连接
      },
      // 关键：禁用 keep-alive，确保每次都是全新连接
      agent: false,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`解析失败: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error('请求超时'));
    });

    if (postData) req.write(postData);
    req.end();
  });
}

/**
 * 虹膜设备统一请求入口：所有发往虹膜设备的 HTTP 请求都走这里，
 * 自动通过全局队列串行化，保证 1500ms 最小间隔。
 * @param endpoint 设备地址（如 http://192.168.3.202:9003）
 * @param path 接口路径（如 /memberSave）
 * @param body 请求体
 * @param timeout 超时时间（毫秒）
 */
export function irisRequest(
  endpoint: string,
  path: string,
  body?: object,
  timeout: number = 15000
): Promise<any> {
  return enqueueIrisCommand(
    path,
    () => httpRequest(endpoint, path, body, timeout),
    IRIS_COMMAND_INTERVAL_MS
  );
}

/**
 * 从 content 字段解析虹膜图片
 * 新格式：content 字段用 |==BMP-SEP==| 分隔左右眼，没有分隔符则只有左眼
 */
function parseIrisContent(content: string): { leftIris: string; rightIris: string } {
  const SEPARATOR = '|==BMP-SEP==|';
  if (content && content.includes(SEPARATOR)) {
    const parts = content.split(SEPARATOR);
    return { leftIris: parts[0] || '', rightIris: parts[1] || '' };
  }
  return { leftIris: content || '', rightIris: '' };
}

/**
 * 将图片 Base64 转换为 BMP 格式（8位灰度）
 * 虹膜设备的 memberSave 接口要求 BMP 格式，通常是灰度图
 * @param base64Data 图片的 Base64 编码（可能是 JPG/PNG/BMP 等格式）
 * @returns BMP 格式的 Base64 编码
 */
export async function convertToBmpBase64(base64Data: string): Promise<string> {
  try {
    if (!base64Data) {
      console.log(`[${bjt()}] [ImageConvert] 输入数据为空，返回空`);
      return '';
    }

    // 移除可能的 data:image/xxx;base64, 前缀
    const pureBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');

    // Base64 解码为 Buffer
    const imageBuffer = Buffer.from(pureBase64, 'base64');

    // 调试：检测原始图片格式
    let originalFormat = 'unknown';
    if (imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8) {
      originalFormat = 'JPEG';
    } else if (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50) {
      originalFormat = 'PNG';
    } else if (imageBuffer[0] === 0x42 && imageBuffer[1] === 0x4D) {
      originalFormat = 'BMP';
    }
    console.log(`[${bjt()}] [ImageConvert] 原始格式: ${originalFormat}, 大小: ${imageBuffer.length} bytes`);

    // 检查是否已经是 BMP 格式（BMP 文件头前两个字节是 'BM'，即 0x42 0x4D）
    if (imageBuffer[0] === 0x42 && imageBuffer[1] === 0x4D) {
      console.log(`[${bjt()}] [ImageConvert] ✅ 已是 BMP 格式，无需转换`);
      return pureBase64;
    }

    // 不是 BMP 格式，需要转换
    console.log(`[${bjt()}] [ImageConvert] ⚠️ 非 BMP 格式(${originalFormat})，正在转换为灰度 BMP...`);

    // 用 sharp 解码并转为灰度
    const { data, info } = await sharp(imageBuffer)
      .grayscale() // 转为灰度
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height, channels } = info;
    console.log(`[${bjt()}] [ImageConvert] 图片尺寸: ${width}x${height}, 通道数: ${channels}`);

    // 8 位灰度 BMP
    const rowSize = width; // 每像素 1 字节
    const padding = (4 - (rowSize % 4)) % 4;
    const paddedRowSize = rowSize + padding;
    const pixelDataSize = paddedRowSize * height;
    const paletteSize = 256 * 4; // 256 色调色板，每色 4 字节
    const fileSize = 54 + paletteSize + pixelDataSize;

    // 创建 BMP 文件
    const bmpBuffer = Buffer.alloc(fileSize);
    let offset = 0;

    // BMP 文件头 (14 bytes)
    bmpBuffer.write('BM', offset); offset += 2;
    bmpBuffer.writeUInt32LE(fileSize, offset); offset += 4;
    bmpBuffer.writeUInt16LE(0, offset); offset += 2;
    bmpBuffer.writeUInt16LE(0, offset); offset += 2;
    bmpBuffer.writeUInt32LE(54 + paletteSize, offset); offset += 4; // 像素数据偏移

    // DIB 头 - BITMAPINFOHEADER (40 bytes)
    bmpBuffer.writeUInt32LE(40, offset); offset += 4;
    bmpBuffer.writeInt32LE(width, offset); offset += 4;
    bmpBuffer.writeInt32LE(height, offset); offset += 4;    // 正数 = bottom-up
    bmpBuffer.writeUInt16LE(1, offset); offset += 2;       // 颜色平面数
    bmpBuffer.writeUInt16LE(8, offset); offset += 2;       // 每像素 8 位
    bmpBuffer.writeUInt32LE(0, offset); offset += 4;       // 压缩方式
    bmpBuffer.writeUInt32LE(pixelDataSize, offset); offset += 4;
    bmpBuffer.writeInt32LE(2835, offset); offset += 4;
    bmpBuffer.writeInt32LE(2835, offset); offset += 4;
    bmpBuffer.writeUInt32LE(256, offset); offset += 4;     // 调色板颜色数
    bmpBuffer.writeUInt32LE(0, offset); offset += 4;

    // 调色板 (256 色，每色 4 字节 BGRA)
    for (let i = 0; i < 256; i++) {
      bmpBuffer[offset++] = i; // B
      bmpBuffer[offset++] = i; // G
      bmpBuffer[offset++] = i; // R
      bmpBuffer[offset++] = 0; // A (保留)
    }

    // 写入像素数据（bottom-up：从下往上）
    for (let y = height - 1; y >= 0; y--) {
      for (let x = 0; x < width; x++) {
        const srcIdx = y * width + x;
        bmpBuffer[offset++] = data[srcIdx]; // 灰度值
      }
      for (let p = 0; p < padding; p++) {
        bmpBuffer[offset++] = 0;
      }
    }

    console.log(`[${bjt()}] [ImageConvert] ✅ 转换成功: ${width}x${height} 灰度 BMP, ${fileSize} bytes`);

    const result = bmpBuffer.toString('base64');
    console.log(`[${bjt()}] [ImageConvert] ✅ 返回 BMP Base64, 长度: ${result.length}, 前4字符: ${result.substring(0, 4)}`);
    return result;
  } catch (error: any) {
    console.error(`[${bjt()}] [ImageConvert] ❌ 转换 BMP 失败: ${error.message}`);
    // ⚠️ 转换失败返回空字符串，不返回原始数据（避免发送错误格式）
    return '';
  }
}

/**
 * 翻译网络错误消息为中文
 * 只翻译网络相关错误，设备返回的错误保持原样
 */
function translateErrorMessage(error: string): string {
  if (!error) return error;

  // 网络错误翻译映射
  const translations: [RegExp, string][] = [
    [/fetch failed/i, '网络请求失败'],
    [/aborted due to timeout/i, '请求超时'],
    [/ECONNREFUSED/i, '连接被拒绝'],
    [/ENOTFOUND/i, '无法解析主机名'],
    [/ETIMEDOUT/i, '连接超时'],
    [/EHOSTUNREACH/i, '主机不可达'],
    [/ENETUNREACH/i, '网络不可达'],
    [/socket hang up/i, '连接被关闭'],
    [/network error/i, '网络错误'],
    [/connection reset/i, '连接被重置'],
  ];

  for (const [pattern, chinese] of translations) {
    if (pattern.test(error)) {
      return chinese;
    }
  }

  // 其他错误保持原样（包括设备返回的错误如 code=404）
  return error;
}

/**
 * 同步到掌纹设备（110 接口）
 * ⚠️ 必须使用 Node.js http 模块，sendData 不能编码！
 */
export async function syncToPalmDeviceMQTT(
  endpoint: string,
  payload: {
    userId: string;      // 凭证 ID
    featureData: string; // 掌纹特征 Base64
  }
): Promise<{ success: boolean; response?: string; error?: string; code?: number }> {
  const startTime = Date.now();
  // 缩短 featureData 显示，只显示前10个字符
  const featurePreview = payload.featureData?.substring(0, 10) + '...' || 'null';
  console.log(`[PalmDevice] 下发凭证到 ${endpoint}`);
  console.log(`[PalmDevice] userId: ${payload.userId}, featureData: ${featurePreview} (长度: ${payload.featureData?.length || 0})`);

  // 解析 endpoint
  const url = new URL(endpoint);
  const host = url.hostname;
  const port = parseInt(url.port) || 80;

  // ⚠️ 关键：sendData 不能编码，但需要正确转义 JSON 特殊字符
  const sendData = JSON.stringify({
    request: "110",
    userId: payload.userId,
    featureData: payload.featureData
  });
  const path = `/api?sendData=${sendData}`;

  console.log(`[PalmDevice] 请求路径长度: ${path.length}`);

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: host,
        port: port,
        path: path,
        method: 'POST',
        agent: false,
        timeout: PALM_DEVICE_CONFIG.timeout,
      },
      (res) => {
        const responseTime = Date.now() - startTime;
        console.log(`[PalmDevice] HTTP 状态: ${res.statusCode}, 耗时: ${responseTime}ms`);

        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          console.log(`[PalmDevice] 响应: ${data}`);

          try {
            const json = JSON.parse(data);
            // 响应码 200 表示成功（字符串或数字）
            if (json.code === '200' || json.code === 200) {
              console.log(`[PalmDevice] ✅ 下发成功`);
              resolve({ success: true, response: data });
            } else {
              console.log(`[PalmDevice] ❌ 下发失败: ${JSON.stringify(json)}`);
              const deviceMsg = json.msg || json.des || JSON.stringify(json);
              resolve({
                success: false,
                error: deviceMsg,
                code: 401
              });
            }
          } catch {
            console.error(`[PalmDevice] JSON 解析失败: ${data}`);
            resolve({ success: false, error: 'JSON 解析失败: ' + data });
          }
        });
      }
    );

    req.on('error', (error) => {
      const responseTime = Date.now() - startTime;
      console.error(`[PalmDevice] 请求失败 (${responseTime}ms):`, error.message);
      resolve({ success: false, error: translateErrorMessage(error.message) });
    });

    req.on('timeout', () => {
      console.error(`[PalmDevice] 请求超时`);
      req.destroy();
      resolve({ success: false, error: '请求超时' });
    });

    req.end();
  });
}

/**
 * 从掌纹设备删除（108 接口）
 * ⚠️ 必须使用 Node.js http 模块，sendData 不能编码！
 */
export async function deleteFromPalmDeviceMQTT(
  endpoint: string,
  userId: string
): Promise<{ success: boolean; response?: string; error?: string; code?: number }> {
  const startTime = Date.now();
  console.log(`[PalmDevice] 删除用户: ${userId}`);

  // 解析 endpoint
  const url = new URL(endpoint);
  const host = url.hostname;
  const port = parseInt(url.port) || 80;

  // ⚠️ 关键：sendData 不能编码！
  const sendData = `{"request":"108","userId":"${userId}"}`;
  const path = `/api?sendData=${sendData}`;

  console.log(`[PalmDevice] 请求路径: ${path}`);

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: host,
        port: port,
        path: path,
        method: 'POST',
        agent: false,
        timeout: PALM_DEVICE_CONFIG.timeout,
      },
      (res) => {
        const responseTime = Date.now() - startTime;
        console.log(`[PalmDevice] HTTP 状态: ${res.statusCode}, 耗时: ${responseTime}ms`);

        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          console.log(`[PalmDevice] 响应: ${data}`);

          try {
            const json = JSON.parse(data);
            if (json.code === '200' || json.code === 200) {
              console.log(`[PalmDevice] ✅ 删除成功`);
              resolve({ success: true, response: data });
            } else {
              console.log(`[PalmDevice] ❌ 删除失败: ${JSON.stringify(json)}`);
              const deviceMsg = json.msg || json.des || JSON.stringify(json);
              resolve({
                success: false,
                error: deviceMsg,
                code: 401
              });
            }
          } catch {
            console.error(`[PalmDevice] JSON 解析失败: ${data}`);
            resolve({ success: false, error: 'JSON 解析失败: ' + data });
          }
        });
      }
    );

    req.on('error', (error) => {
      console.error(`[PalmDevice] 请求失败:`, error.message);
      resolve({ success: false, error: error.message });
    });

    req.on('timeout', () => {
      console.error(`[PalmDevice] 请求超时`);
      req.destroy();
      resolve({ success: false, error: '请求超时' });
    });

    req.end();
  });
}

// 虹膜设备操作状态（防止并发 + 失败冷却）
type IrisDeviceState = 'idle' | 'busy' | 'cooling_down';
let irisDeviceState: IrisDeviceState = 'idle';
const IRIS_COOLDOWN_MS = 10000; // 冷却时间 10 秒

// 虹膜 personId 去重锁：防止 IAMS 快速连发同一条凭证导致重复下发
// 10 秒后自动清除
const irisPersonLock = new Map<string, NodeJS.Timeout>();

// ============================================================
// 虹膜设备全局命令队列
// 所有发往虹膜设备的请求都走这里，保证同一时间只有一条请求在飞
// 默认指令间隔 1500ms（全局统一常量）
// ============================================================
const IRIS_COMMAND_INTERVAL_MS = 1500;
let irisLastCommandTime = 0;

interface IrisQueueItem {
  fn: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  label: string;  // 用于日志追踪
}

let irisCommandQueue: IrisQueueItem[] = [];
let irisQueueProcessing = false;

async function processIrisCommandQueue(intervalMs: number = IRIS_COMMAND_INTERVAL_MS): Promise<void> {
  if (irisCommandQueue.length === 0) {
    irisQueueProcessing = false;
    return;
  }
  irisQueueProcessing = true;
  const item = irisCommandQueue.shift()!;
  try {
    const result = await item.fn();
    item.resolve(result);
  } catch (e) {
    item.reject(e);
  }
  // 请求间间隔
  if (intervalMs > 0 && irisCommandQueue.length > 0) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  processIrisCommandQueue(intervalMs);
}

/**
 * 将命令加入虹膜设备全局队列，确保同一时间只有一条请求在执行
 * @param label 命令标签（用于日志追踪）
 * @param fn 要执行的命令函数
 * @param intervalMs 执行完此命令后到下一条命令的间隔（毫秒），默认 IRIS_COMMAND_INTERVAL_MS (1500ms)
 */
export function enqueueIrisCommand<T>(label: string, fn: () => Promise<T>, intervalMs: number = IRIS_COMMAND_INTERVAL_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // 队列超过 500 条时整体清空，防止内存泄漏
    if (irisCommandQueue.length >= 50) {
      console.log(`[IrisQueue] ⚠️ 队列溢出(${irisCommandQueue.length}条)，清空后重新入队: ${label}`);
      irisCommandQueue.forEach(item => item.reject(new Error('队列溢出，已清空')));
      irisCommandQueue = [];
    }
    irisCommandQueue.push({ fn: fn as () => Promise<any>, resolve, reject, label });
    console.log(`[IrisQueue] 入队: ${label}（队列长度: ${irisCommandQueue.length}）`);
    if (!irisQueueProcessing) {
      processIrisCommandQueue(intervalMs);
    }
  });
}

/**
 * 发送虹膜设备指令前调用，确保与上一条指令间隔 ≥300ms
 */
async function irisCommandGuard(): Promise<void> {
  const now = Date.now();
  const elapsed = now - irisLastCommandTime;
  if (elapsed < IRIS_COMMAND_INTERVAL_MS) {
    const wait = IRIS_COMMAND_INTERVAL_MS - elapsed;
    await new Promise(resolve => setTimeout(resolve, wait));
  }
  irisLastCommandTime = Date.now();
}

/**
 * 虹膜设备锁定状态（按需下发用）
 * 使用 globalThis 存储，避免 Next.js 模块隔离导致的状态丢失。
 */
function getLockStateKey(): string { return 'irisDeviceLockState'; }

function readLockState(): 'locked' | 'unlocked' | 'unknown' {
  const val = (globalThis as any)[getLockStateKey()];
  return val || 'locked';  // 默认设备初始为锁定状态
}

function writeLockState(state: 'locked' | 'unlocked' | 'unknown'): void {
  (globalThis as any)[getLockStateKey()] = state;
}

let irisDeviceRelockTimer: NodeJS.Timeout | null = null;

/**
 * 获取虹膜设备当前锁定状态（供轮巡器使用）
 */
export function getIrisDeviceLockState(): 'locked' | 'unlocked' | 'unknown' {
  return readLockState();
}

/**
 * 检查虹膜设备是否空闲（供轮巡器使用，避免在上传时发送锁定指令）
 */
export function isIrisDeviceIdle(): boolean {
  return irisDeviceState !== 'busy';
}

/**
 * 同步到虹膜设备（memberSave 接口）- 仅添加，不锁定/解锁
 * 数据已经是 BMP 格式（从加密文件解密后直接使用）
 */
export async function uploadIrisToDevice(
  endpoint: string,
  payload: {
    staffNum: string;
    staffNumDec: string;
    memberName: string;
    irisLeftImage: string;
    irisRightImage: string;
    faceImage?: string;
    openDoor?: boolean;
    purview?: number;
    singleIrisAllowed?: number;
  },
  skipDebugLog?: boolean
): Promise<{ success: boolean; response?: string; error?: string }> {
  const url = `${endpoint}/memberSave`;

  // 从加密文件读取的数据可能是 JPG/PNG base64，需要转换为 BMP
  console.log(`[DeviceSync] 转换虹膜图片为 BMP 格式（uploadIrisToDevice）...`);
  const leftIrisBmp = payload.irisLeftImage ? await convertToBmpBase64(payload.irisLeftImage) : '';
  const rightIrisBmp = payload.irisRightImage ? await convertToBmpBase64(payload.irisRightImage) : '';

  const irisLeftPreview = leftIrisBmp?.substring(0, 10) + '...' || 'null';
  const irisRightPreview = rightIrisBmp?.substring(0, 10) + '...' || 'null';

  const requestData = {
    staffNum: payload.staffNum,
    cardNum: '',
    cardType: 0,
    faceImage: payload.faceImage || '',
    leftIrisImage: leftIrisBmp,
    rightIrisImage: rightIrisBmp,
    name: payload.memberName,
    openDoor: payload.openDoor !== false ? 1 : 0,
    purview: payload.purview || 30,
    purviewEndTime: 0.0,
    purviewStartTime: 0.0,
    singleIrisAllowed: payload.singleIrisAllowed ?? 1,
  };

  if (!skipDebugLog) {
    console.log(`[DeviceSync] 下发虹膜特征到 ${endpoint}`);
    console.log(`[DeviceSync] staffNum: ${payload.staffNum}, memberName: ${payload.memberName}`);
    console.log(`[DeviceSync] irisLeft (BMP): ${irisLeftPreview} (${leftIrisBmp?.length || 0}字符)`);
    console.log(`[DeviceSync] irisRight (BMP): ${irisRightPreview} (${rightIrisBmp?.length || 0}字符)`);
  }

  await irisCommandGuard();
  const responseData: any = await irisRequest(endpoint, '/memberSave', requestData, IRIS_MEMBER_SAVE_TIMEOUT);
  console.log(`[DeviceSync] 响应：${JSON.stringify(responseData)}`);

  if (responseData.errorCode === 0 || responseData.errorCode === '0') {
    return { success: true, response: JSON.stringify(responseData) };
  } else {
    return {
      success: false,
      error: `虹膜设备返回错误：errorCode=${responseData.errorCode}, errorInfo=${responseData.errorInfo || ''}`
    };
  }
}

/**
 * 锁定/解锁虹膜设备
 * 上传人员前需要锁定，上传后需要重新锁定
 *
 * errorCode=97 表示设备正在初始化（App not be inited），会自动重试。
 */
export async function setIrisDeviceSaveState(
  endpoint: string,
  state: 0 | 1  // 0=解锁, 1=锁定
): Promise<{ success: boolean; error?: string }> {
  try {
    const endpointUrl = new URL(endpoint);
    const deviceIp = endpointUrl.hostname;

    const requestData = {
      ip: deviceIp,
      state: state,
    };

    console.log(`[DeviceSync] ${state === 1 ? '锁定' : '解锁'}虹膜设备, ip: ${deviceIp}`);

    let retries = 0;
    const maxRetries = 3;
    while (true) {
      await irisCommandGuard();
      const responseData: any = await irisRequest(endpoint, '/memberSaveState', requestData, IRIS_DEVICE_CONFIG.timeout);
      console.log(`[DeviceSync] memberSaveState 响应: ${JSON.stringify(responseData)}`);

      if (responseData.errorCode === 0 || responseData.errorCode === '0') {
        const newState = state === 1 ? 'locked' : 'unlocked';
        console.log(`[DeviceSync] 更新锁定状态: ${newState}`);
        writeLockState(newState);
        return { success: true };
      }

      // errorCode=97 表示设备正在初始化，等待后重试
      if ((responseData.errorCode === 97 || responseData.errorCode === '97') && retries < maxRetries) {
        retries++;
        const waitMs = 2000 * retries;
        console.log(`[DeviceSync] errorCode=97（设备初始化中），等待 ${waitMs}ms 后重试 (${retries}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }

      return { success: false, error: `锁定/解锁失败: errorCode=${responseData.errorCode}` };
    }
  } catch (error: any) {
    console.error(`[DeviceSync] memberSaveState 失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 同步到虹膜设备（memberSave 接口）- 仅添加，不锁定/解锁
 * 用于更新场景：外部已控制锁定/解锁
 * @param skipBmpConversion 如果为 true，跳过 BMP 转换（数据已经是 BMP 格式）
 */
export async function syncToIrisDeviceWithoutLock(
  endpoint: string,
  payload: {
    staffNum: string;
    staffNumDec: string;
    memberName: string;
    irisLeftImage: string;
    irisRightImage: string;
    faceImage?: string;
    openDoor?: boolean;
    purview?: number;
    singleIrisAllowed?: number;
  },
  skipDebugLog?: boolean,
  skipBmpConversion?: boolean
): Promise<{ success: boolean; response?: string; error?: string }> {
  try {
    const url = `${endpoint}/memberSave`;

    // 如果数据已经是 BMP 格式，跳过转换
    let leftIrisBmp: string;
    let rightIrisBmp: string;

    if (skipBmpConversion) {
      console.log(`[DeviceSync] 数据已是 BMP 格式，跳过转换`);
      leftIrisBmp = payload.irisLeftImage || '';
      rightIrisBmp = payload.irisRightImage || '';
    } else {
      console.log(`[DeviceSync] 转换虹膜图片为 BMP 格式...`);
      leftIrisBmp = payload.irisLeftImage
        ? await convertToBmpBase64(payload.irisLeftImage)
        : '';
      rightIrisBmp = payload.irisRightImage
        ? await convertToBmpBase64(payload.irisRightImage)
        : '';
    }

    const irisLeftPreview = leftIrisBmp?.substring(0, 10) + '...' || 'null';
    const irisRightPreview = rightIrisBmp?.substring(0, 10) + '...' || 'null';

    const requestData = {
      staffNum: payload.staffNum,
      cardNum: '',
      cardType: 0,
      faceImage: payload.faceImage || '',
      leftIrisImage: leftIrisBmp,
      rightIrisImage: rightIrisBmp,
      name: payload.memberName,
      openDoor: payload.openDoor !== false ? 1 : 0,
      purview: payload.purview || 30,
      purviewEndTime: 0.0,
      purviewStartTime: 0.0,
      singleIrisAllowed: payload.singleIrisAllowed ?? 1,
    };

    console.log(`[DeviceSync] 下发虹膜特征(无锁定)到 ${endpoint}`);
    console.log(`[DeviceSync] staffNum: ${payload.staffNum}, memberName: ${payload.memberName}`);
    console.log(`[DeviceSync] irisLeft (BMP): ${irisLeftPreview} (${leftIrisBmp?.length || 0}字符)`);
    console.log(`[DeviceSync] irisRight (BMP): ${irisRightPreview} (${rightIrisBmp?.length || 0}字符)`);
    console.log(`[DeviceSync] faceImage: ${payload.faceImage?.substring(0, 10)}... (${payload.faceImage?.length || 0}字符)`);

    // 直接上传人员（不锁定）
    await irisCommandGuard();
    const responseData: any = await irisRequest(endpoint, '/memberSave', requestData, IRIS_MEMBER_SAVE_TIMEOUT);
    console.log(`[DeviceSync] 响应：${JSON.stringify(responseData)}`);

    if (responseData.errorCode === 0 || responseData.errorCode === '0') {
      return { success: true, response: JSON.stringify(responseData) };
    } else {
      return {
        success: false,
        error: `虹膜设备返回错误：errorCode=${responseData.errorCode}, errorInfo=${responseData.errorInfo || ''}`
      };
    }
  } catch (error: any) {
    console.error(`[DeviceSync] 虹膜设备下发(无锁定)失败：${error.message}`);
    return { success: false, error: translateErrorMessage(error.message) };
  }
}

/**
 * 同步到虹膜设备（memberSave 接口）
 * 流程：锁定设备 → 等待200ms → 上传人员 → 保持锁定（不解锁）
 * @param skipDebugLog 是否跳过调试日志（重试时跳过，避免文件过多）
 *
 * 冷却机制：
 * - 冷却期间：sleep 10 秒（不操作设备）后返回失败，占用住 IAMS
 * - 锁定失败：立即返回失败
 */
export async function syncToIrisDevice(
  endpoint: string,
  payload: {
    staffNum: string;
    staffNumDec: string;
    memberName: string;
    irisLeftImage: string;
    irisRightImage: string;
    faceImage?: string;
    openDoor?: boolean;
    purview?: number;
  },
  skipDebugLog?: boolean
): Promise<{ success: boolean; response?: string; error?: string; code?: number }> {
  const beijingTime = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  // === 检查冷却状态 ===
  if (irisDeviceState === 'cooling_down') {
    console.log(`[${beijingTime()}] [设备] 虹膜设备冷却中，等待 10 秒后返回失败（不操作设备）`);
    await new Promise(resolve => setTimeout(resolve, IRIS_COOLDOWN_MS));
    return { success: false, error: '虹膜设备冷却中，请稍后重试' };
  }

  // === 检查 personId 去重锁（防 IAMS 连发） ===
  const personKey = payload.staffNum;
  if (irisPersonLock.has(personKey)) {
    console.log(`[${beijingTime()}] [设备] 虹膜人员锁: ${personKey} 正在下发中，跳过重复请求`);
    return { success: true, response: '重复请求，已跳过', code: 200 };
  }
  irisPersonLock.set(personKey, setTimeout(() => {
    irisPersonLock.delete(personKey);
  }, 10000));

  // 设置为忙碌状态
  irisDeviceState = 'busy';

  // 清除 personId 锁的辅助函数
  const clearPersonLock = () => { irisPersonLock.delete(personKey); };

  try {
    // 转换虹膜图片为 BMP 格式
    const leftIrisBmp = payload.irisLeftImage ? await convertToBmpBase64(payload.irisLeftImage) : '';
    const rightIrisBmp = payload.irisRightImage ? await convertToBmpBase64(payload.irisRightImage) : '';

    if (!leftIrisBmp && !rightIrisBmp) {
      irisDeviceState = 'idle';
      clearPersonLock();
      return { success: false, error: '虹膜数据转换失败' };
    }

    const requestData = {
      staffNum: payload.staffNum,
      cardNum: '',
      cardType: 0,
      faceImage: payload.faceImage || '',
      leftIrisImage: leftIrisBmp,
      rightIrisImage: rightIrisBmp,
      name: payload.memberName,
      openDoor: payload.openDoor !== false ? 1 : 0,
      purview: payload.purview || 30,
      purviewEndTime: 0.0,
      purviewStartTime: 0.0,
      singleIrisAllowed: 1,
    };

    // 保存最后一次虹膜下发 payload 到文件，方便 Postman 测试
    try {
      const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
      if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
      const savePath = join(dataDir, 'iris_last_request.json');
      writeFileSync(savePath, JSON.stringify(requestData, null, 2), 'utf-8');
      console.log(`[${beijingTime()}] [设备] 虹膜 payload 已保存到 ${savePath} (leftIrisImage base64 len=${leftIrisBmp.length}, rightIrisImage base64 len=${rightIrisBmp.length})`);
    } catch (e) {
      console.log(`[${beijingTime()}] [设备] 保存虹膜 payload 失败: ${e}`);
    }

    console.log(`[${beijingTime()}] [设备] 虹膜下发 ${payload.staffNum} ${payload.memberName}`);

    // 重试机制：memberSave 可能崩溃设备，等待重启后重试
    let maxRetries = 2;
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (attempt > 1) {
        console.log(`[${beijingTime()}] [设备] === 第${attempt}次重试：等待设备重启（15秒） ===`);
        await new Promise(resolve => setTimeout(resolve, 15000));
      }

      // 1. 锁定设备（errorCode=97 已锁定也算成功）
      console.log(`[${beijingTime()}] [设备] 步骤1: 锁定设备...`);
      const lockResult = await setIrisDeviceSaveState(endpoint, 1);
      if (!lockResult.success) {
        console.log(`[${beijingTime()}] [设备] ❌ 锁定失败，立即返回失败`);
        irisDeviceState = 'idle';
        clearPersonLock();
        return { success: false, error: lockResult.error || '锁定设备失败' };
      }
      console.log(`[${beijingTime()}] [设备] 锁定成功`);

      // 2. 等待1秒后上传（给设备足够时间消化锁定指令）
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 3. 上传人员
      console.log(`[${beijingTime()}] [设备] 步骤2: 上传人员...`);
      await irisCommandGuard();

      let responseData: any;
      try {
        responseData = await irisRequest(endpoint, '/memberSave', requestData, IRIS_MEMBER_SAVE_TIMEOUT);
        console.log(`[${beijingTime()}] [设备] 上传完成: errorCode=${responseData.errorCode}`);

        // errorCode=97 = 设备未初始化完成，重试
        if (responseData.errorCode === 97 || responseData.errorCode === '97') {
          console.log(`[${beijingTime()}] [设备] ⚠️ errorCode=97（设备初始化中），重试`);
          lastError = 'errorCode=97 设备初始化中';
          continue;
        }
      } catch (e) {
        // socket hang up = 设备崩溃，等待重启后重试
        lastError = e instanceof Error ? e.message : String(e);
        console.log(`[${beijingTime()}] [设备] ⚠️ 上传异常: ${lastError}（设备可能已崩溃，等待重启）`);
        continue; // 跳到重试
      }

      // 设备保持锁定状态，不解锁
      irisDeviceState = 'idle';
      clearPersonLock();

      if (responseData.errorCode === 0 || responseData.errorCode === '0') {
        console.log(`[${beijingTime()}] [设备] ✅ 虹膜添加成功`);

        // 上传成功后重新锁定
        console.log(`[${beijingTime()}] [设备] 步骤3: 重新锁定设备...`);
        try {
          await setIrisDeviceSaveState(endpoint, 1);
        } catch (e) {
          console.log(`[${beijingTime()}] [设备] ⚠️ 重新锁定异常: ${e instanceof Error ? e.message : String(e)}`);
        }

        return { success: true, response: JSON.stringify(responseData) };
      } else {
        const errorCodeNum = Number(responseData.errorCode);

        // 上传失败也要重新锁定
        console.log(`[${beijingTime()}] [设备] 重新锁定设备...`);
        try {
          await setIrisDeviceSaveState(endpoint, 1);
        } catch (e) {
          console.log(`[${beijingTime()}] [设备] 重新锁定异常: ${e instanceof Error ? e.message : String(e)}`);
        }

        // errorCode 9（人员已存在）或 10（人员不在列表中）返回 401，不保存数据库
        if (errorCodeNum === 9 ) {
          console.log(`[${beijingTime()}] [设备] ❌ 虹膜添加失败: errorCode=${responseData.errorCode}，返回401给IAMS，不保存数据库`);
          return { success: false, error: '已经存在相同人脸', code: 401 };
        }

        if ( errorCodeNum === 10) {
          console.log(`[${beijingTime()}] [设备] ❌ 虹膜添加失败: errorCode=${responseData.errorCode}，返回401给IAMS，不保存数据库`);
          return { success: false, error: '已经存在相同虹膜特征', code: 401 };
        }
        // errorCode 12 = 生成左眼虹膜错误, 13 = 生成右眼虹膜错误
        if (errorCodeNum === 12) {
          console.log(`[${beijingTime()}] [设备] ❌ 虹膜添加失败: errorCode=12 生成左眼虹膜错误，返回401给IAMS`);
          return { success: false, error: '12：生成左眼虹膜错误', code: 401 };
        }
        if (errorCodeNum === 13) {
          console.log(`[${beijingTime()}] [设备] ❌ 虹膜添加失败: errorCode=13 生成右眼虹膜错误，返回401给IAMS`);
          return { success: false, error: '13：生成右眼虹膜错误', code: 401 };
        }

        // 其他 errorCode，不重试
        console.log(`[${beijingTime()}] [设备] ❌ 虹膜添加失败: errorCode=${responseData.errorCode}`);
        return { success: false, error: `errorCode=${responseData.errorCode}` };
      }
    }

    // 重试耗尽
    console.log(`[${beijingTime()}] [设备] ❌ 虹膜下发重试${maxRetries - 1}次后仍失败: ${lastError}`);
    irisDeviceState = 'idle';
    clearPersonLock();
    return { success: false, error: `设备崩溃，重试${maxRetries - 1}次后失败: ${lastError}` };
  } catch (error: any) {
    console.error(`[${beijingTime()}] [设备] 虹膜下发异常: ${error.message}`);
    irisDeviceState = 'idle';
    irisPersonLock.delete(personKey);
    return { success: false, error: translateErrorMessage(error.message) };
  }
}

/**
 * 从虹膜设备删除（memberDelete 接口）
 * 注意：使用 staffNum（工号）来删除，不是 staffNumDec
 */
export async function deleteFromIrisDevice(
  endpoint: string,
  staffNum: string
): Promise<{ success: boolean; response?: string; error?: string }> {
  const beijingTime = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  try {
    // ⚠️ 重要：参数名是 staffNum，不是 staffNumDec
    const requestData = {
      staffNum,
    };

    console.log(`[${beijingTime()}] [DeviceSync] 从虹膜设备删除用户：${staffNum}`);
    console.log(`[${beijingTime()}] [DeviceSync] Request: ${JSON.stringify(requestData)}`);

    await irisCommandGuard();
    const responseData: any = await irisRequest(endpoint, '/memberDelete', requestData, IRIS_DEVICE_CONFIG.timeout);
    console.log(`[${beijingTime()}] [DeviceSync] 响应：${JSON.stringify(responseData)}`);

    // errorCode=0 成功，errorCode=16 人员不存在也算成功（目标状态已达成）
    if (responseData.errorCode === 0 || responseData.errorCode === '0') {
      return { success: true, response: JSON.stringify(responseData) };
    } else if (responseData.errorCode === 16 || responseData.errorCode === '16') {
      console.log(`[${beijingTime()}] [DeviceSync] 人员不存在，视为删除成功`);
      return { success: true, response: JSON.stringify(responseData) };
    } else {
      return {
        success: false,
        error: `虹膜设备返回错误：errorCode=${responseData.errorCode}, errorInfo=${responseData.errorInfo || '未知'}`
      };
    }
  } catch (error: any) {
    console.error(`[${beijingTime()}] [DeviceSync] 虹膜设备删除失败：${error.message}`);
    return { success: false, error: translateErrorMessage(error.message) };
  }
}

/**
 * 获取虹膜设备上的所有人员
 */
export async function getIrisDeviceMembers(
  endpoint: string
): Promise<{ success: boolean; members?: { staffNum: string; name: string }[]; error?: string }> {
  try {
    const url = `${endpoint}/members`;

    const requestData = {
      count: 100,  // 一次获取100个
      key: '',
      lastStaffNumDec: '',
      needImages: 0,  // 不需要图片
    };

    console.log(`[DeviceSync] 获取虹膜设备人员列表`);

    await irisCommandGuard();
    const responseData: any = await irisRequest(endpoint, '/members', requestData, IRIS_DEVICE_CONFIG.timeout);
    console.log(`[DeviceSync] 响应：${JSON.stringify(responseData).substring(0, 200)}...`);

    if (responseData.errorCode === 0 || responseData.errorCode === '0') {
      const members: { staffNum: string; name: string }[] = [];

      // 解析返回的 body 数组
      if (responseData.body && Array.isArray(responseData.body)) {
        for (const member of responseData.body) {
          members.push({
            staffNum: member.staffNum || '',
            name: member.name || '',
          });
        }
      }

      return { success: true, members };
    } else {
      return {
        success: false,
        error: `获取人员列表失败：errorCode=${responseData.errorCode}`
      };
    }
  } catch (error: any) {
    console.error(`[DeviceSync] 获取虹膜设备人员失败：${error.message}`);
    return { success: false, error: translateErrorMessage(error.message) };
  }
}

/**
 * 清空虹膜设备上的所有人员
 */
export async function clearIrisDevice(
  endpoint: string
): Promise<{ success: boolean; deleted: number; failed: number; errors: string[] }> {
  console.log(`${bjt()} [虹膜] 开始清空...`);

  // 获取所有人员
  const membersResult = await getIrisDeviceMembers(endpoint);

  if (!membersResult.success) {
    return {
      success: false,
      deleted: 0,
      failed: 0,
      errors: [membersResult.error || '获取人员列表失败'],
    };
  }

  const members = membersResult.members || [];
  console.log(`[DeviceSync] 发现 ${members.length} 个人员`);

  if (members.length === 0) {
    return { success: true, deleted: 0, failed: 0, errors: [] };
  }

  let deleted = 0;
  let failed = 0;
  const errors: string[] = [];

  // 逐个删除
  for (const member of members) {
    if (!member.staffNum) continue;

    const result = await deleteFromIrisDevice(endpoint, member.staffNum);

    if (result.success) {
      deleted++;
      console.log(`[DeviceSync] 已删除: ${member.staffNum} (${member.name})`);
    } else {
      failed++;
      errors.push(`${member.staffNum}: ${result.error}`);
      console.log(`[DeviceSync] 删除失败: ${member.staffNum} - ${result.error}`);
    }

    // 每次删除间隔 100ms，避免设备压力过大
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`[DeviceSync] 清空完成: 删除 ${deleted}, 失败 ${failed}`);
  return { success: failed === 0, deleted, failed, errors };
}

/**
 * 清空掌纹设备上的所有人员
 * 使用 107 指令清空设备
 */
export async function clearPalmDevice(
  endpoint: string
): Promise<{ success: boolean; deleted: number; failed: number; errors: string[] }> {
  console.log(`${bjt()} [掌纹] 开始清空...`);

  // 解析 endpoint
  const url = new URL(endpoint);
  const host = url.hostname;
  const port = parseInt(url.port) || 80;

  // ⚠️ 使用 107 指令清空设备（删除全部用户）
  const clearSendData = '{"request":"107"}';
  const clearPath = `/api?sendData=${clearSendData}`;

  console.log(`${bjt()} [掌纹] 发送107清空: POST ${host}:${port}${clearPath}`);

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: host,
        port: port,
        path: clearPath,
        method: 'POST',  // ⚠️ 掌纹设备必须用 POST！
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', async () => {
          console.log(`${bjt()} [掌纹] 107指令原始响应: ${data}`);
          try {
            const result = JSON.parse(data);

            // 检查 107 指令是否成功
            if (result.response === '107' || result.code === '200' || result.code === 200 || result.code === 0 || result.success) {
              console.log(`${bjt()} [掌纹] 107清空成功`);
              resolve({ success: true, deleted: result.deleted || 0, failed: 0, errors: [] });
              return;
            }

            // 107 指令失败，回退到逐个删除
            console.log(`${bjt()} [掌纹] 107响应异常，回退逐个删除: ${JSON.stringify(result)}`);
            const fallbackResult = await clearPalmDeviceOneByOne(endpoint);
            resolve(fallbackResult);

          } catch (e: any) {
            console.log(`${bjt()} [掌纹] 107解析失败，回退逐个删除: ${e.message}`);
            const fallbackResult = await clearPalmDeviceOneByOne(endpoint);
            resolve(fallbackResult);
          }
        });
      }
    );

    req.on('error', async (e) => {
      console.log(`${bjt()} [掌纹] 107请求失败，回退逐个删除: ${e.message}`);
      const fallbackResult = await clearPalmDeviceOneByOne(endpoint);
      resolve(fallbackResult);
    });

    req.on('timeout', async () => {
      req.destroy();
      console.log(`${bjt()} [掌纹] 107超时，回退逐个删除`);
      const fallbackResult = await clearPalmDeviceOneByOne(endpoint);
      resolve(fallbackResult);
    });

    req.end();
  });
}

/**
 * 逐个删除掌纹设备上的用户（回退方案）
 */
async function clearPalmDeviceOneByOne(
  endpoint: string
): Promise<{ success: boolean; deleted: number; failed: number; errors: string[] }> {
  console.log(`${bjt()} [掌纹] 逐个删除用户...`);

  // 解析 endpoint
  const url = new URL(endpoint);
  const host = url.hostname;
  const port = parseInt(url.port) || 80;

  // 获取所有用户列表
  const sendData = '{"request":"105"}';
  const queryPath = `/api?sendData=${sendData}`;

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: host,
        port: port,
        path: queryPath,
        method: 'POST',
        agent: false,
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', async () => {
          try {
            const result = JSON.parse(data);
            const users = result.userData || [];
            console.log(`[DeviceSync] 发现 ${users.length} 个掌纹用户`);

            if (users.length === 0) {
              resolve({ success: true, deleted: 0, failed: 0, errors: [] });
              return;
            }

            let deleted = 0;
            let failed = 0;
            const errors: string[] = [];

            // 逐个删除
            for (const user of users) {
              if (!user.userId) continue;

              const delResult = await deleteFromPalmDeviceMQTT(endpoint, user.userId);

              if (delResult.success) {
                deleted++;
                console.log(`[DeviceSync] 已删除掌纹用户: ${user.userId}`);
              } else {
                failed++;
                errors.push(`${user.userId}: ${delResult.error}`);
                console.log(`[DeviceSync] 删除掌纹用户失败: ${user.userId} - ${delResult.error}`);
              }

              // 每次删除间隔 100ms
              await new Promise(r => setTimeout(r, 100));
            }

            console.log(`[DeviceSync] 掌纹设备清空完成: 删除 ${deleted}, 失败 ${failed}`);
            resolve({ success: failed === 0, deleted, failed, errors });
          } catch (e: any) {
            console.error(`[DeviceSync] 解析掌纹用户列表失败:`, e.message);
            resolve({ success: false, deleted: 0, failed: 0, errors: [e.message] });
          }
        });
      }
    );

    req.on('error', (e) => {
      console.error(`[DeviceSync] 获取掌纹用户列表失败:`, e.message);
      resolve({ success: false, deleted: 0, failed: 0, errors: [e.message] });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, deleted: 0, failed: 0, errors: ['获取用户列表超时'] });
    });

    req.end();
  });
}

/**
 * 检查设备状态
 */
export async function checkDeviceStatus(
  type: 'palm' | 'iris',
  endpoint?: string
): Promise<{
  online: boolean;
  type: 'palm' | 'iris';
  endpoint: string;
  message?: string;
  error?: string;
}> {
  const deviceEndpoint = endpoint || (
    type === 'palm' 
      ? PALM_DEVICE_CONFIG.endpoint 
      : IRIS_DEVICE_CONFIG.endpoint
  );
  
  try {
    if (type === 'palm') {
      // 掌纹设备：使用 105 接口测试在线（sendData 不编码）
      const palmUrl = `${deviceEndpoint}/api?sendData=${encodeURIComponent('{"request":"105"}')}`;
      const response = await fetch(palmUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(3000),
      });

      if (response.ok) {
        return { online: true, type, endpoint: deviceEndpoint, message: '设备在线' };
      } else {
        return { online: false, type, endpoint: deviceEndpoint, message: `设备响应异常：${response.status}` };
      }
    } else {
      // 虹膜设备：使用 members 接口测试（httpRequest 避免 fetch keep-alive 问题）
      const responseData: any = await irisRequest(deviceEndpoint, '/members', { count: 1, key: '', lastStaffNumDec: '', needImages: 0 }, 3000);
      if (responseData.errorCode === 0 || responseData.errorCode === '0') {
        return { online: true, type, endpoint: deviceEndpoint, message: '设备在线' };
      } else {
        return { online: false, type, endpoint: deviceEndpoint, message: `设备响应异常：errorCode=${responseData.errorCode}` };
      }
    }
  } catch (error: any) {
    // ECONNRESET 说明设备端主动断开连接，设备仍在工作，视为在线
    if (error.message?.includes('ECONNRESET')) {
      return {
        online: true,
        type,
        endpoint: deviceEndpoint,
        message: '设备在线（连接重置）',
      };
    }
    return {
      online: false,
      type,
      endpoint: deviceEndpoint,
      error: error.message,
    };
  }
}

/**
 * 处理同步队列
 * 从 sync_queue 表读取待处理的同步任务并执行
 * ⚠️ 关键：成功失败都记录，不再重试
 */
export async function processSyncQueue(): Promise<{
  processed: number;
  success: number;
  failed: number;
}> {
  let processed = 0;
  let success = 0;
  let failed = 0;

  // 获取待处理的队列项（只有 pending 状态）
  const items = await getPendingQueueItems(10);

  if (items.length === 0) {
    return { processed, success, failed };
  }

  // 获取设备配置
  const devices = await getDeviceConfigs();
  const deviceMap = new Map(devices.map(d => [d.device_id, d]));

  for (const item of items) {
    const startTime = Date.now();
    processed++;

    console.log(`[SyncQueue] 处理: ${item.action} -> ${item.device_id}`);

    const device = deviceMap.get(item.device_id);
    if (!device) {
      console.error(`${bjt()} [设备] 设备不存在: ${item.device_id}`);
      await updateQueueStatus(item.id, 'failed', '设备不存在');
      await addSyncLog({
        queue_id: item.id,
        device_id: item.device_id,
        action: item.action,
        status: 'failed',
        error_message: '设备不存在',
        duration_ms: 0,
      });
      failed++;
      continue;
    }

    // 不再预先检查设备状态，直接执行操作
    // 设备离线时操作本身会失败，自然会记录

    // 更新状态为处理中
    await updateQueueStatus(item.id, 'processing');

    let result: { success: boolean; response?: string; error?: string } = {
      success: false,
      error: '未知操作',
    };

    try {
      const payload = JSON.parse(item.payload);

      if (item.action === 'sync_palm') {
        result = await syncToPalmDeviceMQTT(device.endpoint, payload);
      } else if (item.action === 'sync_iris') {
        result = await syncToIrisDevice(device.endpoint, payload, item.retry_count > 0);
      } else if (item.action === 'delete_palm') {
        result = await deleteFromPalmDeviceMQTT(device.endpoint, payload.userId);
      } else if (item.action === 'delete_iris') {
        result = await deleteFromIrisDevice(device.endpoint, payload.staffNum);

      // ==================== MQTT 下发的操作 ====================
      } else if (item.action === 'passport-add') {
        result = await handlePassportAdd(device, payload);
      } else if (item.action === 'passport-update') {
        result = await handlePassportUpdate(device, payload);
      } else if (item.action === 'passport-delete' || item.action === 'passport-del') {
        result = await handlePassportDelete(device, payload);

      } else {
        result = { success: false, error: `未知操作类型: ${item.action}` };
      }
    } catch (error: any) {
      result = { success: false, error: error.message };
    }

    const durationMs = Date.now() - startTime;

    if (result.success) {
      await updateQueueStatus(item.id, 'success');
      success++;
      console.log(`${bjt()} [设备] ✅ ${item.action} 成功, 耗时${durationMs}ms`);

      await addSyncLog({
        queue_id: item.id,
        device_id: item.device_id,
        device_type: device.device_type,
        action: item.action,
        status: 'success',
        response: result.response,
        duration_ms: durationMs,
      });
    } else {
      await updateQueueStatus(item.id, 'failed', result.error);
      failed++;
      console.log(`${bjt()} [设备] ❌ ${item.action} 失败: ${result.error}`);

      await addSyncLog({
        queue_id: item.id,
        device_id: item.device_id,
        device_type: device.device_type,
        action: item.action,
        status: 'failed',
        error_message: result.error,
        duration_ms: durationMs,
      });
    }

    // 虹膜设备操作后等待200ms
    if (item.action.includes('iris') || item.action.includes('passport')) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log(`${bjt()} [设备] 队列处理完成: ${processed}项, 成功${success}, 失败${failed}`);
  return { processed, success, failed };
}

/**
 * 手动同步指定队列项
 */
export async function manualSyncItem(queueId: number): Promise<{
  success: boolean;
  message: string;
}> {
  console.log(`[SyncQueue] 手动同步队列项 #${queueId}`);

  // 获取设备配置
  const devices = await getDeviceConfigs();
  const deviceMap = new Map(devices.map(d => [d.device_id, d]));

  // 直接获取指定队列项（需要查询数据库）
  const { getDatabase } = await import('./database');
  const db = getDatabase();

  const result = await db.execute({
    sql: 'SELECT * FROM sync_queue WHERE id = ?',
    args: [queueId],
  });

  if (result.rows.length === 0) {
    return { success: false, message: '队列项不存在' };
  }

  const item = {
    id: result.rows[0].id as number,
    message_id: result.rows[0].message_id as string,
    device_id: result.rows[0].device_id as string,
    action: result.rows[0].action as string,
    payload: result.rows[0].payload as string,
    status: result.rows[0].status as SyncStatus,
    retry_count: result.rows[0].retry_count as number,
    max_retries: result.rows[0].max_retries as number,
  };

  const startTime = Date.now();

  // 更新状态为处理中
  await updateQueueStatus(item.id, 'processing');

  const device = deviceMap.get(item.device_id);
  if (!device) {
    await updateQueueStatus(item.id, 'failed', '设备不存在');
    return { success: false, message: '设备不存在' };
  }

  let syncResult: { success: boolean; response?: string; error?: string } = {
    success: false,
    error: '未知操作',
  };

  try {
    const payload = JSON.parse(item.payload);

    if (item.action === 'sync_palm') {
      syncResult = await syncToPalmDeviceMQTT(device.endpoint, payload);
    } else if (item.action === 'sync_iris') {
      // 重试时跳过调试日志
      syncResult = await syncToIrisDevice(device.endpoint, payload, item.retry_count > 0);
    } else if (item.action === 'delete_palm') {
      syncResult = await deleteFromPalmDeviceMQTT(device.endpoint, payload.userId);
    } else if (item.action === 'delete_iris') {
      syncResult = await deleteFromIrisDevice(device.endpoint, payload.staffNumDec);
    }
  } catch (error: any) {
    syncResult = { success: false, error: error.message };
  }

  const durationMs = Date.now() - startTime;

  if (syncResult.success) {
    await updateQueueStatus(item.id, 'success');
    await addSyncLog({
      queue_id: item.id,
      device_id: item.device_id,
      device_type: device.device_type,
      action: item.action,
      status: 'success',
      response: syncResult.response,
      duration_ms: durationMs,
    });
    return { success: true, message: '同步成功' };
  } else {
    await updateQueueStatus(item.id, 'failed', syncResult.error);
    await addSyncLog({
      queue_id: item.id,
      device_id: item.device_id,
      device_type: device.device_type,
      action: item.action,
      status: 'failed',
      error_message: syncResult.error,
      duration_ms: durationMs,
    });
    return { success: false, message: syncResult.error || '同步失败' };
  }
}

/**
 * 重试所有失败的队列项
 * 现在失败后状态变成 retrying，所以直接调用 processSyncQueue 处理
 */
export async function retryAllFailed(): Promise<{
  total: number;
  success: number;
  failed: number;
}> {
  console.log('[SyncQueue] 触发手动同步...');

  // 直接调用 processSyncQueue 处理 pending 和 retrying 状态的项
  const result = await processSyncQueue();

  return {
    total: result.processed,
    success: result.success,
    failed: result.failed,
  };
}

/**
 * 处理 MQTT 凭证新增
 * ⚠️ 先同步设备成功，再保存数据库
 */
export async function handlePassportAdd(
  device: DeviceConfig,
  payload: {
    personId: string;
    personName: string;
    credentialId: number;
    credentialType: number;  // 7=虹膜, 8=掌纹
    content?: string;
    irisLeftImage?: string;
    irisRightImage?: string;
    palmFeature?: string;
    authTypeList?: number[];
    authModel?: number;      // 1=单凭证, 820=组合认证
    action?: string;
    startTime?: number;      // IAMS 凭证有效期开始
    endTime?: number;        // IAMS 凭证有效期结束
  }
): Promise<{ success: boolean; response?: string; error?: string; code?: number; skipResponse?: boolean }> {
  const isIris = payload.credentialType === 7;
  const isPalm = payload.credentialType === 8;

  console.log(`[MQTT-Handler] 处理凭证新增: ${isIris ? '虹膜' : isPalm ? '掌纹' : '其他'}, personId=${payload.personId}`);

  // ⚠️ 检查凭证是否已存在，根据入库时间决定响应策略
  const { getCredentialById } = await import('./db-credentials');
  const existingCredential = await getCredentialById(payload.credentialId);
  if (existingCredential) {
    const createdAt = new Date(existingCredential.created_at).getTime();
    const elapsed = Date.now() - createdAt;
    const fiveMin = 5 * 60 * 1000;
    const oneHour = 60 * 60 * 1000;

    if (elapsed < fiveMin) {
      // 5 分钟内：IAMS 快速重试，跳过回复
      console.log(`[MQTT-Handler] 凭证已存在(${elapsed}ms < 5min)，跳过回复`);
      return { success: true, response: '凭证已存在，跳过回复', skipResponse: true };
    } else if (elapsed < oneHour) {
      // 5 分钟~1 小时：回复 405 凭证已存在
      console.log(`[MQTT-Handler] 凭证已存在(${elapsed}ms，5min~1h)，返回 405`);
      return { success: true, response: '凭证已经存在', code: 405 };
    } else {
      // 超过 1 小时：正常返回成功
      console.log(`[MQTT-Handler] 凭证已存在(${elapsed}ms > 1h)，返回 200`);
      return { success: true, response: '成功', code: 200 };
    }
  }

  // 从 content 解析虹膜数据（虹膜数据必须在 content 中）
  let irisLeftImage = '';
  let irisRightImage = '';
  if (isIris && payload.content) {
    const irisData = parseIrisContent(payload.content);
    irisLeftImage = irisData.leftIris;
    irisRightImage = irisData.rightIris;
    console.log(`[MQTT-Handler] 虹膜数据从content解析: 左眼${irisLeftImage.length}字符, 右眼${irisRightImage.length}字符`);
  } else if (isIris) {
    console.log(`[MQTT-Handler] ⚠️ 虹膜凭证没有content数据!`);
  }

  // 掌纹数据：优先使用 palmFeature，其次使用 content
  const palmFeature = payload.palmFeature || (isPalm ? payload.content : undefined);

  if (isIris) {
    // 虹膜新增：先同步设备（正常流程：锁定→等待8秒→上传→解锁）
    console.log('[MQTT-Handler] 虹膜新增：先同步设备');

    const memberName = payload.personName || payload.personId || '';  // 默认用 personId

    const result = await syncToIrisDevice(
      device.endpoint,
      {
        staffNum: payload.personId,
        staffNumDec: payload.personId,  // 用户编码
        memberName: memberName,
        irisLeftImage: irisLeftImage,
        irisRightImage: irisRightImage,
        faceImage: '',  // 空字符串（设备已设置不检测人脸）
      },
      true  // skipDebugLog
    );

    // ⚠️ 设备成功才保存数据库 + 加密存储 + 从设备删除
    if (result.success) {
      console.log('[MQTT-Handler] 设备添加成功，保存加密文件 + 数据库 + 从设备删除');

      // 1. 保存加密文件（memberSave 的完整 payload）
      const { saveIrisData } = await import('./iris-data');
      const irisPayload = {
        staffNum: payload.personId,
        staffNumDec: payload.personId,
        memberName: memberName,
        irisLeftImage: irisLeftImage,
        irisRightImage: irisRightImage,
        faceImage: '',
      };
      const dataPath = saveIrisData(payload.credentialId, irisPayload);

      // 2. 保存数据库（存储 iris_data_path，不再存大字段）
      const { upsertCredential } = await import('./db-credentials');
      await upsertCredential({
        person_id: payload.personId,
        person_name: memberName,
        credential_id: payload.credentialId,
        type: payload.credentialType as import('./db-credentials').CredentialType,
        auth_type_list: payload.authTypeList?.join(',') || String(payload.credentialType),
        auth_model: payload.authModel,
        iris_data_path: dataPath,
        start_time: payload.startTime ?? null,
        end_time: payload.endTime ?? null,
      });

      // 3. 从虹膜设备删除刚才上传的数据（确保设备不保留人员）
      console.log('[MQTT-Handler] 从虹膜设备删除刚上传的数据');
      await deleteFromIrisDevice(device.endpoint, payload.personId);
    } else {
      console.log('[MQTT-Handler] 设备添加失败，不保存数据库');
    }

    return result;
  } else if (isPalm) {
    // 掌纹新增：先同步设备
    console.log('[MQTT-Handler] 掌纹新增：先同步设备');

    // 从 content 解析 userId 和 featureData（格式: "userId:featureData"）
    const parsed = parsePalmContent(payload.content || '');
    const userId = parsed.userId || payload.personId;
    const featureData = parsed.featureData || '';

    console.log(`[MQTT-Handler] 掌纹content解析: userId=${userId}, featureData长度=${featureData.length}`);

    const result = await syncToPalmDeviceMQTT(device.endpoint, {
      userId,
      featureData,
    });

    // ⚠️ 设备成功才保存数据库
    if (result.success) {
      console.log('[MQTT-Handler] 设备添加成功，保存数据库');
      console.log(`[MQTT-Handler] 存储userId到custom_id: ${userId}`);
      const { upsertCredential } = await import('./db-credentials');
      await upsertCredential({
        person_id: payload.personId,
        person_name: payload.personName || payload.personId || '',
        credential_id: payload.credentialId,
        type: payload.credentialType as import('./db-credentials').CredentialType,
        content: payload.content,  // 完整存储 "userId:featureData"
        auth_type_list: payload.authTypeList?.join(','),
        custom_id: userId,  // 存储掌纹设备上的userId
        auth_model: payload.authModel,
        start_time: payload.startTime ?? null,
        end_time: payload.endTime ?? null,
      });
    } else {
      console.log('[MQTT-Handler] 设备添加失败，不保存数据库');
    }

    return result;
  } else {
    // 其他类型直接存数据库
    const { upsertCredential } = await import('./db-credentials');
    await upsertCredential({
      person_id: payload.personId,
      person_name: payload.personName,
      credential_id: payload.credentialId,
      type: payload.credentialType as import('./db-credentials').CredentialType,
      content: payload.content,
      auth_type_list: payload.authTypeList?.join(','),
      auth_model: payload.authModel,
      start_time: payload.startTime ?? null,
      end_time: payload.endTime ?? null,
    });
    return { success: true, response: '已保存到数据库' };
  }
}

/**
 * 处理 MQTT 凭证更新
 * ⚠️ 只更新数据库属性，不操作设备！
 * 根据 IAMS 协议，passport-update 不包含 content 字段
 */
export async function handlePassportUpdate(
  device: DeviceConfig,
  payload: {
    personId: string;
    personName?: string;
    credentialId: number;
    credentialType: number;
    showInfo?: string[];
    tags?: number[];
    enable?: number;
    authModel?: number;
    authTypeList?: number[];
    boxList?: string;
    startTime?: number;
    endTime?: number;
  }
): Promise<{ success: boolean; response?: string; error?: string }> {
  console.log(`[MQTT-Handler] 处理凭证更新（只更新数据库属性）: credentialId=${payload.credentialId}`);

  // 只更新数据库属性
  const { getCredentialById, updateCredentialAttributes } = await import('./db-credentials');

  const credential = await getCredentialById(payload.credentialId);
  if (!credential) {
    console.log(`[MQTT-Handler] 凭证不存在: credentialId=${payload.credentialId}`);
    return { success: false, error: '凭证不存在' };
  }

  // 更新属性字段
  await updateCredentialAttributes(payload.credentialId, {
    show_info: payload.showInfo?.join('|'),
    tags: payload.tags?.join(','),
    enable: payload.enable,
    auth_model: payload.authModel,
    auth_type_list: payload.authTypeList?.join(',') || undefined,
    box_list: payload.boxList,
    start_time: payload.startTime ?? undefined,
    end_time: payload.endTime ?? undefined,
  });

  console.log(`[MQTT-Handler] ✅ 凭证属性更新成功`);
  return { success: true, response: '属性更新成功' };
}

/**
 * 处理 MQTT 凭证删除
 * ⚠️ 先删设备成功 → 再删数据库
 * ⚠️ passport-del 消息没有 personId，需要用 credentialId 查数据库
 */
export async function handlePassportDelete(
  device: DeviceConfig,
  payload: {
    credentialId: number;
    personId?: string;  // 可能为空
  }
): Promise<{ success: boolean; response?: string; error?: string; code?: number }> {
  const beijingTime = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  console.log(`[${beijingTime()}] [MQTT-Handler] 处理凭证删除: credentialId=${payload.credentialId}, personId=${payload.personId || '(空)'}`);

  const { getCredentialByPersonId, getCredentialById, deleteCredential } = await import('./db-credentials');

  let credential = null;

  // ⚠️ 优先用 personId 查，没有则用 credentialId 查
  if (payload.personId) {
    credential = await getCredentialByPersonId(payload.personId);
  } else {
    credential = await getCredentialById(payload.credentialId);
  }

  // ⚠️ 如果数据库没有这条记录，返回404（凭证不存在）
  if (!credential) {
    console.log(`[${beijingTime()}] [MQTT-Handler] 数据库无此记录，返回404`);
    return { success: true, response: '凭证不存在', code: 404 };
  }

  // 找到了记录，根据类型处理
  const isIris = credential.type === 7;
  const isPalm = credential.type === 8;
  const dbCredentialId = credential.credential_id;
  const personId = credential.person_id;

  console.log(`[${beijingTime()}] [MQTT-Handler] 找到数据库记录: credentialId=${dbCredentialId}, personId=${personId}, type=${credential.type}`);

  if (isIris) {
    console.log(`[${beijingTime()}] [MQTT-Handler] 虹膜删除：删除数据库 + 加密文件（设备上已无数据）`);

    // 1. 删除数据库凭证
    if (dbCredentialId) {
      await deleteCredential(dbCredentialId);
      console.log(`[${beijingTime()}] [MQTT-Handler] 数据库凭证已删除: credentialId=${dbCredentialId}`);
    }

    // 2. 删除本地加密文件
    try {
      const { deleteIrisData } = await import('./iris-data');
      deleteIrisData(dbCredentialId);
      console.log(`[${beijingTime()}] [MQTT-Handler] 加密文件已删除: credentialId=${dbCredentialId}`);
    } catch (e: any) {
      console.log(`[${beijingTime()}] [MQTT-Handler] 删除加密文件失败: ${e.message}（可忽略）`);
    }

    return { success: true, response: '已从数据库和加密文件删除' };
  } else if (isPalm) {
    // 优先使用 custom_id（存储时的 userId），兼容旧数据回退到 personId
    const userId = credential
      ? (credential.custom_id || personId)
      : personId;

    console.log(`[${beijingTime()}] [MQTT-Handler] 掌纹删除：先删设备 userId=${userId}`);

    const result = await deleteFromPalmDeviceMQTT(device.endpoint, userId);

    // ⚠️ 设备成功才删数据库
    if (result.success && dbCredentialId) {
      console.log(`[${beijingTime()}] [MQTT-Handler] 设备删除成功，删除数据库: credentialId=${dbCredentialId}`);
      await deleteCredential(dbCredentialId);
    } else if (!result.success) {
      console.log(`[${beijingTime()}] [MQTT-Handler] 设备删除失败，不删数据库`);
    }

    return result;
  } else {
    if (dbCredentialId) {
      await deleteCredential(dbCredentialId);
    }
    return { success: true, response: '已从数据库删除' };
  }
}

/**
 * 解析掌纹凭证的 content 字段
 * 格式: "userId:featureData"（英文冒号分隔）
 */
function parsePalmContent(content: string): { userId: string; featureData: string } {
  if (!content) return { userId: '', featureData: '' };

  const colonIndex = content.indexOf(':');
  if (colonIndex < 0) return { userId: '', featureData: content };

  return {
    userId: content.substring(0, colonIndex),
    featureData: content.substring(colonIndex + 1),
  };
}

/**
 * 从掌纹特征数据中提取 userId（已废弃，保留兼容旧数据）
 * @deprecated 掌纹 userId 现在存储在 content 字段中，格式为 "userId:featureData"
 */
function extractUserIdFromFeatureData(featureData: string): string {
  if (!featureData) return '';

  const firstCaret = featureData.indexOf('^');
  if (firstCaret < 0) return '';

  const beforeCaret = featureData.substring(0, firstCaret);
  const match = beforeCaret.match(/([a-z][a-z0-9_-]{2,20})$/);
  if (match) return match[1];

  const lastEq = beforeCaret.lastIndexOf('=');
  if (lastEq >= 0) return beforeCaret.substring(lastEq + 1).trim();

  return '';
}

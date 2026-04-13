/**
 * 设备同步模块
 * 负责与虹膜设备和掌纹设备进行数据同步
 * 文档：docs/诺亚方舟项目/生物识别设备数据接口解析.md
 * @updated 2026-03-30 - 导出 convertToBmpBase64 函数
 */

import http from 'http';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import {
  getPendingQueueItems,
  updateQueueStatus,
  addSyncLog,
  getDeviceConfigs,
  type SyncStatus,
  type DeviceConfig,
} from './sync-queue';

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
 * 从文件读取人脸图片
 * 虹膜设备要求必须上传人脸图片，我们使用固定图片
 */
function getSampleFaceImage(): string {
  const filePath = join(process.env.DATA_DIR || process.cwd(), 'face_photo_sample.txt');

  try {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8').trim();
      if (content.length > 1000) {
        return content;
      }
    }
  } catch (error: any) {
    console.error(`[设备] 人脸图片读取失败: ${error.message}`);
  }

  console.warn(`[设备] ⚠️ 人脸图片读取失败，使用默认值`);
  return '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
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
    bmpBuffer.writeInt32LE(height, offset); offset += 4;
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

    // 写入像素数据（BMP 从下往上存储）
    for (let y = height - 1; y >= 0; y--) {
      for (let x = 0; x < width; x++) {
        const srcIdx = y * width + x;
        bmpBuffer[offset++] = data[srcIdx]; // 灰度值
      }
      // 行填充
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
): Promise<{ success: boolean; response?: string; error?: string }> {
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
              resolve({
                success: false,
                error: `掌纹设备返回错误：${JSON.stringify(json)}`
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
): Promise<{ success: boolean; response?: string; error?: string }> {
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
              resolve({
                success: false,
                error: `掌纹设备返回错误：${JSON.stringify(json)}`
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

/**
 * 锁定/解锁虹膜设备
 * 上传人员前需要锁定，上传后需要解锁
 */
export async function setIrisDeviceSaveState(
  endpoint: string,
  state: 0 | 1  // 0=解锁, 1=锁定
): Promise<{ success: boolean; error?: string }> {
  try {
    const url = `${endpoint}/memberSaveState`;

    // 从 endpoint 提取设备 IP
    const endpointUrl = new URL(endpoint);
    const deviceIp = endpointUrl.hostname;

    const requestData = {
      ip: deviceIp,
      state: state,
    };

    console.log(`[DeviceSync] ${state === 1 ? '锁定' : '解锁'}虹膜设备, ip: ${deviceIp}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
      signal: AbortSignal.timeout(IRIS_DEVICE_CONFIG.timeout),
    });

    const responseData = await response.json();
    console.log(`[DeviceSync] memberSaveState 响应: ${JSON.stringify(responseData)}`);

    if (responseData.errorCode === 0 || responseData.errorCode === '0') {
      return { success: true };
    } else {
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
  },
  skipDebugLog?: boolean,
  skipBmpConversion?: boolean  // 新参数：跳过 BMP 转换
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
      singleIrisAllowed: 0,
    };

    console.log(`[DeviceSync] 下发虹膜特征(无锁定)到 ${endpoint}`);
    console.log(`[DeviceSync] staffNum: ${payload.staffNum}, memberName: ${payload.memberName}`);
    console.log(`[DeviceSync] irisLeft (BMP): ${irisLeftPreview} (${leftIrisBmp?.length || 0}字符)`);
    console.log(`[DeviceSync] irisRight (BMP): ${irisRightPreview} (${rightIrisBmp?.length || 0}字符)`);
    console.log(`[DeviceSync] faceImage: ${payload.faceImage?.substring(0, 10)}... (${payload.faceImage?.length || 0}字符)`);

    // 直接上传人员（不锁定）
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
      signal: AbortSignal.timeout(IRIS_MEMBER_SAVE_TIMEOUT),
    });

    const responseData = await response.json();
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
 * 流程：锁定设备 -> 上传人员 -> 解锁设备
 * @param skipDebugLog 是否跳过调试日志（重试时跳过，避免文件过多）
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
): Promise<{ success: boolean; response?: string; error?: string }> {
  const beijingTime = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  try {
    const url = `${endpoint}/memberSave`;

    // 转换虹膜图片为 BMP 格式
    const leftIrisBmp = payload.irisLeftImage ? await convertToBmpBase64(payload.irisLeftImage) : '';
    const rightIrisBmp = payload.irisRightImage ? await convertToBmpBase64(payload.irisRightImage) : '';

    if (!leftIrisBmp && !rightIrisBmp) {
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
      singleIrisAllowed: 0,
    };

    console.log(`[${beijingTime()}] [设备] 虹膜下发 ${payload.staffNum} ${payload.memberName}`);

    // 1. 锁定设备
    console.log(`[${beijingTime()}] [设备] 步骤1: 锁定设备...`);
    const lockResult = await setIrisDeviceSaveState(endpoint, 1);
    if (!lockResult.success) {
      return { success: false, error: lockResult.error || '锁定设备失败' };
    }
    console.log(`[${beijingTime()}] [设备] 锁定成功`);

    // 等待1秒
    console.log(`[${beijingTime()}] [设备] 等待1秒...`);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 2. 上传人员
    console.log(`[${beijingTime()}] [设备] 步骤2: 上传人员...`);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
      signal: AbortSignal.timeout(IRIS_MEMBER_SAVE_TIMEOUT),
    });

    const responseData = await response.json();
    console.log(`[${beijingTime()}] [设备] 上传完成: errorCode=${responseData.errorCode}`);

    // 等待500ms再解锁
    console.log(`[${beijingTime()}] [设备] 等待500ms...`);
    await new Promise(resolve => setTimeout(resolve, 500));

    // 3. 解锁设备
    console.log(`[${beijingTime()}] [设备] 步骤3: 解锁设备...`);
    await setIrisDeviceSaveState(endpoint, 0);
    console.log(`[${beijingTime()}] [设备] 解锁成功`);

    if (responseData.errorCode === 0 || responseData.errorCode === '0') {
      console.log(`[${beijingTime()}] [设备] ✅ 虹膜添加成功`);
      return { success: true, response: JSON.stringify(responseData) };
    } else {
      console.log(`[${beijingTime()}] [设备] ❌ 虹膜添加失败: errorCode=${responseData.errorCode}`);
      return { success: false, error: `errorCode=${responseData.errorCode}` };
    }
  } catch (error: any) {
    console.error(`[${beijingTime()}] [设备] 虹膜下发异常: ${error.message}`);
    try { await setIrisDeviceSaveState(endpoint, 0); } catch {}
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
    const url = `${endpoint}/memberDelete`;

    // ⚠️ 重要：参数名是 staffNum，不是 staffNumDec
    const requestData = {
      staffNum,
    };

    console.log(`[${beijingTime()}] [DeviceSync] 从虹膜设备删除用户：${staffNum}`);
    console.log(`[${beijingTime()}] [DeviceSync] Request: ${JSON.stringify(requestData)}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
      signal: AbortSignal.timeout(IRIS_DEVICE_CONFIG.timeout),
    });

    const responseData = await response.json();
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

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
      signal: AbortSignal.timeout(IRIS_DEVICE_CONFIG.timeout),
    });

    const responseData = await response.json();
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
        method: 'POST',  // ⚠️ 掌纹设备必须用 POST！
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
    let url: string;
    if (type === 'palm') {
      // 掌纹设备：使用 105 接口测试（sendData 不编码）
      url = `${deviceEndpoint}/api?sendData={"request":"105"}`;
    } else {
      // 虹膜设备：使用 members 接口测试
      url = `${deviceEndpoint}/members`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: type === 'iris' ? JSON.stringify({ count: 1, key: '', lastStaffNumDec: '', needImages: 0 }) : undefined,
      signal: AbortSignal.timeout(3000),
    });
    
    if (response.ok) {
      return {
        online: true,
        type,
        endpoint: deviceEndpoint,
        message: '设备在线',
      };
    } else {
      return {
        online: false,
        type,
        endpoint: deviceEndpoint,
        message: `设备响应异常：${response.status}`,
      };
    }
  } catch (error: any) {
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

    // 检查设备是否在线
    const deviceStatus = await checkDeviceStatus(device.device_type, device.endpoint);
    if (!deviceStatus.online) {
      console.log(`${bjt()} [设备] 离线: ${device.device_id} (${device.device_type})`);
      await updateQueueStatus(item.id, 'failed', '设备离线');
      await addSyncLog({
        queue_id: item.id,
        device_id: item.device_id,
        device_type: device.device_type,
        action: item.action,
        status: 'failed',
        error_message: '设备离线',
        duration_ms: 0,
      });
      failed++;
      continue;
    }

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
    action?: string;
  }
): Promise<{ success: boolean; response?: string; error?: string; code?: number }> {
  const isIris = payload.credentialType === 7;
  const isPalm = payload.credentialType === 8;

  console.log(`[MQTT-Handler] 处理凭证新增: ${isIris ? '虹膜' : isPalm ? '掌纹' : '其他'}, personId=${payload.personId}`);

  // ⚠️ 检查凭证是否已存在，如果存在返回405
  const { getCredentialById } = await import('./db-credentials');
  const existingCredential = await getCredentialById(payload.credentialId);
  if (existingCredential) {
    console.log(`[MQTT-Handler] 凭证已存在: credentialId=${payload.credentialId}, 返回405`);
    return { success: true, response: '凭证已存在', code: 405 };
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
    // 虹膜新增：先同步设备
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
        faceImage: getSampleFaceImage(),
      },
      true  // skipDebugLog
    );

    // ⚠️ 设备成功才保存数据库
    if (result.success) {
      console.log('[MQTT-Handler] 设备添加成功，保存数据库');
      const { upsertCredential } = await import('./db-credentials');
      await upsertCredential({
        person_id: payload.personId,
        person_name: memberName,
        credential_id: payload.credentialId,
        type: payload.credentialType as import('./db-credentials').CredentialType,
        content: payload.content,
        iris_left_image: irisLeftImage,
        iris_right_image: irisRightImage,
        palm_feature: palmFeature,
        auth_type_list: payload.authTypeList?.join(','),
      });
    } else {
      console.log('[MQTT-Handler] 设备添加失败，不保存数据库');
    }

    return result;
  } else if (isPalm) {
    // 掌纹新增：先同步设备
    console.log('[MQTT-Handler] 掌纹新增：先同步设备');

    const userId = extractUserIdFromFeatureData(palmFeature || '') || payload.personId;
    const palmMemberName = payload.personName || payload.personId || '';  // 默认用 personId

    const result = await syncToPalmDeviceMQTT(device.endpoint, {
      userId,
      featureData: palmFeature || '',
    });

    // ⚠️ 设备成功才保存数据库
    if (result.success) {
      console.log('[MQTT-Handler] 设备添加成功，保存数据库');
      console.log(`[MQTT-Handler] 提取的userId: ${userId}，存储到custom_id`);
      const { upsertCredential } = await import('./db-credentials');
      await upsertCredential({
        person_id: payload.personId,
        person_name: palmMemberName,
        credential_id: payload.credentialId,
        type: payload.credentialType as import('./db-credentials').CredentialType,
        content: payload.content,
        palm_feature: palmFeature,
        auth_type_list: payload.authTypeList?.join(','),
        custom_id: userId,  // 存储掌纹设备上的userId
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
    auth_type_list: payload.authTypeList?.join(','),
    box_list: payload.boxList,
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
    console.log(`[${beijingTime()}] [MQTT-Handler] 虹膜删除：先删设备 personId=${personId}`);

    const result = await deleteFromIrisDevice(device.endpoint, personId);

    // ⚠️ 设备成功才删数据库
    if (result.success && dbCredentialId) {
      console.log(`[${beijingTime()}] [MQTT-Handler] 设备删除成功，删除数据库: credentialId=${dbCredentialId}`);
      await deleteCredential(dbCredentialId);
    } else if (!result.success) {
      console.log(`[${beijingTime()}] [MQTT-Handler] 设备删除失败，不删数据库`);
    }

    return result;
  } else if (isPalm) {
    const userId = credential
      ? (extractUserIdFromFeatureData(credential.palm_feature || '') || personId)
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
 * 从掌纹特征数据中提取 userId
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

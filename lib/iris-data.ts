/**
 * 虹膜数据加密存储模块
 *
 * 将虹膜原始数据（memberSave payload）AES 加密后存储到文件，
 * 避免大 blob 存入 SQLite 导致数据库文件膨胀。
 *
 * 存储路径：data/iris_data/<credentialId>.json.enc
 * 加密方式：AES/ECB/PKCS5 (复用 lib/crypto.ts 的密钥)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { aesEncrypt, aesDecrypt } from '@/lib/crypto';

const IRIS_DATA_DIR_NAME = 'iris_data';

/**
 * 获取虹膜数据目录
 */
function getIrisDataDir(): string {
  const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
  const irisDir = join(dataDir, IRIS_DATA_DIR_NAME);
  if (!existsSync(irisDir)) {
    mkdirSync(irisDir, { recursive: true });
  }
  return irisDir;
}

/**
 * 获取虹膜数据文件路径
 */
function getIrisDataPath(credentialId: number): string {
  return join(getIrisDataDir(), `${credentialId}.json.enc`);
}

/**
 * 保存虹膜数据（加密后写入文件）
 * @param credentialId 凭证 ID
 * @param payload 完整的 memberSave payload 对象
 * @returns 相对路径（用于存储到数据库 iris_data_path 字段）
 */
export function saveIrisData(credentialId: number, payload: object): string {
  const filePath = getIrisDataPath(credentialId);
  const jsonStr = JSON.stringify(payload);
  const encrypted = aesEncrypt(jsonStr);
  writeFileSync(filePath, encrypted, 'utf-8');
  // 存储相对路径，方便跨环境迁移
  return join(IRIS_DATA_DIR_NAME, `${credentialId}.json.enc`);
}

/**
 * 读取并解密虹膜数据
 * @param credentialId 凭证 ID
 * @returns 原始的 memberSave payload 对象
 */
export function loadIrisData(credentialId: number): any {
  const filePath = getIrisDataPath(credentialId);
  if (!existsSync(filePath)) {
    throw new Error(`虹膜数据文件不存在: ${filePath}`);
  }
  const encrypted = readFileSync(filePath, 'utf-8');
  const jsonStr = aesDecrypt(encrypted);
  return JSON.parse(jsonStr);
}

/**
 * 删除虹膜数据文件
 * @param credentialId 凭证 ID
 */
export function deleteIrisData(credentialId: number): void {
  const filePath = getIrisDataPath(credentialId);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

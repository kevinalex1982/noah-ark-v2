/**
 * 系统设置模块
 * 设置保存在 settings.json 文件中
 * 打包后存储在 AppData 目录（更新不会被覆盖）
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// 设置文件路径（优先使用 DATA_DIR 环境变量，指向 AppData）
const SETTINGS_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const SETTINGS_FILE = join(SETTINGS_DIR, 'settings.json');

// 默认设置
const DEFAULT_SETTINGS: SystemSettings = {
  authTimeout: 120,       // 认证超时时间（秒）
  successReturnTime: 10,  // 认证成功返回时间（秒）
  irisEndpoint: 'http://192.168.3.202:9003',  // 虹膜设备地址
  palmEndpoint: 'http://127.0.0.1:8080',       // 掌纹设备地址
  deviceId: 'nuoyadev1',  // 认证终端设备ID（用于上报IAMS）
  maxPassLogs: 1000,      // 通行记录最大保存条数
  mqttBroker: 'mqtt://58.33.106.19:3881',  // IAMS MQTT Broker地址
  mqttUsername: 'yq-device',  // MQTT用户名
  mqttPassword: 'yqyq123!@#',  // MQTT密码
  aesEnabled: true,       // 是否启用AES加密（IAMS下发的用户编码是AES加密密文）
  adminPassword: '12345', // 管理员密码（底部管理员按钮验证用）
};

// 设置类型定义
export interface SystemSettings {
  authTimeout: number;        // 认证超时时间（秒）
  successReturnTime: number;  // 认证成功返回时间（秒）
  irisEndpoint: string;       // 虹膜设备地址
  palmEndpoint: string;       // 掌纹设备地址
  deviceId: string;           // 认证终端设备ID
  maxPassLogs: number;        // 通行记录最大保存条数
  mqttBroker: string;         // IAMS MQTT Broker地址
  mqttUsername: string;       // MQTT用户名
  mqttPassword: string;       // MQTT密码
  aesEnabled: boolean;        // 是否启用AES加密
  adminPassword: string;      // 管理员密码
}

// 内存缓存
let cachedSettings: SystemSettings | null = null;

/**
 * 确保设置文件存在
 */
function ensureSettingsFile(): void {
  if (!existsSync(SETTINGS_DIR)) {
    mkdirSync(SETTINGS_DIR, { recursive: true });
  }

  if (!existsSync(SETTINGS_FILE)) {
    writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8');
    console.log('[Settings] 创建默认设置文件');
  }
}

/**
 * 读取设置
 */
export function getSettings(): SystemSettings {
  // 返回缓存
  if (cachedSettings) {
    return {
      authTimeout: cachedSettings.authTimeout,
      successReturnTime: cachedSettings.successReturnTime,
      irisEndpoint: cachedSettings.irisEndpoint,
      palmEndpoint: cachedSettings.palmEndpoint,
      deviceId: cachedSettings.deviceId,
      maxPassLogs: cachedSettings.maxPassLogs,
      mqttBroker: cachedSettings.mqttBroker,
      mqttUsername: cachedSettings.mqttUsername,
      mqttPassword: cachedSettings.mqttPassword,
      aesEnabled: cachedSettings.aesEnabled,
      adminPassword: cachedSettings.adminPassword || DEFAULT_SETTINGS.adminPassword,
    };
  }

  try {
    ensureSettingsFile();
    const content = readFileSync(SETTINGS_FILE, 'utf-8');
    const settings = JSON.parse(content);

    // 合并默认值（防止缺少字段）
    cachedSettings = {
      authTimeout: settings.authTimeout ?? DEFAULT_SETTINGS.authTimeout,
      successReturnTime: settings.successReturnTime ?? DEFAULT_SETTINGS.successReturnTime,
      irisEndpoint: settings.irisEndpoint ?? DEFAULT_SETTINGS.irisEndpoint,
      palmEndpoint: settings.palmEndpoint ?? DEFAULT_SETTINGS.palmEndpoint,
      deviceId: settings.deviceId ?? DEFAULT_SETTINGS.deviceId,
      maxPassLogs: settings.maxPassLogs ?? DEFAULT_SETTINGS.maxPassLogs,
      mqttBroker: settings.mqttBroker ?? DEFAULT_SETTINGS.mqttBroker,
      mqttUsername: settings.mqttUsername ?? DEFAULT_SETTINGS.mqttUsername,
      mqttPassword: settings.mqttPassword ?? DEFAULT_SETTINGS.mqttPassword,
      aesEnabled: settings.aesEnabled ?? DEFAULT_SETTINGS.aesEnabled,
      adminPassword: settings.adminPassword ?? DEFAULT_SETTINGS.adminPassword,
    };

    return {
      authTimeout: cachedSettings.authTimeout,
      successReturnTime: cachedSettings.successReturnTime,
      irisEndpoint: cachedSettings.irisEndpoint,
      palmEndpoint: cachedSettings.palmEndpoint,
      deviceId: cachedSettings.deviceId,
      maxPassLogs: cachedSettings.maxPassLogs,
      mqttBroker: cachedSettings.mqttBroker,
      mqttUsername: cachedSettings.mqttUsername,
      mqttPassword: cachedSettings.mqttPassword,
      aesEnabled: cachedSettings.aesEnabled,
      adminPassword: cachedSettings.adminPassword,
    };
  } catch (error: any) {
    console.error('[Settings] 读取设置失败:', error.message);
    cachedSettings = { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * 更新设置
 */
export function updateSettings(newSettings: Partial<SystemSettings>): SystemSettings {
  const currentSettings = getSettings();

  // 合并新设置，确保类型安全
  cachedSettings = {
    authTimeout: newSettings.authTimeout ?? currentSettings.authTimeout,
    successReturnTime: newSettings.successReturnTime ?? currentSettings.successReturnTime,
    irisEndpoint: newSettings.irisEndpoint ?? currentSettings.irisEndpoint,
    palmEndpoint: newSettings.palmEndpoint ?? currentSettings.palmEndpoint,
    deviceId: newSettings.deviceId ?? currentSettings.deviceId,
    maxPassLogs: newSettings.maxPassLogs ?? currentSettings.maxPassLogs,
    mqttBroker: newSettings.mqttBroker ?? currentSettings.mqttBroker,
    mqttUsername: newSettings.mqttUsername ?? currentSettings.mqttUsername,
    mqttPassword: newSettings.mqttPassword ?? currentSettings.mqttPassword,
    aesEnabled: newSettings.aesEnabled ?? currentSettings.aesEnabled,
    adminPassword: newSettings.adminPassword ?? currentSettings.adminPassword,
  };

  try {
    ensureSettingsFile();
    writeFileSync(SETTINGS_FILE, JSON.stringify(cachedSettings, null, 2), 'utf-8');
    console.log('[Settings] 设置已更新:', cachedSettings);
  } catch (error: any) {
    console.error('[Settings] 保存设置失败:', error.message);
  }

  return { ...cachedSettings! };
}

/**
 * 获取认证超时时间（毫秒）
 */
export function getAuthTimeoutMs(): number {
  const settings = getSettings();
  return settings.authTimeout * 1000;
}

/**
 * 获取认证成功返回时间（毫秒）
 */
export function getSuccessReturnTimeMs(): number {
  const settings = getSettings();
  return settings.successReturnTime * 1000;
}

/**
 * 获取虹膜设备地址
 */
export function getIrisEndpoint(): string {
  const settings = getSettings();
  return settings.irisEndpoint;
}

/**
 * 获取掌纹设备地址
 */
export function getPalmEndpoint(): string {
  const settings = getSettings();
  return settings.palmEndpoint;
}

/**
 * 获取认证终端设备ID
 */
export function getDeviceId(): string {
  const settings = getSettings();
  return settings.deviceId;
}

/**
 * 获取通行记录最大保存条数
 */
export function getMaxPassLogs(): number {
  const settings = getSettings();
  return settings.maxPassLogs;
}

/**
 * 获取MQTT Broker地址
 */
export function getMqttBroker(): string {
  const settings = getSettings();
  return settings.mqttBroker;
}

/**
 * 获取MQTT用户名
 */
export function getMqttUsername(): string {
  const settings = getSettings();
  return settings.mqttUsername;
}

/**
 * 获取MQTT密码
 */
export function getMqttPassword(): string {
  const settings = getSettings();
  return settings.mqttPassword;
}

/**
 * 是否启用AES加密
 */
export function isAesEnabled(): boolean {
  const settings = getSettings();
  return settings.aesEnabled;
}

/**
 * 清除缓存（用于测试）
 */
export function clearSettingsCache(): void {
  cachedSettings = null;
}
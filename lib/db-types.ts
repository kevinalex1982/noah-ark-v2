/**
 * 数据库类型定义
 */

// 用户
export interface User {
  id: string;
  employee_id: string;
  name: string;
  department?: string;
  position?: string;
  created_at: string;
  updated_at: string;
}

// 生物特征凭证
export interface BiometricCredential {
  id: string;
  user_id: string;
  device_id: string;
  credential_type: 'password' | 'iris' | 'palm' | 'face';
  credential_data: string;
  created_at: string;
  updated_at: string;
}

// 认证记录
export interface AuthLog {
  id: string;
  user_id?: string;
  device_id: string;
  auth_type: string;
  result: 'success' | 'failure' | 'duress';
  is_duress: number; // 0 或 1
  timestamp: string;
  metadata?: string; // JSON 字符串
}

// 胁迫码
export interface DuressCode {
  id: string;
  user_id: string;
  code: string;
  is_active: number; // 0 或 1
  created_at: string;
}

// 设备同步状态
export interface DeviceSyncStatus {
  id: string;
  device_id: string;
  last_sync?: string;
  status: 'idle' | 'syncing' | 'error';
  error_message?: string;
  updated_at: string;
}

// 认证结果枚举（符合 IAMS 协议）
export enum AuthResult {
  SUCCESS = 1,
  FAILURE = 2,
  DURESS = 9, // 胁迫报警
}

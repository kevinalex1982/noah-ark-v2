/**
 * 诺亚宝库 - Electron 预加载脚本
 *
 * 功能：
 * - 提供安全的 API 暴露给渲染进程
 * - 上下文隔离
 */

import { contextBridge, ipcRenderer } from 'electron';

// 暴露给渲染进程的安全 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 平台信息
  platform: process.platform,

  // 应用版本
  version: process.env.npm_package_version || '1.0.0',

  // 全屏控制
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),

  // Kiosk 模式
  toggleKiosk: () => ipcRenderer.invoke('toggle-kiosk'),

  // 窗口最小化
  minimize: () => ipcRenderer.invoke('window-minimize'),

  // 窗口最大化
  maximize: () => ipcRenderer.invoke('window-maximize'),

  // 窗口关闭
  close: () => ipcRenderer.invoke('window-close'),

  // 重新加载页面
  reload: () => ipcRenderer.invoke('window-reload'),

  // 重启应用
  restartApp: () => ipcRenderer.invoke('restart-app'),

  // 重启后台服务（Next.js）
  restartBackend: () => ipcRenderer.invoke('restart-backend'),

  // 清理缓存（.next/cache + 浏览器缓存）
  clearCache: () => ipcRenderer.invoke('clear-cache'),
});

// 类型定义（供前端使用）
export interface ElectronAPI {
  platform: NodeJS.Platform;
  version: string;
  toggleFullscreen: () => Promise<void>;
  toggleKiosk: () => Promise<void>;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  reload: () => Promise<void>;
  restartApp: () => Promise<void>;
  restartBackend: () => Promise<{ success: boolean; message?: string }>;
  clearCache: () => Promise<{ success: boolean; message: string }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
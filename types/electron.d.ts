/// <reference types="./electron/dist/preload" />

// Electron API 类型声明
interface ElectronAPI {
  platform: NodeJS.Platform;
  version: string;
  toggleFullscreen: () => Promise<void>;
  toggleKiosk: () => Promise<void>;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  reload: () => Promise<void>;
  restartApp: () => Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
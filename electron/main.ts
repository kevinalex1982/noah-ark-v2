/**
 * 诺亚宝库 - Electron 主进程
 *
 * 功能：
 * - 创建全屏 Kiosk 窗口
 * - 加载本地 Next.js 应用 (localhost:3001)
 * - 系统托盘支持
 * - 窗口管理
 * - 开机自启动
 * - 内嵌 Next.js 服务（打包后）
 * - MQTT 连接 IAMS Broker（mqtt://58.33.106.19:3881）
 * - 支持连接远程服务器
 */

import { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

// 默认配置
const DEFAULT_CONFIG = {
  serverUrl: 'http://localhost:3001',  // 默认连接本地
  title: '诺亚宝库',
  width: 1920,
  height: 1080,
};

let CONFIG = { ...DEFAULT_CONFIG };

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

/**
 * 是否开发模式
 */
function isDev(): boolean {
  return process.env.NODE_ENV === 'development' || !app.isPackaged;
}

/**
 * 获取 Electron 客户端配置文件路径
 * 存储在用户数据目录，而不是应用目录
 */
function getClientConfigPath(): string {
  return path.join(app.getPath('userData'), 'client-config.json');
}

/**
 * 加载客户端配置
 */
function loadClientConfig(): { serverUrl: string } {
  const configPath = getClientConfigPath();

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      return {
        serverUrl: config.serverUrl || DEFAULT_CONFIG.serverUrl,
      };
    }
  } catch (error) {
    console.error('[Electron] 读取客户端配置失败:', error);
  }

  return { serverUrl: DEFAULT_CONFIG.serverUrl };
}

/**
 * 保存客户端配置
 */
function saveClientConfig(serverUrl: string): void {
  const configPath = getClientConfigPath();

  try {
    const config = { serverUrl };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    console.log('[Electron] 客户端配置已保存:', config);
  } catch (error) {
    console.error('[Electron] 保存客户端配置失败:', error);
  }
}

/**
 * 显示服务器配置对话框
 */
function showServerConfigDialog(): void {
  const currentUrl = CONFIG.serverUrl;

  dialog.showMessageBox(mainWindow!, {
    type: 'question',
    buttons: ['确定', '取消'],
    defaultId: 0,
    title: '服务器配置',
    message: '请输入后端服务器地址',
    detail: `当前地址: ${currentUrl}\n\n提示：一体化部署使用 localhost:3001`,
  }).then((result) => {
    if (result.response === 0) {
      // 用户点击确定，弹出输入框（使用简单的 prompt）
      mainWindow?.webContents.executeJavaScript(`
        prompt('请输入服务器地址:', '${currentUrl}')
      `).then((inputUrl: string | null) => {
        if (inputUrl && inputUrl.trim()) {
          const newUrl = inputUrl.trim();
          CONFIG.serverUrl = newUrl;
          saveClientConfig(newUrl);

          dialog.showMessageBox(mainWindow!, {
            type: 'info',
            title: '配置已保存',
            message: `服务器地址已更新为: ${newUrl}`,
            detail: '请重启应用以连接新服务器',
          });
        }
      });
    }
  });
}

/**
 * 获取应用资源路径
 */
function getResourcePath(...paths: string[]): string {
  if (isDev()) {
    return path.join(process.cwd(), ...paths);
  }
  // 打包后，资源在 resources/app 目录
  return path.join(process.resourcesPath, 'app', ...paths);
}

/**
 * 获取 Node.js 可执行文件路径
 * 打包后需要使用内嵌的 node.exe，而不是 Electron.exe
 */
function getNodePath(): string {
  if (isDev()) {
    // 开发模式：使用系统 Node.js
    return 'node';
  }
  // 打包后：使用内嵌的 node.exe
  const embeddedNode = getResourcePath('node.exe');
  if (fs.existsSync(embeddedNode)) {
    return embeddedNode;
  }
  // 如果没有内嵌，尝试使用系统 Node.js
  return 'node';
}

/**
 * 启动内嵌服务（打包后，仅当连接本地时）
 * 只启动 Next.js 服务，MQTT 连接 IAMS Broker
 */
async function startEmbeddedServices(): Promise<void> {
  if (isDev()) {
    console.log('[Electron] 开发模式，跳过内嵌服务启动');
    return;
  }

  // 如果连接远程服务器，不启动内嵌服务
  if (!CONFIG.serverUrl.includes('localhost') && !CONFIG.serverUrl.includes('127.0.0.1')) {
    console.log('[Electron] 连接远程服务器，跳过内嵌服务启动');
    return;
  }

  const appPath = getResourcePath();
  const nodePath = getNodePath();

  console.log('[Electron] 应用路径:', appPath);
  console.log('[Electron] Node路径:', nodePath);

  // ⚠️ 所有持久化数据存储在 AppData 目录（更新安装不会被覆盖）
  const userDataDir = app.getPath('userData');
  const dbPath = path.join(userDataDir, 'noah-ark.db');
  console.log('[Electron] 数据目录:', userDataDir);
  console.log('[Electron] 数据库路径:', dbPath);

  // 启动 Next.js 服务（独立控制台窗口）
  console.log('[Electron] 启动 Next.js 服务...');
  const nextPath = path.join(appPath, 'node_modules', '.bin', 'next.cmd');

  spawn('cmd.exe', [
    '/c', 'start', 'cmd.exe', '/k',
    `"Next.js Server - Port 3001" && ${nextPath} start -p 3001`,
  ], {
    cwd: appPath,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_PATH: dbPath,  // ⚠️ 数据库路径（AppData）
      DATA_DIR: userDataDir,  // ⚠️ 数据目录（AppData，settings.json等）
    },
    shell: true,
    detached: true,
  });

  // 等待 Next.js 启动
  console.log('[Electron] 等待服务启动...');
  await new Promise(resolve => setTimeout(resolve, 3000));
}

/**
 * 停止内嵌服务
 * 关闭 Next.js 服务（端口 3001）
 */
function stopEmbeddedServices(): void {
  console.log('[Electron] 停止 Next.js 服务...');

  // 关闭端口 3001 的进程（Next.js）
  spawn('cmd.exe', ['/c', 'for /f "tokens=5" %a in (\'netstat -ano ^| findstr :3001\') do taskkill /F /PID %a'], {
    shell: true,
  });
}

/**
 * 设置开机自启动
 */
function setAutoLaunch(enable: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enable,
    openAsHidden: false,
    name: '诺亚宝库',
  });
}

/**
 * 创建主窗口
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: CONFIG.width,
    height: CONFIG.height,
    fullscreen: false,
    fullscreenable: true,
    kiosk: false,
    title: CONFIG.title,
    icon: path.join(__dirname, '../app/favicon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    frame: true,
    autoHideMenuBar: true,
    backgroundColor: '#f8fafc',
    show: false,
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(CONFIG.serverUrl);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode) => {
    if (errorCode === -102) {
      mainWindow?.loadURL(`data:text/html,
        <html>
          <head><meta charset="UTF-8"></head>
          <body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f8fafc;font-family:sans-serif;">
            <div style="text-align:center;padding:40px;background:white;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
              <h1 style="color:#dc2626;margin-bottom:16px;">⚠️ 无法连接到服务器</h1>
              <p style="color:#6b7280;margin-bottom:24px;">请确保后端服务已启动</p>
              <button onclick="location.reload()" style="background:#111827;color:white;border:none;padding:12px 24px;border-radius:8px;cursor:pointer;font-size:16px;">重试连接</button>
            </div>
          </body>
        </html>
      `);
    }
  });
}

/**
 * 创建系统托盘
 */
function createTray(): void {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  const loginSettings = app.getLoginItemSettings();
  const isAutoLaunch = loginSettings.openAtLogin;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: '全屏模式',
      type: 'checkbox',
      checked: false,
      click: (menuItem) => mainWindow?.setFullScreen(menuItem.checked),
    },
    {
      label: 'Kiosk 模式',
      type: 'checkbox',
      checked: false,
      click: (menuItem) => mainWindow?.setKiosk(menuItem.checked),
    },
    {
      label: '开机自启动',
      type: 'checkbox',
      checked: isAutoLaunch,
      click: (menuItem) => setAutoLaunch(menuItem.checked),
    },
    { type: 'separator' },
    {
      label: `服务器: ${CONFIG.serverUrl.replace('http://', '')}`,
      enabled: false,
    },
    {
      label: '配置服务器地址',
      click: () => showServerConfigDialog(),
    },
    { type: 'separator' },
    {
      label: '打开开发者工具',
      click: () => mainWindow?.webContents.openDevTools(),
    },
    { type: 'separator' },
    {
      label: '重启应用',
      click: () => {
        app.relaunch();
        app.exit(0);
      },
    },
    {
      label: '退出',
      click: () => app.quit(),
    },
  ]);

  tray.setToolTip('诺亚宝库');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

/**
 * 应用启动
 */
async function main() {
  // 加载客户端配置（服务器地址）
  const clientConfig = loadClientConfig();
  CONFIG.serverUrl = clientConfig.serverUrl;
  console.log('[Electron] 服务器地址:', CONFIG.serverUrl);

  await startEmbeddedServices();

  if (!isDev()) {
    setAutoLaunch(true);
  }

  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopEmbeddedServices();
});

app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsedUrl = new URL(navigationUrl);
      const serverOrigin = new URL(CONFIG.serverUrl).origin;
      if (parsedUrl.origin !== serverOrigin) {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });
});

// IPC 处理程序
ipcMain.handle('restart-app', () => {
  console.log('[Electron] 收到重启请求');
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('toggle-fullscreen', () => {
  mainWindow?.setFullScreen(!mainWindow.isFullScreen());
});

ipcMain.handle('toggle-kiosk', () => {
  mainWindow?.setKiosk(!mainWindow.isKiosk());
});

ipcMain.handle('window-minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window-close', () => {
  mainWindow?.close();
});

ipcMain.handle('window-reload', () => {
  mainWindow?.reload();
});

// 单实例锁：确保只有一个 Electron 实例运行
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // 已有实例运行，直接退出
  console.log('[Electron] 已有实例运行，退出');
  app.quit();
} else {
  // 当第二个实例尝试启动时，聚焦到已有窗口
  app.on('second-instance', () => {
    console.log('[Electron] 检测到第二个实例，聚焦窗口');
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(main);
}
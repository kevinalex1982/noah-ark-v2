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

import { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, ipcMain, NativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

// 默认配置
const DEFAULT_CONFIG = {
  serverUrl: 'http://localhost:3001',  // 默认连接本地
  title: '诺亚保管库',
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
 * 内嵌 Next.js 服务进程
 */
let nextProcess: ReturnType<typeof spawn> | null = null;

/**
 * 写入日志到文件
 */
function writeLog(message: string, level: 'info' | 'error' = 'info'): void {
  const userDataDir = app.getPath('userData');
  const logDir = path.join(userDataDir, 'logs');
  const logFile = path.join(logDir, 'nextjs.log');

  if (!require('fs').existsSync(logDir)) {
    require('fs').mkdirSync(logDir, { recursive: true });
  }

  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const line = `[${timestamp}] [${level}] ${message}\n`;

  require('fs').appendFileSync(logFile, line, 'utf-8');
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

  // 启动 Next.js 服务（后台进程，无控制台窗口）
  console.log('[Electron] 启动 Next.js 服务...');
  const nextCliPath = path.join(appPath, 'node_modules', 'next', 'dist', 'bin', 'next');

  nextProcess = spawn(nodePath, [nextCliPath, 'start', '-p', '3001'], {
    cwd: appPath,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_PATH: dbPath,
      DATA_DIR: userDataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  // 将子进程输出转发到主进程控制台 + 日志文件
  nextProcess.stdout?.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      console.log(`[Next.js] ${text}`);
      writeLog(text, 'info');
    }
  });
  nextProcess.stderr?.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      console.error(`[Next.js] ${text}`);
      writeLog(text, 'error');
    }
  });
  nextProcess.on('error', (err) => {
    console.error('[Electron] Next.js 进程启动失败:', err);
    writeLog(`进程启动失败: ${err.message}`, 'error');
  });
  nextProcess.on('exit', (code, signal) => {
    console.log(`[Electron] Next.js 进程退出: code=${code}, signal=${signal}`);
    writeLog(`进程退出: code=${code}, signal=${signal}`, 'error');
  });

  // 等待 Next.js 启动
  console.log('[Electron] 等待服务启动...');
  await new Promise(resolve => setTimeout(resolve, 3000));
}

/**
 * 停止内嵌服务
 */
function stopEmbeddedServices(): void {
  console.log('[Electron] 停止 Next.js 服务...');

  if (nextProcess) {
    try {
      nextProcess.kill('SIGTERM');
      // 如果进程没在 3 秒内退出，强制终止整个进程树
      setTimeout(() => {
        try {
          spawn('taskkill', ['/F', '/T', '/PID', String(nextProcess!.pid)]);
        } catch { /* ignore */ }
      }, 3000);
    } catch { /* process already dead */ }
    nextProcess = null;
  }
}

/**
 * 设置开机自启动
 */
function setAutoLaunch(enable: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enable,
    openAsHidden: false,
    name: '诺亚保管库',
  });
}

/**
 * 创建主窗口
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: CONFIG.width,
    height: CONFIG.height,
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
    mainWindow?.maximize();
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
 * 创建一个简单的托盘图标（灰色圆角方块 + 白色字母 N）
 */
function createTrayIcon(): NativeImage {
  // 创建一个 16x16 的托盘图标
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4); // RGBA

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // 圆角判断
      const radius = 3;
      let isCorner = false;
      if (x < radius && y < radius) {
        const dx = x - radius + 1;
        const dy = y - radius + 1;
        if (dx * dx + dy * dy > radius * radius) isCorner = true;
      }
      if (x >= size - radius && y < radius) {
        const dx = x - size + radius;
        const dy = y - radius + 1;
        if (dx * dx + dy * dy > radius * radius) isCorner = true;
      }
      if (x < radius && y >= size - radius) {
        const dx = x - radius + 1;
        const dy = y - size + radius;
        if (dx * dx + dy * dy > radius * radius) isCorner = true;
      }
      if (x >= size - radius && y >= size - radius) {
        const dx = x - size + radius;
        const dy = y - size + radius;
        if (dx * dx + dy * dy > radius * radius) isCorner = true;
      }

      if (isCorner) {
        canvas[idx] = 0;     // R
        canvas[idx + 1] = 0; // G
        canvas[idx + 2] = 0; // B
        canvas[idx + 3] = 0; // A
      } else {
        canvas[idx] = 50;     // R - 深灰色背景
        canvas[idx + 1] = 50; // G
        canvas[idx + 2] = 55; // B
        canvas[idx + 3] = 255; // A - 不透明
      }
    }
  }

  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

/**
 * 创建系统托盘
 */
function createTray(): void {
  const icon = createTrayIcon();
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
    {
      label: '查看服务器日志',
      click: () => {
        const logFile = path.join(app.getPath('userData'), 'logs', 'nextjs.log');
        if (fs.existsSync(logFile)) {
          shell.openPath(logFile);
        } else {
          dialog.showMessageBox(mainWindow!, {
            type: 'info',
            title: '提示',
            message: '日志文件尚未创建',
            detail: '服务器启动后会自动创建日志文件',
          });
        }
      },
    },
    {
      label: '打开日志文件夹',
      click: () => {
        const logDir = path.join(app.getPath('userData'), 'logs');
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }
        shell.openPath(logDir);
      },
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

  tray.setToolTip('诺亚保管库');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

/**
 * 检查并清除旧数据（由安装程序标记）
 */
function checkAndClearOldData(): void {
  const userDataDir = app.getPath('userData');
  const flagPath = path.join(userDataDir, '.clear-old-data');

  if (fs.existsSync(flagPath)) {
    console.log('[Electron] 检测到清除旧数据标记，开始清理...');
    try {
      // 删除整个 userData 目录（数据库、设置、日志等）
      // 注意：只删除 noah-ark-electron 目录的内容，不删除目录本身
      const items = fs.readdirSync(userDataDir);
      for (const item of items) {
        if (item === '.clear-old-data') continue; // 标记文件最后删除
        const itemPath = path.join(userDataDir, item);
        fs.rmSync(itemPath, { recursive: true, force: true });
      }
      fs.unlinkSync(flagPath); // 删除标记文件
      console.log('[Electron] 旧数据已清除');
    } catch (error) {
      console.error('[Electron] 清除旧数据失败:', error);
    }
  }
}

/**
 * 应用启动
 */
async function main() {
  // 检查是否需要清除旧数据（安装程序设置的标记）
  checkAndClearOldData();

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
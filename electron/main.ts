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
import { spawn, exec } from 'child_process';

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
 * 获取日志文件名（带日期后缀，如 startup-2026-04-19.log）
 */
function getLogFileName(base: string): string {
  const today = new Date();
  // 使用北京时间 (UTC+8)
  const dateStr = new Date(today.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return `${base}-${dateStr}.log`;
}

/**
 * 清理 3 天前的旧日志文件
 */
function cleanOldLogs(maxAgeDays: number = 3): void {
  const userDataDir = app.getPath('userData');
  const logDir = path.join(userDataDir, 'logs');
  if (!fs.existsSync(logDir)) return;

  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  try {
    const files = fs.readdirSync(logDir);
    for (const file of files) {
      if (!file.endsWith('.log')) continue;
      const filePath = path.join(logDir, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
        console.log(`[Electron] 已删除过期日志: ${file}`);
      }
    }
  } catch (error) {
    console.error('[Electron] 清理旧日志失败:', error);
  }
}

/**
 * 写入启动日志到文件（AppData 日志目录）
 */
function writeLog(message: string, level: 'info' | 'error' | 'warn' = 'info'): void {
  const userDataDir = app.getPath('userData');
  const logDir = path.join(userDataDir, 'logs');
  const logFile = path.join(logDir, getLogFileName('startup'));

  if (!require('fs').existsSync(logDir)) {
    require('fs').mkdirSync(logDir, { recursive: true });
  }

  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const line = `[${timestamp}] [${level}] ${message}\n`;

  require('fs').appendFileSync(logFile, line, 'utf-8');
}

/**
 * 写入 Next.js 子进程输出到独立日志
 */
function writeNextJsLog(message: string, level: 'info' | 'error' = 'info'): void {
  const userDataDir = app.getPath('userData');
  const logDir = path.join(userDataDir, 'logs');
  const logFile = path.join(logDir, getLogFileName('nextjs'));

  if (!require('fs').existsSync(logDir)) {
    require('fs').mkdirSync(logDir, { recursive: true });
  }

  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const line = `[${timestamp}] [${level}] ${message}\n`;

  require('fs').appendFileSync(logFile, line, 'utf-8');
}

/**
 * 关闭占用指定端口的进程
 */
function killProcessOnPort(port: number): Promise<void> {
  return new Promise((resolve) => {
    // 查找占用端口的 PID
    exec(`netstat -ano | findstr :${port}`, (error, stdout) => {
      if (error || !stdout) {
        resolve();
        return;
      }
      const lines = stdout.trim().split('\n');
      const pids = new Set<string>();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const state = parts[3];
          if (state === 'LISTENING' || state === 'TIME_WAIT' || state === 'ESTABLISHED') {
            const pid = parts[4];
            if (pid && pid !== '0') {
              pids.add(pid);
            }
          }
        }
      }
      if (pids.size === 0) {
        writeLog(`端口 ${port} 未被占用，无需清理`, 'info');
        resolve();
        return;
      }
      // 杀掉占用进程
      const killCmd = `taskkill /F /PID ${Array.from(pids).join(' /PID ')}`;
      writeLog(`正在清理端口 ${port} 占用进程: PID ${Array.from(pids).join(', ')}`, 'warn');
      exec(killCmd, () => {
        // 等1秒让系统释放端口
        setTimeout(resolve, 1000);
      });
    });
  });
}

/**
 * 清理 .next/cache 目录（解决现场缓存问题）
 */
function cleanNextCache(): void {
  if (isDev()) return; // 开发模式不清理

  const appPath = getResourcePath();
  const cacheDir = path.join(appPath, '.next', 'cache');

  if (fs.existsSync(cacheDir)) {
    try {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      writeLog('已清理 .next/cache 目录', 'info');
    } catch (error: any) {
      writeLog(`清理 .next/cache 失败: ${error.message}`, 'warn');
    }
  }
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

  // 启动前先清理 .next/cache（解决现场缓存导致的页面显示异常）
  cleanNextCache();

  // 启动前先清理端口 3001 占用（处理上次退出不彻底的情况）
  await killProcessOnPort(3001);

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

  writeLog(`Next.js 进程已启动, PID: ${nextProcess.pid}`, 'info');

  // 将子进程输出转发到主进程控制台 + 日志文件
  nextProcess.stdout?.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      console.log(`[Next.js] ${text}`);
      writeNextJsLog(text, 'info');
    }
  });
  nextProcess.stderr?.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      console.error(`[Next.js] ${text}`);
      writeNextJsLog(text, 'error');
    }
  });
  nextProcess.on('error', (err) => {
    console.error('[Electron] Next.js 进程启动失败:', err);
    writeLog(`Next.js 进程错误: ${err.message}`, 'error');
    writeLog(`错误堆栈: ${err.stack}`, 'error');
  });
  nextProcess.on('exit', (code, signal) => {
    console.log(`[Electron] Next.js 进程退出: code=${code}, signal=${signal}`);
    writeLog(`Next.js 进程退出: code=${code}, signal=${signal}`, 'error');
    nextProcess = null;  // ⚠️ 进程退出后清除引用，允许重新启动
  });

  // 等待 Next.js 启动（不再固定等待3秒，由 main() 中的 waitForServiceReady 处理）
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
 * 等待 Next.js 服务就绪（轮询 HTTP 端口）
 */
async function waitForServiceReady(url: string, maxRetries: number = 20, interval: number = 2000): Promise<boolean> {
  const http = require('http');
  for (let i = 0; i < maxRetries; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        http.get(url, (res: any) => {
          resolve();
        }).on('error', () => {
          reject();
        });
      });
      console.log(`[Electron] Next.js 服务已就绪（第 ${i + 1} 次尝试）`);
      return true;
    } catch {
      console.log(`[Electron] 等待服务启动... (${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }
  return false;
}

/**
 * 重启内嵌服务（用于系统设置页面的"重启后台服务"按钮）
 * 返回 { success, message } 表示实际结果
 */
async function restartEmbeddedServices(): Promise<{ success: boolean; message: string }> {
  console.log('[Electron] 正在重启 Next.js 服务...');
  writeLog('用户请求重启 Next.js 服务', 'info');

  stopEmbeddedServices();
  // 等待进程完全退出 + 端口释放
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 验证关键路径是否存在
  const appPath = getResourcePath();
  const nextCliPath = path.join(appPath, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (!fs.existsSync(nextCliPath)) {
    const msg = `Next.js CLI 不存在: ${nextCliPath}`;
    writeLog(msg, 'error');
    return { success: false, message: msg };
  }

  try {
    await startEmbeddedServices();
    // 等待新服务就绪
    const ready = await waitForServiceReady(CONFIG.serverUrl);
    if (ready) {
      writeLog('Next.js 服务重启成功', 'info');
      return { success: true, message: '服务已启动' };
    } else {
      const msg = '服务启动超时（40秒），请检查日志';
      writeLog(msg, 'error');
      return { success: false, message: msg };
    }
  } catch (error: any) {
    const msg = `启动异常: ${error.message}`;
    writeLog(msg, 'error');
    return { success: false, message: msg };
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

  // 拦截关闭按钮，弹出对话框选择关闭/最小化/取消
  mainWindow.on('close', (event) => {
    if (mainWindow === null) return;

    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['最小化到托盘', '关闭程序', '取消'],
      defaultId: 0,
      cancelId: 2,
      title: '关闭确认',
      message: '请选择关闭后的行为',
      detail: '最小化到托盘：程序继续在后台运行，点击托盘图标可恢复\n关闭程序：完全退出应用',
    });

    if (choice === 0) {
      // 最小化到托盘
      event.preventDefault();
      mainWindow?.hide();
    } else if (choice === 1) {
      // 关闭程序 — 不拦截，继续执行默认关闭行为
    } else {
      // 取消
      event.preventDefault();
    }
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
 * 创建托盘图标（使用应用 favicon.ico）
 * 如果 favicon 加载失败，回退到生成的亮色圆角方块
 */
function createTrayIcon(): NativeImage {
  // 尝试加载 favicon.ico
  let faviconPath: string;
  if (!app.isPackaged) {
    // 开发模式：__dirname = electron/ → ../app/favicon.ico
    faviconPath = path.join(__dirname, '../app/favicon.ico');
  } else {
    // 打包模式：extraResources 把 ../app 复制到 resources/app/
    faviconPath = path.join(process.resourcesPath, 'app', 'app', 'favicon.ico');
  }
  if (fs.existsSync(faviconPath)) {
    try {
      const img = nativeImage.createFromPath(faviconPath);
      if (!img.isEmpty()) {
        // 缩放托盘图标到合适大小
        return img.resize({ width: 16, height: 16 });
      }
    } catch (e) {
      console.warn('[Electron] 加载 favicon 失败，使用回退图标:', e);
    }
  }

  // 回退：生成亮色圆角方块
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4); // RGBA

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
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
        canvas[idx] = 0;
        canvas[idx + 1] = 0;
        canvas[idx + 2] = 0;
        canvas[idx + 3] = 0;
      } else {
        canvas[idx] = 255;     // R
        canvas[idx + 1] = 255; // G
        canvas[idx + 2] = 255; // B
        canvas[idx + 3] = 255; // A
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
        const logFile = path.join(app.getPath('userData'), 'logs', getLogFileName('nextjs'));
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
    {
      label: '查看启动日志',
      click: () => {
        const logFile = path.join(app.getPath('userData'), 'logs', getLogFileName('startup'));
        if (fs.existsSync(logFile)) {
          shell.openPath(logFile);
        } else {
          dialog.showMessageBox(mainWindow!, {
            type: 'info',
            title: '提示',
            message: '启动日志尚未创建',
            detail: '日志文件路径：' + logFile,
          });
        }
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
      // ⚠️ 保留 settings.json 和 noah-ark.db，不清除用户配置
      const preserveFiles = ['settings.json', 'noah-ark.db'];
      const items = fs.readdirSync(userDataDir);
      for (const item of items) {
        if (item === '.clear-old-data') continue; // 标记文件最后删除
        if (preserveFiles.includes(item)) {
          console.log(`[Electron] 保留: ${item}`);
          continue;
        }
        const itemPath = path.join(userDataDir, item);
        fs.rmSync(itemPath, { recursive: true, force: true });
      }
      fs.unlinkSync(flagPath); // 删除标记文件
      console.log('[Electron] 旧数据已清除（保留 settings.json 和数据库）');
    } catch (error) {
      console.error('[Electron] 清除旧数据失败:', error);
    }
  }
}

/**
 * 应用启动
 */
async function main() {
  // 清理 3 天前的旧日志文件
  cleanOldLogs(3);

  writeLog('========== 应用启动 ==========', 'info');
  writeLog(`平台: ${process.platform}, 架构: ${process.arch}`, 'info');
  writeLog(`Node版本: ${process.version}`, 'info');
  writeLog(`已打包: ${app.isPackaged}`, 'info');
  writeLog(`AppData路径: ${app.getPath('userData')}`, 'info');
  writeLog(`安装路径: ${app.getAppPath()}`, 'info');

  try {
    // 检查是否需要清除旧数据（安装程序设置的标记）
    writeLog('步骤 1/5: 检查旧数据...', 'info');
    checkAndClearOldData();

    // 加载客户端配置（服务器地址）
    writeLog('步骤 2/5: 加载客户端配置...', 'info');
    const clientConfig = loadClientConfig();
    CONFIG.serverUrl = clientConfig.serverUrl;
    writeLog(`服务器地址: ${CONFIG.serverUrl}`, 'info');

    // 启动内嵌服务
    writeLog('步骤 3/5: 启动内嵌 Next.js 服务...', 'info');
    await startEmbeddedServices();
    writeLog('startEmbeddedServices 完成', 'info');

    // 等待 Next.js 服务就绪后再创建窗口
    if (!isDev() && CONFIG.serverUrl.includes('localhost')) {
      writeLog('等待 Next.js 服务就绪...', 'info');
      const ready = await waitForServiceReady(CONFIG.serverUrl);
      if (ready) {
        writeLog('Next.js 服务已就绪', 'info');
      } else {
        writeLog('警告: 服务启动超时(40s)，将继续加载窗口', 'warn');
        console.warn('[Electron] 服务启动超时，将尝试加载窗口（可能需要刷新）');
      }
    }

    if (!isDev()) {
      writeLog('步骤 4/5: 设置开机自启动...', 'info');
      setAutoLaunch(true);
    }

    writeLog('步骤 5/5: 创建窗口和托盘...', 'info');
    createWindow();
    createTray();
    writeLog('窗口和托盘已创建', 'info');
    writeLog('========== 启动完成 ==========', 'info');

  } catch (error: any) {
    writeLog(`启动过程异常: ${error.message}`, 'error');
    writeLog(`错误堆栈: ${error.stack}`, 'error');
    // 即使出错也尝试创建窗口
    try {
      createWindow();
      createTray();
      writeLog('异常后已尝试创建窗口和托盘', 'warn');
    } catch (e2: any) {
      writeLog(`异常后创建窗口也失败: ${e2.message}`, 'error');
    }
  }

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

ipcMain.handle('restart-backend', async () => {
  console.log('[Electron] 收到重启后台服务请求');
  const result = await restartEmbeddedServices();
  // 重新加载窗口（无论成功失败）
  if (result.success) {
    mainWindow?.reload();
  }
  return result;
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

// ⚠️ 清理缓存（.next/cache + 浏览器缓存）
ipcMain.handle('clear-cache', async () => {
  console.log('[Electron] 收到清理缓存请求');
  const messages: string[] = [];

  try {
    // 1. 清理 .next/cache
    cleanNextCache();
    messages.push('Next.js 缓存已清理');
  } catch (e: any) {
    messages.push(`Next.js 缓存清理失败: ${e.message}`);
  }

  try {
    // 2. 清理浏览器缓存
    if (mainWindow) {
      await mainWindow.webContents.session.clearCache();
      messages.push('浏览器缓存已清理');
    }
  } catch (e: any) {
    messages.push(`浏览器缓存清理失败: ${e.message}`);
  }

  return { success: true, message: messages.join('；') };
});

// 单实例锁：确保只有一个 Electron 实例运行
const gotTheLock = app.requestSingleInstanceLock();

// 全局错误处理
process.on('uncaughtException', (error) => {
  try {
    const userDataDir = app.getPath('userData');
    const logDir = path.join(userDataDir, 'logs');
    const logPath = path.join(logDir, getLogFileName('startup'));
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    const line = `[${timestamp}] [FATAL] 未捕获异常: ${error.message}\n堆栈: ${error.stack}\n`;
    require('fs').mkdirSync(logDir, { recursive: true });
    require('fs').appendFileSync(logPath, line, 'utf-8');
  } catch {}
  console.error('[FATAL] 未捕获异常:', error);
});

process.on('unhandledRejection', (reason) => {
  try {
    const userDataDir = app.getPath('userData');
    const logDir = path.join(userDataDir, 'logs');
    const logPath = path.join(logDir, getLogFileName('startup'));
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    const line = `[${timestamp}] [FATAL] 未处理 Promise 拒绝: ${reason}\n`;
    require('fs').mkdirSync(logDir, { recursive: true });
    require('fs').appendFileSync(logPath, line, 'utf-8');
  } catch {}
  console.error('[FATAL] 未处理 Promise 拒绝:', reason);
});

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
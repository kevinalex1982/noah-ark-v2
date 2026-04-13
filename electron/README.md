# Electron 桌面客户端

> 诺亚宝库的 Electron 桌面包装器

---

## 架构说明

```
┌─────────────────────────────────────┐
│           Electron Shell            │
│  ┌───────────────────────────────┐  │
│  │                               │  │
│  │   Next.js 应用 (localhost:3001)│  │
│  │                               │  │
│  └───────────────────────────────┘  │
│                                     │
│  - 全屏/Kiosk 模式                  │
│  - 系统托盘                         │
│  - 窗口管理                         │
└─────────────────────────────────────┘
```

**重要**：Electron 只负责显示，**不启动**任何 Node.js 进程。

---

## 启动顺序

### 1. 启动 Next.js 后端

在 PowerShell 窗口 1：

```powershell
cd E:\work\enki\noah-ark-v2
.\start-dev.ps1
```

### 2. 启动 MQTT Broker（可选）

在 PowerShell 窗口 2：

```powershell
cd E:\work\enki\noah-ark-v2
.\start-mqtt.ps1
```

### 3. 启动 Electron

在 PowerShell 窗口 3：

```powershell
cd E:\work\enki\noah-ark-v2\electron
.\start-electron.ps1
```

---

## 功能说明

### 窗口控制

- **全屏模式**：托盘菜单 → 全屏模式
- **Kiosk 模式**：托盘菜单 → Kiosk 模式（完全锁定）
- **开发者工具**：托盘菜单 → 打开开发者工具

### 错误处理

如果后端未启动，Electron 会显示错误页面，提示启动后端服务。

---

## 文件结构

```
electron/
├── main.ts            # 主进程代码
├── preload.ts         # 预加载脚本
├── package.json       # 依赖配置
├── tsconfig.json      # TypeScript 配置
├── start-electron.ps1 # 启动脚本
└── dist/              # 编译输出
```

---

## 开发说明

### 首次运行

```powershell
cd electron
npm install
npm run build
npm start
```

### 开发模式

```powershell
npm run dev
```

### 构建生产版本

```powershell
npm run build
```

---

## 系统托盘功能

右键点击托盘图标：

- 显示窗口
- 全屏模式
- Kiosk 模式
- 打开开发者工具
- 重启应用
- 退出

---

*诺亚方舟项目组*
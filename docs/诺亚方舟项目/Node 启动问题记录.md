# Node.js 启动导致 OpenClaw 崩溃问题记录

**问题发现时间**: 2026-03-23 上午
**影响**: 启动 Next.js 开发服务器时 OpenClaw Gateway 可能崩溃

---

## 🚨 问题现象

1. 运行 `npm run dev` 启动 Next.js 开发服务器
2. OpenClaw Gateway 无响应/崩溃
3. 需要手动恢复 OpenClaw 服务

---

## 🔍 可能原因

### 1. 资源占用过高
- Next.js 开发服务器占用 ~500MB 内存
- 开发模式 (HMR) 持续监控文件变化
- 多个 Node 进程同时运行导致资源竞争

### 2. 端口冲突
- Next.js 默认端口：3000
- OpenClaw Gateway 端口：18789
- 其他服务可能占用冲突端口

### 3. 文件监控冲突
- Next.js 开发模式监控 `node_modules` 和源码
- OpenClaw 可能也监控某些文件
- 两者同时监控导致文件系统锁死

---

## ✅ 解决方案

### 方案 A：使用生产模式启动（推荐）
```bash
# 先构建
npm run build

# 再用生产模式启动（资源占用少）
npm start
```

**优点**：
- 无 HMR 开销
- 内存占用低（~100MB vs ~500MB）
- 无文件监控冲突

**缺点**：
- 代码修改后需要重新构建

---

### 方案 B：限制开发模式资源
```bash
# 使用 NODE_OPTIONS 限制内存
NODE_OPTIONS="--max-old-space-size=256" npm run dev

# 或禁用某些功能
npm run dev -- --no-hmr
```

---

### 方案 C：后台运行（避免阻塞）
```powershell
# PowerShell 后台运行
Start-Process npm -ArgumentList "run", "dev" -WindowStyle Hidden

# 或使用 pm2
pm2 start npm --name "noah-ark" -- run dev
pm2 save
```

---

## 📋 当前启动方式记录

**时间**: 2026-03-23 11:50
**方式**: `npm run build` (构建成功)
**进程**: Node 进程 4 个，总内存 ~700MB

---

## ⚠️ 注意事项

1. **避免同时运行多个开发服务器**
2. **定期清理 Node 进程**：`Get-Process node | Stop-Process`
3. **监控内存使用**：超过 1GB 时考虑重启
4. **优先使用生产模式**：`npm start` 代替 `npm run dev`

---

## 🔧 故障恢复

```bash
# 1. 停止所有 Node 进程
Get-Process node | Stop-Process -Force

# 2. 重启 OpenClaw
openclaw gateway restart

# 3. 验证状态
openclaw status

# 4. 如需启动 noah-ark，使用生产模式
cd noah-ark
npm run build
npm start
```

---

*最后更新：2026-03-23*

# 诺亚方舟项目 - 核心规则（必须永远记住！）

> **最后更新**：2026-04-17  
> **重要性**：⭐⭐⭐⭐⭐ 生死攸关的规则

---

## 🚨 第一条：启动服务的正确方式（OpenClaw 不会崩）

### ❌ 错误方式（会让 OpenClaw 崩溃！）

```powershell
# 错误 1：PTY 模式（伪终端）
exec("npm run dev", pty=true, timeout=60)
# 后果：命令超时后进程组被杀死，OpenClaw 也跟着崩！

# 错误 2：PM2 + Node v24
pm2 start npm --name "noah-ark" -- run dev
# 后果：Node v24 和 npm.cmd 不兼容（SyntaxError）
```

### ✅ 正确方式（OpenClaw 不会崩）

```powershell
# 直接用 node 运行 Next.js（推荐）
node node_modules/next/dist/bin/next dev -p 3001

# 后台运行 + 日志输出
Start-Process -FilePath "node" `
  -ArgumentList "node_modules/next/dist/bin/next", "dev", "-p", "3001" `
  -NoNewWindow `
  -RedirectStandardOutput "next.log" `
  -RedirectStandardError "next.err"
```

### 为什么正确？

```
✅ 独立进程：不在 PTY 进程组，不会被连累
✅ 日志重定向：输出到文件
✅ 后台常驻：不会超时被杀死
```

---

## 📋 第二条：数据库结构（以文档为准）

### ⭐ 不要在这里定义表结构！

**数据库表结构以以下文档为准**：
1. **数据库设计文档.md** - 完整的表结构、索引、枚举值
2. **Next.js 后端设计文档.md** - 业务逻辑说明

**核心表**：
- `credentials` - 凭证表（单表结构）
- `device_config` - 设备配置表
- `sync_queue` - 设备同步队列
- `sync_logs` - 同步日志
- `auth_log` - 认证记录表

**⚠️ 重要**：
- 不要自己重新设计表结构
- 修改表结构前先查文档
- 新增字段要同步更新所有相关文档

---

## 📍 第三条：文档位置（遇到问题先查）

| 文档 | 位置 | 用途 |
|------|------|------|
| **数据库设计文档.md** | `docs/诺亚方舟项目/` | ⭐ 数据库表结构、字段定义 |
| **Next.js 后端设计文档.md** | `docs/诺亚方舟项目/` | 业务逻辑、faceImage 处理 |
| **IAMS 模拟服务设计文档.md** | `docs/诺亚方舟项目/` | 测试数据、MQTT 下发示例 |
| **生物识别设备数据接口解析.md** | `docs/诺亚方舟项目/` | 设备对接规范、协议解析 |
| **后端 API 接口文档.md** | `docs/诺亚方舟项目/` | API 接口说明 |

---

## 🔑 第四条：核心知识点（必须记住）

### 虹膜设备 (192.168.3.202:9003)
- ✅ `needImages=1` 才能获取虹膜照片
- ✅ 虹膜图片是 BMP Base64
- ✅ 端口固定为 9003
- ✅ 下发时必须包含 faceImage（人脸照片 Base64）

### 掌纹设备 (127.0.0.1:8080)
- ✅ **必须用 `http.client`**，不能用 `requests`
- ✅ sendData 放在 URL 中，不能作为 POST body
- ✅ 服务程序：`maser_H01_wa04_V7.77.exe`

### faceImage 处理逻辑 ⭐
- **IAMS 下发时不包含 faceImage**
- **数据库不存储 faceImage**（IAMS 没下发）
- **下发到虹膜设备时，本地后端自己添加 faceImage**
- 照片内容任意（卡通、工作卡片照片都可以）

### 凭证类型枚举
| type | 名称 | 下发目标 |
|------|------|----------|
| 5 | 密码 | 无（只存数据库） |
| 7 | 虹膜 | 虹膜设备 ✅ |
| 8 | 掌纹 | 掌纹设备 ✅ |
| 9 | 胁迫码 | 无（只存数据库） |

### 认证结果枚举
| auth_result | 说明 |
|-------------|------|
| 1 | 认证成功 |
| 2 | 认证失败 |
| 9 | 胁迫报警（核心安全功能） |

---

## ⚠️ 第五条：血的教训（永远不要忘记）

### 教训 1：PTY 模式杀死进程组

**问题**：用 `exec(pty=true)` 启动 Next.js 服务  
**后果**：OpenClaw Gateway 崩溃  
**解决**：用 `Start-Process` 后台运行，进程隔离

### 教训 2：不要自己重新设计表结构

**问题**：没有查看文档，自己重新设计数据库  
**后果**：浪费时间，文档里已经有完整设计  
**解决**：先读文档，完全照搬，不要发挥

### 教训 3：Node v24 和 npm.cmd 不兼容

**问题**：用 PM2 + npm.cmd 启动服务  
**后果**：SyntaxError: Unexpected token ':'  
**解决**：直接用 `node next dev`，不用 npm.cmd

---

## 📦 第五条补充：Electron 打包规范 ⭐

### ❌ 错误方式（安装包会膨胀到 500M+）

- 直接把 `.next` 目录全部打进安装包（`.next/dev` 占 800M+）
- 打包前没有运行 `next build`

### ✅ 正确方式（安装包 200M 左右）

**打包命令**：
```powershell
cd noah-ark-v2\electron
npm run dist
```

**`electron/package.json` 中 build 脚本已配置**：
```json
"build": "cd .. && next build && cd electron && tsc"
```

流程：
1. `next build` — 生产构建 `.next`，只生成精简的 production 文件（约 20-30M）
2. `tsc` — 编译 Electron 的 TypeScript

**打包过滤器已配置**：
```json
"filter": ["**/*", "!dev/**/*", "!.next/cache/**/*"]
```

排除 `.next/dev` 和 `.next/cache`，只保留生产构建产物。

### 每次打包前检查

- [ ] 安装包大小应在 200M 左右，如果超过 300M 说明有问题
- [ ] 检查 `.next/dev` 是否被排除

### 安装包行为

- 安装程序 **不会自动清除旧数据**，除非用户主动在安装完成对话框选择"是"
- 即使清除旧数据，也会保留 `settings.json`（含认证终端设备ID）和 `noah-ark.db`（数据库），不会重置用户配置
- 首次启动时 Electron 会轮询 Next.js 服务端口，直到服务就绪后再加载窗口，不再出现"首次启动加载失败"的问题

---

## 🚀 第六条：待实现功能 ⚠️

### 6.1 MQTT 客户端模块 ✅ 已完成
**文件**：`lib/mqtt-client.ts`

**功能**：
- [x] 连接 MQTT broker
- [x] 订阅下行主题：`sys/face/{deviceId}/down/passport-add`（使用具体 deviceId，不通配）
- [x] 接收凭证下发指令
- [x] 解析 IAMS 指令格式
- [x] 存入 sync_queue 表
- [x] 消息处理时校验 deviceId 匹配，忽略非本设备消息
- [x] 修改 deviceId 后自动重新订阅

---

### 6.2 定时任务模块 ❌ 未完成
**文件**：`lib/device-sync.ts`

**功能**：
- [ ] 每分钟检查 sync_queue 表
- [ ] 筛选 status='failed' 或 'pending' 的记录
- [ ] 重新尝试下发到设备
- [ ] 更新 retry_count
- [ ] 记录到 sync_logs 表

---

### 6.3 设备状态检测 API ✅ 已完成（后端轮巡）
**文件**：`lib/device-poller.ts`

**功能**：
- [x] 后端自动轮巡掌纹设备（15 秒）和虹膜设备（30 秒）
- [x] 缓存设备状态，前端读缓存不主动请求
- [x] 使用 `globalThis.__pollerState` 防止热重载重复实例

---

### 6.4 实际下发设备模块 ✅ 已完成
**文件**：`lib/device-sync.ts`

**功能**：
- [x] 虹膜设备下发（HTTP POST + fetch，锁定→上传→解锁）
- [x] 掌纹设备下发（HTTP + http.client）
- [x] 错误处理和重试
- [x] 设备冷却机制（虹膜 10 秒冷却，防止打爆设备）

---

### 6.5 服务断开检测与自动恢复 ✅ 已完成
**文件**：`app/ServiceMonitor.tsx`

**功能**：
- [x] 前端每 30 秒 ping 后端，连续 2 次失败弹窗
- [x] 弹窗提供"启动服务"按钮，调用 Electron IPC
- [x] 启动成功后自动刷新页面
- [x] 外部 kill 进程后能正常重启（nextProcess = null 清理引用）

---

### 6.6 数据库查询优化 ✅ 已完成
**文件**：`lib/db-credentials.ts`

**功能**：
- [x] 所有凭证查询排除大字段（content、iris_left/right_image、palm_feature）
- [x] 轻字段常量 LIGHT_COLUMNS 定义
- [x] verify-password 需要 content 时传 { includeContent: true }
- [x] 解决现场 200MB/s 磁盘读取问题

---

## 📝 第七条：每次启动前检查清单

启动 Next.js 服务前，必须确认：

- [ ] 用 `node next dev`，不用 `npm run dev`
- [ ] 用 `Start-Process` 后台运行
- [ ] 日志重定向到文件
- [ ] 端口不冲突（3001）
- [ ] OpenClaw 正常运行

---

## 🚨 第九条：MQTT 订阅规则（多设备隔离）⭐⭐⭐

### ❌ 错误方式（导致多设备互相干扰！）

```typescript
// 错误：使用通配符 + 订阅，所有设备都会收到同一条指令
const topics = [
  'sys/face/+/down/passport-add',
  'sys/face/+/down/reset-passport',  // ← 危险！所有设备都收到重置指令
];
```

**后果**：两台设备安装同一个程序时，IAMS 给设备A发重置凭证库指令，设备B也会收到并清空自己的凭证库。

### ✅ 正确方式

**1. 订阅时使用具体 deviceId（不通配）**：

```typescript
const deviceId = getDeviceId();  // 从系统设置读取
const topics = [
  `sys/face/${deviceId}/down/passport-add`,
  `sys/face/${deviceId}/down/passport-update`,
  `sys/face/${deviceId}/down/passport-del`,
  `sys/face/${deviceId}/down/reset-passport`,
  `sys/face/${deviceId}/down/device-config`,
  `sys/face/${deviceId}/down/attr-set`,
];
```

**2. handleMessage 中校验 deviceId**：

```typescript
const topicDeviceId = topicParts[2];
const myDeviceId = getDeviceId();
if (topicDeviceId !== myDeviceId) {
  console.log(`忽略非本设备消息: ${topicDeviceId} != ${myDeviceId}`);
  return;
}
```

**3. 修改 deviceId 后重新订阅**：

调用 `refreshMqttSubscription()` 会先取消旧订阅，用新的 deviceId 重新订阅。

---

## ❓ 第八条：常见问题

### Q1: 掌纹设备连接失败？
**A**: 检查 `maser_H01_wa04_V7.77.exe` 是否运行

### Q2: 虹膜设备无照片返回？
**A**: 确保 `needImages=1`

### Q3: 同步任务一直 failed？
**A**: 检查设备是否在线，查看 sync_logs 表的 error 字段

### Q4: OpenClaw Gateway 崩溃？
**A**: 不要用 exec 启动 Next.js 服务，用独立 PowerShell 窗口

### Q5: 身份证号码格式？
**A**: 18 位字符串，test1 全是 1，test2 全是 2

### Q6: 认证方式按钮如何显示？
**A**: 根据 auth_type_list 动态显示，包含 2 种以上显示组合认证

### Q7: 数据库查询慢/磁盘 IO 高？
**A**: credentials 表的 content、iris_left_image、iris_right_image、palm_feature 存储 Base64 大字段。所有查询已优化为轻字段（LIGHT_COLUMNS），不再 SELECT *。

### Q8: 服务断开后重启按钮没反应？
**A**: 已修复。nextProcess.on('exit') 现在清除引用，ServiceMonitor 每 30 秒自动检测并弹窗。

---

## 📝 第九条补充：数据库查询优化 ⭐

### ❌ 错误方式（导致磁盘 200MB/s 读取）

```typescript
// 错误：SELECT * 加载所有字段，包括 Base64 图片（每张 1-3MB）
const result = await db.execute('SELECT * FROM credentials WHERE enable = 1');
```

### ✅ 正确方式

```typescript
// 列表/存在性检查/类型查询：只用轻字段
const LIGHT_COLUMNS = 'id, person_id, person_name, person_type, credential_id, type, show_info, tags, auth_model, auth_type_list, box_list, custom_id, enable, created_at, updated_at';

// 密码验证：需要 content 字段比对
const result = await db.execute({
  sql: `SELECT ${LIGHT_COLUMNS}, content FROM credentials WHERE person_id = ?`,
  args: [personId]
});
```

**核心原则**：
1. 图片/特征字段只用于写入（upsert），读取不需要
2. IAMS 下发的图片数据在 MQTT payload 中，不是从数据库查的
3. faceImage 不存数据库，下发时从文件读取添加

---

*诺亚方舟项目组 - 实践出真知*

**最后提醒**：
1. 数据库结构以《数据库设计文档.md》为准
2. 启动服务前先看这个文档
3. faceImage 是虹膜设备的要求，IAMS 下发时没有
4. 掌纹设备必须用 `http.client`，不能用 `requests`
5. 凭证查询不要 `SELECT *`，用 `LIGHT_COLUMNS` 排除大字段
6. 服务断开自动检测已内置，30 秒轮询 + 弹窗启动

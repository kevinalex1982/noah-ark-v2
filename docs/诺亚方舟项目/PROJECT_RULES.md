# 诺亚方舟项目 - 核心规则（必须永远记住！）

> **最后更新**：2026-03-25  
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

## 🚀 第六条：待实现功能 ⚠️

### 6.1 MQTT 客户端模块 ❌ 未完成
**文件**：`lib/mqtt-client.ts`

**功能**：
- [ ] 连接 MQTT broker
- [ ] 订阅下行主题：`sys/face/{deviceId}/down/passport-add`
- [ ] 接收凭证下发指令
- [ ] 解析 IAMS 指令格式
- [ ] 存入 sync_queue 表

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

### 6.3 设备状态检测 API ❌ 未完成
**文件**：`app/api/devices/status/route.ts`

**功能**：
- [ ] GET 请求返回设备在线状态
- [ ] 检测虹膜设备（HTTP 请求测试）
- [ ] 检测掌纹设备（HTTP 请求测试）

---

### 6.4 实际下发设备模块 ❌ 未完成
**文件**：`lib/device-downloader.ts`

**功能**：
- [ ] 虹膜设备下发（HTTP POST）
- [ ] 掌纹设备下发（HTTP + http.client）
- [ ] 错误处理和重试

---

## 📝 第七条：每次启动前检查清单

启动 Next.js 服务前，必须确认：

- [ ] 用 `node next dev`，不用 `npm run dev`
- [ ] 用 `Start-Process` 后台运行
- [ ] 日志重定向到文件
- [ ] 端口不冲突（3001）
- [ ] OpenClaw 正常运行

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

---

*诺亚方舟项目组 - 实践出真知*

**最后提醒**：
1. 数据库结构以《数据库设计文档.md》为准
2. 启动服务前先看这个文档
3. faceImage 是虹膜设备的要求，IAMS 下发时没有
4. 掌纹设备必须用 `http.client`，不能用 `requests`

---

### 十、IAMS 凭证下发业务逻辑 ⭐

### 10.1 凭证类型与下发规则

**凭证类型定义**：
| 类型代码 | 凭证类型 | 是否需要下发设备 | 说明 |
|----------|----------|------------------|------|
| 1 | 人脸 | ✅ 是 | 下发到虹膜设备 |
| 5 | 密码 | ❌ 否 | 只存储到数据库 |
| 7 | 虹膜 | ✅ 是 | 下发到虹膜设备 |
| 8 | 掌纹 | ✅ 是 | 下发到掌纹设备 |
| 9 | 胁迫 | ❌ 否 | 只存储到数据库 |

**下发规则**：
```typescript
// 根据凭证类型判断是否需要下发设备
function shouldSendToDevice(credentialType: number): boolean {
  return credentialType === 1 || credentialType === 7 || credentialType === 8;
}

// 根据凭证类型选择目标设备
function getTargetDevice(credentialType: number): string | null {
  switch (credentialType) {
    case 1: // 人脸
    case 7: // 虹膜
      return 'iris';
    case 8: // 掌纹
      return 'palm';
    default:
      return null;
  }
}
```

---

### 10.2 IAMS 下发流程

**场景示例**：IAMS 下发 6 个凭证，包含：
- 虹膜凭证 × 1（需要下发虹膜设备）
- 掌纹凭证 × 1（需要下发掌纹设备）
- 密码凭证 × 2（只存数据库）
- 胁迫码 × 2（只存数据库）

**处理流程**：

```
1. IAMS 通过 MQTT 下发凭证
   ↓
2. 后端接收凭证，存储到 credentials 表
   ↓
3. 判断凭证类型
   ├── 虹膜/掌纹/人脸 → 添加到 sync_queue 队列
   └── 密码/胁迫 → 只存数据库，结束
   ↓
4. 定时任务处理 sync_queue（每分钟）
   ├── 虹膜凭证 → 调用虹膜设备 API (192.168.3.202:9003)
   │              └── 设备离线 → 标记失败，等待重试
   │              └── 设备在线 → 调用成功 → 标记成功
   │
   └── 掌纹凭证 → 调用掌纹设备 API (127.0.0.1:8080)
                  └── 设备离线 → 标记失败，等待重试
                  └── 设备在线 → 调用成功 → 标记成功
   ↓
5. 记录下发日志到 sync_logs 表
```

**代码实现**：
```typescript
// lib/device-sync.ts

/**
 * 处理同步队列
 */
export async function processSyncQueue(): Promise<{
  processed: number;
  success: number;
  failed: number;
}> {
  const items = await getPendingQueueItems(50);
  
  for (const item of items) {
    const payload = JSON.parse(item.payload);
    
    // 只处理需要下发设备的凭证类型
    if (!shouldSendToDevice(payload.credentialType)) {
      await updateQueueStatus(item.id, 'success');
      continue;
    }
    
    // 根据凭证类型选择设备
    const deviceType = getTargetDevice(payload.credentialType);
    if (!deviceType) {
      await updateQueueStatus(item.id, 'success');
      continue;
    }
    
    // 调用设备 API
    const result = await sendToDevice(deviceType, payload);
    
    if (result.success) {
      await updateQueueStatus(item.id, 'success');
      await addSyncLog({
        queue_id: item.id,
        device_id: item.device_id,
        action: item.action,
        status: 'success',
        response: result.response,
        duration_ms: result.duration,
      });
    } else {
      await updateQueueStatus(item.id, 'failed', result.error);
      await addSyncLog({
        queue_id: item.id,
        device_id: item.device_id,
        action: item.action,
        status: 'failed',
        error_message: result.error,
        duration_ms: result.duration,
      });
    }
  }
}
```

---

### 10.3 凭证数量查询 ⭐

**重要**：设备上的凭证数量不是从数据库查询，而是**调用下级设备 API**获取。

#### 虹膜设备 API（文档：docs/对接协议及需求/iris_protocol.txt）

**接口**：查询人员数量
```
POST http://192.168.3.202:9003/members
Content-Type: application/json

Request Body:
{
  "count": 100,
  "key": "",
  "lastStaffNumDec": "",
  "needImages": 0
}

Response:
{
  "body": [...],  // 人员列表
  "errorCode": 0
}

// 凭证数量 = body.length
```

#### 掌纹设备 API（文档：docs/对接协议及需求/掌纹设备文档.txt）

**接口**：全部用户查询（request: 105）
```
GET http://127.0.0.1:8080/api?sendData={"request":"105"}

Response:
{
  "response": "105",
  "userNumber": 1,
  "userData": [{"userId": "cjj"}]
}

// 凭证数量 = userNumber
```

#### 实现代码

```typescript
// app/api/devices/route.ts

// 虹膜设备：POST /members
async function getIrisCredentialCount(endpoint: string): Promise<number | null> {
  const response = await fetch(`${endpoint}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      count: 100,
      key: '',
      lastStaffNumDec: '',
      needImages: 0,
    }),
    signal: AbortSignal.timeout(5000),
  });
  
  if (response.ok) {
    const data = await response.json();
    return data.body?.length ?? null;  // 凭证数量 = body.length
  }
  return null;
}

// 掌纹设备：GET /api?sendData={"request":"105"}
async function getPalmCredentialCount(endpoint: string): Promise<number | null> {
  const requestData = JSON.stringify({ request: '105' });
  const url = `${endpoint}/api?sendData=${encodeURIComponent(requestData)}`;
  
  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(5000),
  });
  
  if (response.ok) {
    const data = await response.json();
    return data.userNumber ?? null;  // 凭证数量 = userNumber
  }
  return null;
}
```

**返回格式**：
```json
{
  "success": true,
  "timestamp": "2026-03-24T16:00:00.000Z",
  "devices": [
    {
      "id": "iris-001",
      "name": "虹膜设备 1",
      "type": "iris",
      "ip": "192.168.3.202",
      "port": 9003,
      "endpoint": "http://192.168.3.202:9003",
      "status": "online",
      "lastSync": "2026-03-24T15:59:00.000Z",
      "credential_count": 15  // 虹膜设备：body.length
    },
    {
      "id": "palm-001",
      "name": "掌纹设备 1",
      "type": "palm",
      "ip": "127.0.0.1",
      "port": 8080,
      "endpoint": "http://127.0.0.1:8080",
      "status": "online",
      "lastSync": "2026-03-24T15:59:00.000Z",
      "credential_count": 8  // 掌纹设备：userNumber
    },
    {
      "id": "iris-002",
      "name": "虹膜设备 2",
      "type": "iris",
      "ip": "192.168.3.203",
      "port": 9003,
      "endpoint": "http://192.168.3.203:9003",
      "status": "offline",
      "lastSync": null,
      "credential_count": null  // 离线设备返回 null
    }
  ]
}
```

---

### 10.4 设备下发 API ⭐

#### 虹膜设备接口（docs/对接协议及需求/iris_protocol.txt）

**上传人员（下发凭证）**：
```
POST http://192.168.3.202:9003/memberSave
Content-Type: application/json

Request Body:
{
  "staffNum": "test1",
  "name": "test1",
  "faceImage": "...",          // 人脸图片 Base64
  "leftIrisImage": "...",      // 左眼虹膜图片 Base64
  "rightIrisImage": "...",     // 右眼虹膜图片 Base64
  "cardNum": "",
  "cardType": 0,
  "openDoor": 1,               // 1=能开门
  "purview": 30,               // 30=一般用户
  "singleIrisAllowed": 0
}

Response:
{
  "deviceSN": "...",
  "errorCode": 0  // 0=成功
}
```

**删除人员**：
```
POST http://192.168.3.202:9003/memberDelete
Content-Type: application/json

Request Body:
{
  "staffNum": "test1"
}

Response:
{
  "deviceSN": "...",
  "errorCode": 0  // 0=成功
}
```

#### 掌纹设备接口（docs/对接协议及需求/掌纹设备文档.txt）

**上传人员（下发凭证）**：
```
POST http://127.0.0.1:8080/api?sendData={
  "request": "101",
  "userId": "test2",
  "userName": "test2"
}

Response:
{
  "response": "101",
  "code": "200"  // 200=成功
}
```

**删除用户**：
```
POST http://127.0.0.1:8080/api?sendData={
  "request": "108",
  "userId": "test2"
}

Response:
{
  "response": "108",
  "code": "200"  // 200=成功
}
```

---

### 10.5 真实业务场景

**场景**：IAMS 下发 6 个凭证

| 序号 | 人员 | 凭证类型 | 处理方式 | 结果 |
|------|------|----------|----------|------|
| 1 | test1 | 虹膜 (7) | 下发虹膜设备 | ❌ 失败（设备离线） |
| 2 | test1 | 密码 (5) | 只存数据库 | ✅ 成功 |
| 3 | test1 | 胁迫 (9) | 只存数据库 | ✅ 成功 |
| 4 | test2 | 掌纹 (8) | 下发掌纹设备 | ✅ 成功（设备在线） |
| 5 | test2 | 密码 (5) | 只存数据库 | ✅ 成功 |
| 6 | test2 | 胁迫 (9) | 只存数据库 | ✅ 成功 |

**下发记录**：
- sync_queue 表：2 条记录（虹膜 + 掌纹）
- sync_logs 表：2 条记录（1 成功 + 1 失败）
- credentials 表：6 条记录（全部存储）

**定时任务**：
- 每 60 秒处理一次失败凭证
- 虹膜设备恢复在线后，自动重试下发

---

### 10.6 关键注意事项

1. **不要从数据库查询凭证数量** - 必须调用设备 API
2. **密码/胁迫码不需要下发设备** - 只存储到数据库
3. **设备离线时标记为失败** - 等待定时任务重试
4. **下发记录要记录到 sync_logs** - 包括成功和失败
5. **凭证类型判断要准确** - 使用 shouldSendToDevice 函数
6. **虹膜设备 API** - POST `/members`（查询）、POST `/memberSave`（下发）、POST `/memberDelete`（删除）
7. **掌纹设备 API** - GET `/api?sendData={"request":"105"}`（查询）、POST `/api?sendData={"request":"101"}`（下发）、POST `/api?sendData={"request":"108"}`（删除）

---

**最后更新**：2026-04-17  
**更新内容**：
- 添加 IAMS 凭证下发业务逻辑
- 更新凭证数量查询 API（与真实设备文档一致）
- 添加设备下发 API 接口说明（虹膜/掌纹）
- 凭证查询优化：默认排除大字段（content、iris_left/right_image、palm_feature），使用 LIGHT_COLUMNS 常量，解决磁盘 200MB/s 问题

---

### 十一、数据库查询优化 ⭐

#### 11.1 问题

`credentials` 表中存储了 Base64 编码的大数据字段（`content`、`iris_left_image`、`iris_right_image`、`palm_feature`），单条记录可达数 MB。任何 `SELECT *` 查询都会从磁盘完整读取这些字段，导致现场设备磁盘 IO 高达 200MB/s。

#### 11.2 解决方案

**轻字段常量**：
```typescript
const LIGHT_COLUMNS = 'id, person_id, person_name, person_type, credential_id, type, show_info, tags, auth_model, auth_type_list, box_list, custom_id, enable, created_at, updated_at';
```

**所有查询方法默认使用轻字段**，仅密码验证等需要 content 的场景传 `{ includeContent: true }`。

#### 11.3 图片数据来源

- **虹膜/掌纹图片**：来自 IAMS MQTT payload 的 `content` 字段，不是从数据库读取
- **faceImage（人脸照片）**：不存储数据库，下发时从 `data/face_photo_sample.txt` 读取
- **结论**：数据库的图片字段只用于持久化存储，查询时不需要加载

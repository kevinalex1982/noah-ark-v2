# 诺亚方舟后端 API 接口文档

> Next.js 后端提供的 API 接口，供前端调用
> 
> **最后更新**：2026-04-02

---

## 概述

**后端服务地址**: `http://localhost:3001` (开发环境)

**前端调用方式**: 直接调用 `/api/xxx`，Next.js 会自动转发

---

## 认证相关接口

### 1. GET `/api/auth/verify-identity` - 验证身份证

**功能**: 验证身份证号是否存在于数据库中

**请求参数**:
```
?identityId=111111111111111111
```

**响应（成功）**:
```json
{
  "success": true,
  "data": {
    "identityId": "111111111111111111",
    "personId": "111112345",
    "personName": "test1"
  }
}
```

**响应（失败）**:
```json
{
  "success": false,
  "message": "库中无此身份证信息",
  "code": "IDENTITY_NOT_FOUND"
}
```

**文件位置**: `app/api/auth/verify-identity/route.ts`

---

### 2. GET `/api/auth/types` - 获取认证方式

**功能**: 获取用户支持的认证方式列表

**请求参数**:
```
?identityId=111111111111111111
```

**响应**:
```json
{
  "success": true,
  "authTypes": [5, 7, 9]
}
```

**凭证类型说明**:
- 5 = 密码
- 7 = 虹膜
- 8 = 掌纹
- 9 = 胁迫码

**文件位置**: `app/api/auth/types/route.ts`

---

### 3. GET `/api/auth/settings` - 获取认证设置

**功能**: 获取认证相关设置（供Kiosk页面使用）

**响应**:
```json
{
  "success": true,
  "settings": {
    "authTimeout": 60,
    "successReturnTime": 10,
    "irisEndpoint": "http://192.168.3.202:9003",
    "palmEndpoint": "http://127.0.0.1:8080"
  }
}
```

**文件位置**: `app/api/auth/settings/route.ts`

---

### 4. POST `/api/auth/verify-password` - 验证密码

**功能**: 验证密码并检测胁迫码

**请求**:
```json
{
  "identityId": "111111111111111111",
  "password": "12345"
}
```

**响应（密码正确）**:
```json
{
  "success": true,
  "match": true,
  "isDuress": false,
  "personName": "张三",
  "boxList": "A1,A2"
}
```

**响应（胁迫码）**:
```json
{
  "success": true,
  "match": true,
  "isDuress": true,
  "personName": "张三",
  "boxList": "A1,A2"
}
```

**响应（密码错误）**:
```json
{
  "success": false,
  "match": false
}
```

**文件位置**: `app/api/auth/verify-password/route.ts`

---

### 5. GET `/api/auth/verify-palm` - 验证掌纹

**功能**: 根据掌纹设备返回的userId验证是否匹配当前用户

**请求参数**:
```
?userId= palm_device_user_id &identityId=111111111111111111
```

**响应（匹配）**:
```json
{
  "success": true,
  "match": true,
  "personName": "张三",
  "boxList": "A1,A2"
}
```

**响应（不匹配）**:
```json
{
  "success": true,
  "match": false
}
```

**文件位置**: `app/api/auth/verify-palm/route.ts`

---

## 设备代理接口（重要）

> ⚠️ **核心规则**：前端只调用自己的后端API，不直接调用设备API
> 
> 原因：安全问题、CORS问题、需要服务器端日志

### 6. POST `/api/device/palm/query` - 掌纹设备代理

**功能**: 代理前端请求到掌纹设备

**请求**:
```json
{
  "request": "103"
}
```

**request值说明**:
- `103` - 开始识别
- `102` - 停止识别

**响应**:
```json
{
  "success": true,
  "data": {
    "response": "103",
    "code": "100"
  }
}
```

**code值说明**:
- `100` - 未识别状态
- `200` - 识别成功，des字段为userId
- `404` - 识别失败

**文件位置**: `app/api/device/palm/query/route.ts`

---

### 7. POST `/api/device/iris/records` - 虹膜设备代理

**功能**: 查询虹膜设备识别记录

**请求**:
```json
{
  "startTime": 1712345678000,
  "endTime": 1712345698000,
  "count": 10
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "errorCode": 0,
    "body": [
      {
        "staffNum": "111111111111111111",
        "success": true,
        "type": 1,
        "createTime": 1712345680000
      }
    ]
  }
}
```

**匹配条件**:
- `staffNum === identityId`
- `success === true`
- `type === 1`（虹膜类型）

**文件位置**: `app/api/device/iris/records/route.ts`

---

## 设备相关接口

### 3. GET `/api/devices` - 获取设备列表

**功能**: 获取所有设备的状态和凭证数量

**响应**:
```json
{
  "success": true,
  "timestamp": "2026-03-24T14:00:00.000Z",
  "devices": [
    {
      "id": "iris-001",
      "name": "虹膜设备 1",
      "type": "iris",
      "endpoint": "http://192.168.3.202:9003",
      "status": "online",
      "credential_count": 1
    },
    {
      "id": "palm-001",
      "name": "掌纹设备 1",
      "type": "palm",
      "endpoint": "http://127.0.0.1:8080",
      "status": "online",
      "credential_count": 1
    }
  ]
}
```

**文件位置**: `app/api/devices/route.ts`

---

### 4. GET `/api/devices/status` - 获取设备状态

**功能**: 获取设备在线状态

**响应**:
```json
{
  "success": true,
  "devices": [
    {
      "id": "iris-001",
      "online": true
    },
    {
      "id": "palm-001",
      "online": false
    }
  ]
}
```

**文件位置**: `app/api/devices/status/route.ts`

---

### 5. POST `/api/devices/clear-credentials` - 清空设备凭证

**功能**: 清空指定设备的所有凭证

**请求**:
```json
{
  "deviceId": "palm-001"
}
```

**响应**:
```json
{
  "success": true,
  "message": "清空成功"
}
```

**文件位置**: `app/api/devices/clear-credentials/route.ts`

---

### 6. POST `/api/devices/simulate-iams` - 模拟 IAMS 下发

**功能**: 模拟 IAMS 系统下发 6 个测试凭证

**请求**: 无参数

**响应**:
```json
{
  "success": true,
  "message": "模拟 IAMS 下发完成",
  "summary": {
    "total": 6,
    "iris": 1,
    "palm": 1,
    "password": 2,
    "duress": 2
  },
  "details": [
    {
      "personName": "test1",
      "credentialType": 7,
      "targetDevice": "iris",
      "status": "queued",
      "message": "已加入下发队列（虹膜设备）"
    },
    ...
  ]
}
```

**说明**: 固定下发 6 个凭证（test1 和 test2 各 3 个）

**文件位置**: `app/api/devices/simulate-iams/route.ts`

---

## 工具接口

### 7. GET `/api/db-test` - 测试数据库连接

**功能**: 测试数据库连接是否正常

**响应**:
```json
{
  "success": true,
  "message": "数据库连接正常",
  "count": 6
}
```

**文件位置**: `app/api/db-test/route.ts`

---

## 接口清单

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/auth/verify-identity` | GET | 验证身份证 |
| `/api/auth/types` | GET | 获取认证方式 |
| `/api/auth/settings` | GET | 获取认证设置 |
| `/api/auth/verify-password` | POST | 验证密码 |
| `/api/auth/verify-palm` | GET | 验证掌纹userId |
| `/api/device/palm/query` | POST | 掌纹设备代理 |
| `/api/device/iris/records` | POST | 虹膜设备代理 |
| `/api/devices` | GET | 获取设备列表 |
| `/api/devices/status` | GET | 设备状态 |
| `/api/devices/clear-credentials` | POST | 清空凭证 |
| `/api/devices/simulate-iams` | POST | 模拟 IAMS 下发 |
| `/api/db-test` | GET | 测试数据库 |

---

## 设备协议（非后端 API）

**注意**: 以下是设备自己的接口，不是我们的后端 API

**详细协议**: 参考《掌纹设备文档.txt》和《iris_protocol.txt》

### 掌纹设备接口

- **地址**: `http://127.0.0.1:8080/api?sendData=...`
- **105**: 查询用户列表
- **110**: 下发用户特征

### 虹膜设备接口

- **地址**: `http://192.168.3.202:9003`
- 详细协议参考设备文档

---

*诺亚方舟项目组*

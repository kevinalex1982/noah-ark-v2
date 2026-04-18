# IAMS 实际指令应对策略

> 文档创建：2026-04-07
> 最后更新：2026-04-08

---

## 一、错误码定义

| 错误码 | 含义 |
|--------|------|
| 200 | 成功 |
| 402 | 系统错误 |
| 403 | 凭证库版本号不符，不执行操作 |
| 404 | 凭证不存在 |
| 405 | 凭证已经存在 |
| 406 | 设备凭证库容量已达上限 |
| 407 | 设备不支持该类型凭证 |

---

## 二、凭证类型说明

| type | 类型 | 是否需要设备 | 处理方式 |
|------|------|--------------|----------|
| 5 | 密码 | 否 | 直接操作数据库 |
| 7 | 虹膜 | 是（虹膜设备） | 先操作设备，成功后存数据库 |
| 8 | 掌纹 | 是（掌纹设备） | 先操作设备，成功后存数据库 |
| 9 | 胁迫码 | 否 | 直接操作数据库，匹配时发送告警 |

---

## 三、认证界面显示规则

### 3.1 有效认证类型计算

```
有效认证类型 = authTypeList配置 ∩ 实际凭证类型（排除胁迫码）
```

**示例**：
| 项目 | 值 |
|------|---|
| 用户编码 | 333333333333333333 |
| authTypeList 配置 | 5,7,8,9 |
| 实际凭证 | type=7(虹膜), type=8(掌纹), type=9(胁迫码) |
| 有效认证类型 | 7,8（密码5被排除，因为无密码凭证） |

### 3.2 认证选项显示规则

| 规则 | 说明 |
|------|------|
| 单独认证 | 每个有效认证类型显示一个选项 |
| 组合认证 | 有效认证类型 >= 2 时才显示 |
| 胁迫码 | 不显示在任何列表中，仅在密码输入时检测 |

### 3.3 组合认证步骤顺序

按实际凭证类型顺序生成步骤，而非 authTypeList 配置顺序。

---

## 四、胁迫码处理逻辑

### 4.1 触发条件

| 条件 | 是否触发 |
|------|----------|
| 有密码凭证(5) + 有胁迫码(9) + 输入匹配胁迫码 | ✅ 触发告警 |
| 有密码凭证(5) + 无胁迫码(9) | ❌ 正常密码验证 |
| 无密码凭证(5) + 有胁迫码(9) | ❌ 无输入入口，不触发 |

### 4.2 触发后行为

1. **认证结果**：视为正确密码，认证通过（表面显示成功）
2. **告警上报**：立即发送到 `sys/face/{deviceId}/up/warn-event`
3. **不暴露给用户**：界面显示正常认证成功，不让胁迫者察觉

### 4.3 告警消息格式

**主题**：`sys/face/{deviceId}/up/warn-event`

```json
{
    "time": 1705371902981,
    "requestId": "1705371902981",
    "deviceId": "td34jc93",
    "op": "warn-event",
    "data": {
        "warnType": 1,
        "passportId": 598,
        "createTime": 1705371902981,
        "warnLevel": 4,
        "warnEventId": 1,
        "warnContent": "胁迫码报警"
    }
}
```

### 4.4 代码位置

| 功能 | 文件 | 函数 |
|------|------|------|
| 发送告警 | `lib/mqtt-client.ts` | `sendWarnEvent()` |
| 密码验证（含胁迫码检测） | `app/api/auth/verify-password/route.ts` | `POST()` |
| 组合认证胁迫码处理 | `app/kiosk/combined/page.tsx` | `handlePasswordSubmit()` |
| 密码认证胁迫码处理 | `app/kiosk/password/page.tsx` | `handleSubmit()` |

---

## 五、新增凭证（passport-add）

### 响应主题
`sys/face/{deviceId}/up/passport-add`

### 响应格式
```json
{
    "time": 1705371902981,
    "requestId": "1705371902981",
    "deviceId": "nuoyadev",
    "op": "passport-add",
    "data": {
        "code": 200,
        "msg": "",
        "passportVer": "xxx",
        "opId": "1",
        "personType": "n"
    }
}
```

### 处理策略

| 场景 | 错误码 | 处理逻辑 |
|------|--------|----------|
| 凭证已存在 | 200 | 更新 auth_type_list 等属性 → 返回200 |
| 新增成功 | 200 | 设备操作成功 → 存数据库 → 返回200 |
| 设备操作失败 | 402 | 设备操作失败 → 不存数据库 → 返回402 |
| 系统异常 | 402 | catch异常 → 返回402 |

### 代码位置
- 密码/胁迫码：`lib/mqtt-client.ts` → `processMessage()`
- 虹膜/掌纹：`lib/device-sync.ts` → `handlePassportAdd()`

---

## 六、删除凭证（passport-del）

### 响应主题
`sys/face/{deviceId}/up/passport-del`

### 响应格式
```json
{
    "time": 1705371902981,
    "requestId": "1705371902981",
    "deviceId": "nuoyadev",
    "op": "passport-del",
    "data": {
        "code": 200,
        "msg": "",
        "passportVer": "xxx",
        "opId": "1",
        "personType": "n"
    }
}
```

### 处理策略

| 场景 | 错误码 | 处理逻辑 |
|------|--------|----------|
| 凭证不存在 | 404 | 检查数据库，发现不存在 → 直接返回404 |
| 删除成功 | 200 | 设备操作成功 → 删数据库 → 返回200 |
| 设备操作失败 | 402 | 设备操作失败 → 不删数据库 → 返回402 |
| 系统异常 | 402 | catch异常 → 返回402 |

### 代码位置
- 密码/胁迫码：`lib/mqtt-client.ts` → `processMessage()`
- 虹膜/掌纹：`lib/device-sync.ts` → `handlePassportDelete()`

---

## 七、更新凭证（passport-update）

### 响应主题
`sys/face/{deviceId}/up/passport-update`

### 响应格式
```json
{
    "time": 1705371902981,
    "requestId": "1705371902981",
    "deviceId": "nuoyadev",
    "op": "passport-update",
    "data": {
        "code": 200,
        "msg": "",
        "passportVer": "xxx",
        "opId": "1",
        "personType": "n"
    }
}
```

### 处理策略

| 场景 | 错误码 | 处理逻辑 |
|------|--------|----------|
| 凭证不存在 | 404 | 检查数据库，发现不存在 → 返回404 |
| 更新成功 | 200 | 只更新数据库属性 → 返回200 |

### 说明
- **不涉及设备操作**：只更新数据库中的属性字段
- **不涉及凭证内容**：不更新图片、特征等

### 代码位置
- `lib/device-sync.ts` → `handlePassportUpdate()`

---

## 八、特殊处理

### 8.1 凭证类型判断
```typescript
// 根据 type 判断，不是根据 deviceId
const isPassword = credentialType === 5;
const isIris = credentialType === 7;
const isPalm = credentialType === 8;
const isDuress = credentialType === 9;
```

### 8.2 设备选择
```typescript
// 虹膜(type=7) → 找虹膜设备
// 掌纹(type=8) → 找掌纹设备
// 密码/胁迫码(5/9) → 不需要设备
```

### 8.3 personName 默认值
```typescript
// IAMS 可能不传 personName，需要给默认值
personName: data.personName || data.personId || ''
```

---

## 九、日志文件

| 类型 | 位置 | 说明 |
|------|------|------|
| 接收消息 | `data/mqtt_logs/` | IAMS 下发的原始消息 |
| 响应消息 | `data/mqtt-log-reply/` | 我们发送给 IAMS 的响应 |
| 事件记录 | `data/mqttevent.json` | MQTT 事件简略记录 |

---

## 十、流程图

### 新增凭证流程
```
IAMS下发(passport-add)
    │
    ├─ 检查凭证是否存在
    │     ├─ 存在 → 更新 auth_type_list → 返回200
    │     └─ 不存在 → 继续
    │
    ├─ 判断凭证类型
    │     ├─ 密码/胁迫码 → 存数据库 → 返回200
    │     ├─ 虹膜 → 操作虹膜设备 → 成功后存数据库 → 返回200
    │     └─ 掌纹 → 操作掌纹设备 → 成功后存数据库 → 返回200
    │
    └─ 异常 → 返回402
```

### 删除凭证流程
```
IAMS下发(passport-del)
    │
    ├─ 检查凭证是否存在
    │     ├─ 不存在 → 返回404
    │     └─ 存在 → 继续
    │
    ├─ 判断凭证类型
    │     ├─ 密码/胁迫码 → 删数据库 → 返回200
    │     ├─ 虹膜 → 删虹膜设备 → 成功后删数据库 → 返回200
    │     └─ 掌纹 → 删掌纹设备 → 成功后删数据库 → 返回200
    │
    └─ 异常 → 返回402
```

---

*最后更新：2026-04-08*
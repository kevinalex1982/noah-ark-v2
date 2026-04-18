# MQTT 测试客户端设计文档

> 创建时间：2026-03-29
> 最后更新：2026-04-02
> 目标：创建独立的MQTT测试客户端，模拟IAMS下发凭证

---

## 一、IAMS 消息格式规范

### 1.1 标准消息结构

**Request:**
```json
{
    "time": 1705371902981,
    "requestId": "req-iris-add-1705371902981",
    "deviceId": "iris-device-001",
    "op": "passport-add",
    "data": {}
}
```

**Response:**
```json
{
    "time": 1705371902981,
    "requestId": "req-iris-add-1705371902981",
    "deviceId": "iris-device-001",
    "op": "passport-add",
    "data": {
        "code": 200,
        "msg": ""
    }
}
```

### 1.2 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `time` | long | 是 | 消息发起时间戳 |
| `requestId` | String | 是 | 请求唯一ID，每次请求随机生成，不允许直接将时间作为requestid |
| `deviceId` | String | 是 | 设备唯一ID |
| `op` | String | 是 | 操作类型：passport-add, passport-del, passport-update |
| `data.opId` | String | 是 | 操作ID，设备无需处理，执行完毕后返回 |
| `data.passportVer` | String | 是 | 凭证库版本号 |
| `data.personId` | String | 是 | 用户编码（18位） |
| `data.personType` | String | 是 | 人员类型：n=普通人员，v=访客 |
| `data.id` | long | 是 | 凭证唯一ID |
| `data.type` | int | 是 | 凭证类型（见下表） |
| `data.content` | String | 否 | 凭证内容 |
| `data.showInfo` | Array | 否 | 鉴权成功时屏幕展示文本 |
| `data.tags` | Array | 否 | 凭证拥有的标签ID |
| `data.startTime` | long | 否 | 有效期开始，为空代表实时生效 |
| `data.endTime` | long | 否 | 有效期结束，为空代表一直有效 |
| `data.enable` | int | 是 | 1=启用，2=禁用 |
| `data.authModel` | int | 是 | 识别模式：1=单凭证识别，2=多凭证组合识别 |
| `data.authTypeList` | String | 是 | 识别凭证类型列表，逗号分隔 |
| `data.boxList` | String | 否 | 用户箱号列表，使用\|分割 |

### 1.3 用户编码（personId）说明

⚠️ **重要约定**：
- `personId` 字段用于存储用户编码信息（18位）
- 为了规避安全风险，系统界面统一显示为**"用户编码"**
- 数据库中无 `id_card` 列，统一使用 `person_id`

**测试固定值**：
| 设备类型 | 用户编码（personId） | 说明 |
|----------|---------------------|------|
| 虹膜设备 | `111111111111111111` | 18个1 |
| 掌纹设备 | `222222222222222222` | 18个2 |

### 1.4 凭证类型对照表

| type | 类型 | content 格式 |
|------|------|-------------|
| 1 | 人脸 | 人脸图片 Base64 |
| 2 | 卡号 | 卡号 |
| 5 | 密码 | 密码明文 |
| 7 | 虹膜 | `<左眼Base64>\|==BMP-SEP==\|<右眼Base64>` 或只有 `<左眼Base64>` |
| 8 | 掌纹 | 掌纹特征 Base64 |
| 9 | 胁迫码 | 胁迫码明文 |

### 1.5 错误码

| code | 说明 |
|------|------|
| 200 | 成功 |
| 401 | 凭证不符合规范 |
| 402 | 系统错误 |
| 403 | 凭证库版本号不符 |
| 404 | 凭证不存在 |
| 406 | 设备凭证库容量已达上限 |
| 407 | 设备不支持该类型凭证 |

---

## 二、设备ID配置

| 设备类型 | deviceId | 用户编码（personId） |
|----------|----------|---------------------|
| 虹膜设备 | `iris-device-001` | `111111111111111111`（18个1） |
| 掌纹设备 | `palm-device-001` | `222222222222222222`（18个2） |

**配置位置**：`lib/sync-queue.ts` → `DEFAULT_DEVICES`

---

## 三、消息示例

### 3.1 虹膜添加 (type=7, op=passport-add)

**Topic**: `sys/face/iris-device-001/down/passport-add`

```json
{
    "time": 1705371902981,
    "requestId": "req-iris-add-1705371902981",
    "deviceId": "iris-device-001",
    "op": "passport-add",
    "data": {
        "opId": "1",
        "passportVer": "iris-device-001-1705371902981",
        "personId": "111111111111111111",
        "personType": "n",
        "id": 999999,
        "type": 7,
        "content": "<左眼虹膜Base64>|==BMP-SEP==|<右眼虹膜Base64>",
        "showInfo": ["欢迎", "测试用户"],
        "tags": [],
        "startTime": null,
        "endTime": null,
        "enable": 1,
        "authModel": 2,
        "authTypeList": "5,7,9",
        "boxList": "rc10|rc20"
    }
}
```

**规则**：
- `personId` 使用固定的用户编码：`111111111111111111`（18个1）
- `content` 存放虹膜数据，格式：`<左眼>|==BMP-SEP==|<右眼>`
- 人脸照片不通过 MQTT 传输，服务端从 `data/face_photo_sample.txt` 读取

---

### 3.2 虹膜更新 (type=7, op=passport-update)

**Topic**: `sys/face/iris-device-001/down/passport-update`

**⚠️ 注意：更新不包含 content 字段，只更新属性信息！**

```json
{
    "time": 1705371902981,
    "requestId": "req-iris-update-1705371902981",
    "deviceId": "iris-device-001",
    "op": "passport-update",
    "data": {
        "passportVer": "iris-device-001-1705371902981",
        "opId": "1",
        "personId": "111111111111111111",
        "personType": "n",
        "id": 999999,
        "type": 7,
        "showInfo": ["欢迎", "测试用户-已更新"],
        "tags": [],
        "startTime": null,
        "endTime": null,
        "enable": 1,
        "authModel": 2,
        "authTypeList": "5,7,9",
        "boxList": "rc10|rc20"
    }
}
```

**规则**：
- `personId` 必须和添加时一致（`111111111111111111`）
- **不包含 content 字段**
- **只更新数据库属性，不操作设备！**

---

### 3.3 虹膜删除 (type=7, op=passport-del)

**Topic**: `sys/face/iris-device-001/down/passport-del`

**⚠️ 注意：删除操作是 `passport-del`，消息体很简单！**

```json
{
    "time": 1705371902981,
    "requestId": "req-iris-del-1705371902981",
    "deviceId": "iris-device-001",
    "op": "passport-del",
    "data": {
        "passportVer": "iris-device-001-1705371902981",
        "opId": "1",
        "id": 999999,
        "personType": "n"
    }
}
```

**规则**：
- 只需要 `passportVer`, `opId`, `id`（凭证ID）, `personType`
- 服务端用 `credentialId` 查数据库获取 `personId`，然后删除设备

---

### 3.4 掌纹添加 (type=8, op=passport-add)

**Topic**: `sys/face/palm-device-001/down/passport-add`

```json
{
    "time": 1705371902981,
    "requestId": "req-palm-add-1705371902981",
    "deviceId": "palm-device-001",
    "op": "passport-add",
    "data": {
        "opId": "1",
        "passportVer": "palm-device-001-1705371902981",
        "personId": "222222222222222222",
        "personType": "n",
        "id": 888888,
        "type": 8,
        "content": "<掌纹特征Base64>",
        "showInfo": ["欢迎", "kevin"],
        "tags": [],
        "startTime": null,
        "endTime": null,
        "enable": 1,
        "authModel": 2,
        "authTypeList": "5,8,9",
        "boxList": "rc10|rc20"
    }
}
```

**规则**：
- `personId` 使用固定的用户编码：`222222222222222222`（18个2）
- `content` 存放掌纹特征数据

---

### 3.5 掌纹更新 (type=8, op=passport-update)

**Topic**: `sys/face/palm-device-001/down/passport-update`

**⚠️ 注意：更新不包含 content 字段！**

```json
{
    "time": 1705371902981,
    "requestId": "req-palm-update-1705371902981",
    "deviceId": "palm-device-001",
    "op": "passport-update",
    "data": {
        "passportVer": "palm-device-001-1705371902981",
        "opId": "1",
        "personId": "222222222222222222",
        "personType": "n",
        "id": 888888,
        "type": 8,
        "showInfo": ["欢迎", "kevin-已更新"],
        "tags": [],
        "startTime": null,
        "endTime": null,
        "enable": 1,
        "authModel": 2,
        "authTypeList": "5,8,9",
        "boxList": "rc10|rc20"
    }
}
```

**规则**：
- `personId` 必须和添加时一致（`222222222222222222`）
- **不包含 content 字段**
- **只更新数据库属性，不操作设备！**

---

### 3.6 掌纹删除 (type=8, op=passport-del)

**Topic**: `sys/face/palm-device-001/down/passport-del`

```json
{
    "time": 1705371902981,
    "requestId": "req-palm-del-1705371902981",
    "deviceId": "palm-device-001",
    "op": "passport-del",
    "data": {
        "passportVer": "palm-device-001-1705371902981",
        "opId": "1",
        "id": 888888,
        "personType": "n"
    }
}
```

**规则**：
- 只需要 `passportVer`, `opId`, `id`（凭证ID）, `personType`
- 服务端用 `credentialId` 查数据库获取 `personId`，然后删除设备

---

## 四、Response 消息格式

### 4.1 成功响应

**Topic**: `sys/face/{deviceId}/up/passport-add` (或 passport-del, passport-update)

```json
{
    "time": 1705371902981,
    "requestId": "req-xxx",
    "deviceId": "iris-device-001",
    "op": "passport-add",
    "data": {
        "code": 200,
        "msg": "",
        "passportVer": "iris-device-001-1705371902981",
        "opId": "1",
        "personType": "n"
    }
}
```

### 4.2 失败响应

```json
{
    "time": 1705371902981,
    "requestId": "req-xxx",
    "deviceId": "iris-device-001",
    "op": "passport-add",
    "data": {
        "code": 401,
        "msg": "凭证不符合规范",
        "passportVer": "iris-device-001-1705371902981",
        "opId": "1",
        "personType": "n"
    }
}
```

---

## 五、核心规则

### 5.1 消息格式规则

1. **严格按照 IAMS 格式**，使用 `op` + `data` 嵌套结构
2. **所有凭证数据放在 `content` 字段**：
   - 虹膜：`<左眼>|==BMP-SEP==|<右眼>`
   - 掌纹：直接放特征数据
3. **人脸照片不通过 MQTT 传输**，服务端从 `data/face_photo_sample.txt` 读取
4. **更新操作不包含 content 字段**

### 5.2 操作类型

| op | 说明 | 是否包含 content | 是否操作设备 |
|------|------|------|------|
| `passport-add` | 新增凭证 | 是 | 是（下发到设备） |
| `passport-update` | 更新凭证属性 | 否 | **否（只更新数据库）** |
| `passport-del` | 删除凭证 | 否 | 是（从设备删除） |

### 5.3 删除消息体

删除只需要 4 个字段：
- `passportVer`
- `opId`
- `id`（凭证ID）
- `personType`

### 5.4 ID 匹配规则

1. `personId` 在添加/更新时必须一致
2. 掌纹的 `personId` 必须和特征数据中的 userId 匹配

### 5.5 设备ID

| 设备类型 | deviceId |
|----------|----------|
| 虹膜设备 | `iris-device-001` |
| 掌纹设备 | `palm-device-001` |

---

## 六、6个操作的具体功能

### 6.1 虹膜添加 (passport-add, type=7)

**功能**：将虹膜凭证下发到虹膜设备

**流程**：
```
1. 从 content 解析虹膜数据（左眼|==BMP-SEP==|右眼）
2. 转换虹膜图片为 BMP 格式
3. 锁定设备 → 等待1秒 → 上传人员 → 等待500ms → 解锁设备
4. 设备成功后保存到数据库
```

**数据库操作**：设备成功后插入 credentials 表

---

### 6.2 虹膜更新 (passport-update, type=7)

**功能**：更新虹膜凭证的属性信息

**流程**：
```
1. 根据 data.id 查找数据库中的凭证
2. 更新属性字段：showInfo, tags, enable, authModel, authTypeList, boxList
3. 不操作设备
```

**⚠️ 重要**：
- **不包含 content 字段**
- **不操作设备**
- 只更新数据库属性

---

### 6.3 虹膜删除 (passport-del, type=7)

**功能**：从虹膜设备删除凭证

**流程**：
```
1. 从数据库根据 id 查找凭证，获取 personId
2. 调用设备 memberDelete 接口删除
3. 设备成功后删除数据库记录
```

**数据库操作**：设备成功后删除 credentials 表记录

---

### 6.4 掌纹添加 (passport-add, type=8)

**功能**：将掌纹凭证下发到掌纹设备

**流程**：
```
1. 从 content 获取掌纹特征数据
2. 从特征数据中提取 userId
3. 调用设备 110 接口下发
4. 设备成功后保存到数据库
```

**关键**：userId 必须和特征数据中的用户名匹配

---

### 6.5 掌纹更新 (passport-update, type=8)

**功能**：更新掌纹凭证的属性信息

**流程**：
```
1. 根据 data.id 查找数据库中的凭证
2. 更新属性字段：showInfo, tags, enable, authModel, authTypeList, boxList
3. 不操作设备
```

**⚠️ 重要**：
- **不包含 content 字段**
- **不操作设备**
- 只更新数据库属性

---

### 6.6 掌纹删除 (passport-del, type=8)

**功能**：从掌纹设备删除凭证

**流程**：
```
1. 从数据库根据 id 查找凭证，获取 palm_feature
2. 从 palm_feature 提取 userId
3. 调用设备 108 接口删除
4. 设备成功后删除数据库记录
```

---

## 七、数据库结构

### 7.1 credentials 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| person_id | VARCHAR(64) | 用户编码（18位） |
| person_name | VARCHAR(100) | 姓名 |
| person_type | CHAR(1) | 人员类型：n=普通，v=访客 |
| credential_id | BIGINT | 凭证ID |
| type | TINYINT | 凭证类型 |
| content | TEXT | 凭证内容 |
| iris_left_image | TEXT | 左眼虹膜 |
| iris_right_image | TEXT | 右眼虹膜 |
| palm_feature | TEXT | 掌纹特征 |
| custom_id | VARCHAR(128) | 自定义ID（掌纹设备的userId等） |
| show_info | TEXT | 显示信息 |
| tags | VARCHAR(255) | 标签 |
| auth_model | TINYINT | 识别模式 |
| auth_type_list | VARCHAR(64) | 识别类型列表 |
| box_list | VARCHAR(255) | 箱号列表 |
| enable | TINYINT | 启用状态 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

**⚠️ 注意**：已移除 `id_card` 列，统一使用 `person_id` 作为用户编码

**custom_id 字段说明**：
- 掌纹凭证(type=8)：存储掌纹设备上的 userId（从特征数据中提取）
- 识别时：用设备返回的 des 字段与 custom_id 比对，找到对应的 person_id
- 其他凭证：预留字段，可存储其他设备需要的自定义ID

---

## 八、测试数据文件

| 文件 | 用途 |
|------|------|
| `data/iris_user_*.json` | 虹膜测试数据（包含 irisLeftImage, irisRightImage, staffNum, name） |
| `data/palm_user_kevin.json` | 掌纹测试数据（包含 featureData, userId） |
| `data/face_photo_sample.txt` | 人脸照片（服务端读取，不下发） |

---

## 九、批量操作功能（功能7、8、9）

### 9.1 功能说明

| 功能 | 说明 |
|------|------|
| 7 | 清空所有凭证 |
| 8 | 添加测试用户1和测试用户2的凭证 |
| 9 | 添加测试用户1的完整凭证（含掌纹） |

### 9.2 功能7：清空所有凭证

**流程**：
```
1. 发送功能3（删除虹膜凭证）
2. 等待响应成功
3. 发送功能6（删除掌纹凭证）
4. 等待响应成功
5. 清空数据库 credentials 表
```

**MQTT消息**：复用现有的 passport-del 消息

### 9.3 功能8：添加测试用户凭证

#### 测试用户1（personId: 18个1）

| 凭证类型 | content | credential_id | authModel | authTypeList |
|----------|---------|---------------|-----------|--------------|
| 密码(5) | 12345 | 时间戳+5 | 2 | 5,7,9 |
| 胁迫码(9) | 54321 | 时间戳+9 | 2 | 5,7,9 |
| 虹膜(7) | 虹膜图片 | 时间戳+7 | 2 | 5,7,9 |

#### 测试用户2（personId: 18个2）

| 凭证类型 | content | credential_id | authModel | authTypeList |
|----------|---------|---------------|-----------|--------------|
| 密码(5) | 123456 | 时间戳+105 | 2 | 5,8,9 |
| 胁迫码(9) | 654321 | 时间戳+109 | 2 | 5,8,9 |
| 掌纹(8) | 掌纹特征 | 时间戳+108 | 2 | 5,8,9 |

#### 发送顺序

**测试用户1**：
```
1. 发送密码消息 → 等待响应
2. 发送胁迫码消息 → 等待响应
3. 发送虹膜消息 → 等待响应
```

**测试用户2**：
```
4. 发送密码消息 → 等待响应
5. 发送胁迫码消息 → 等待响应
6. 发送掌纹消息 → 等待响应
```

### 9.4 功能9：添加完整测试凭证（仅测试用户1）

#### 测试用户1（personId: 18个1）- 完整凭证

| 凭证类型 | content | credential_id | authModel | authTypeList |
|----------|---------|---------------|-----------|--------------|
| 密码(5) | 12345 | 时间戳+5 | 2 | 5,7,8,9 |
| 胁迫码(9) | 54321 | 时间戳+9 | 2 | 5,7,8,9 |
| 虹膜(7) | 虹膜图片 | 时间戳+7 | 2 | 5,7,8,9 |
| 掌纹(8) | 掌纹特征 | 时间戳+8 | 2 | 5,7,8,9 |

#### 发送顺序

```
1. 发送密码消息 → 等待响应
2. 发送胁迫码消息 → 等待响应
3. 发送虹膜消息 → 等待响应
4. 发送掌纹消息 → 等待响应
```

### 9.5 MQTT消息体示例

#### 密码添加消息

```json
{
    "time": 1705371902981,
    "requestId": "req-pwd-add-1705371902981",
    "deviceId": "iris-device-001",
    "op": "passport-add",
    "data": {
        "opId": "1",
        "passportVer": "iris-device-001-1705371902981",
        "personId": "111111111111111111",
        "personType": "n",
        "id": 1705371902985,
        "type": 5,
        "content": "12345",
        "showInfo": ["欢迎", "测试用户1"],
        "tags": [],
        "enable": 1,
        "authModel": 2,
        "authTypeList": "5,7,9",
        "boxList": ""
    }
}
```

#### 胁迫码添加消息

```json
{
    "time": 1705371902981,
    "requestId": "req-duress-add-1705371902981",
    "deviceId": "iris-device-001",
    "op": "passport-add",
    "data": {
        "opId": "1",
        "passportVer": "iris-device-001-1705371902981",
        "personId": "111111111111111111",
        "personType": "n",
        "id": 1705371902989,
        "type": 9,
        "content": "54321",
        "showInfo": [],
        "tags": [],
        "enable": 1,
        "authModel": 2,
        "authTypeList": "5,7,9",
        "boxList": ""
    }
}
```

### 9.6 串行发送机制

**重要**：批量操作必须串行执行，收到响应后再发送下一条

```typescript
async function sendBatchMessages(messages: Message[]) {
  for (const msg of messages) {
    // 发送消息
    await publish(msg);
    
    // 等待响应
    const response = await waitForResponse(msg.requestId, 30000);
    
    if (!response.success) {
      console.error(`消息发送失败: ${msg.requestId}`);
      // 可以选择继续或中断
    }
    
    // 延迟200ms
    await sleep(200);
  }
}
```

### 9.7 功能8和功能9的区别

| 对比项 | 功能8 | 功能9 |
|--------|-------|-------|
| 测试用户1 | 密码+胁迫码+虹膜 | 密码+胁迫码+虹膜+掌纹 |
| 测试用户2 | 密码+胁迫码+掌纹 | 无 |
| authTypeList | "5,7,9" 或 "5,8,9" | "5,7,8,9" |
| 认证选择 | 单独凭证 或 组合认证(2个) | 单独凭证 或 组合认证(3个) |

---

## 十、实现状态

### 10.1 已完成

- [x] 修改 `lib/mqtt-client.ts` - 解析 IAMS 格式消息
- [x] 修改 `lib/device-sync.ts` - handlePassportUpdate 只更新数据库
- [x] 修改 `lib/db-credentials.ts` - 添加 updateCredentialAttributes 函数
- [x] 修改 `lib/db-credentials.ts` - 添加 getCredentialByCustomId 函数
- [x] 修改 `scripts/mqtt-test-client.ts` - 按 IAMS 格式重构
- [x] 修改 `lib/sync-queue.ts` - 设备ID改为 iris-device-001, palm-device-001
- [x] 移除 `id_card` 列，使用 `person_id` 作为用户编码
- [x] 添加功能7：清空所有凭证
- [x] 添加功能8：添加测试用户凭证
- [x] 添加功能9：添加完整测试凭证
- [x] 串行发送机制实现
- [x] IAMS MQTT指令记录页面（/dashboard/mqtt-events）
- [x] 添加 `show_info` 和 `tags` 字段
- [x] 添加 `custom_id` 字段（掌纹userId映射）
- [x] 系统设置页面（/dashboard/settings）
- [x] 导航链接更新（Footer组件）

### 10.2 Kiosk认证实现（2026-04-02）

- [x] 后端代理API实现（避免前端直接调用设备）
  - `/api/device/palm/query` - 掌纹设备代理
  - `/api/device/iris/records` - 虹膜设备代理
  - `/api/auth/verify-password` - 密码验证
  - `/api/auth/verify-palm` - 掌纹userId验证
- [x] 掌纹认证页面改造
  - 发送103开始识别指令
  - 识别成功后发送102停止指令
  - 用户匹配验证
  - 超时/重试/返回时发送停止指令
- [x] 虹膜认证页面改造（调用代理API）
- [x] 设备地址配置（虹膜/掌纹endpoint可配置）

### 10.3 测试状态

| 功能 | 状态 | 日期 |
|------|------|------|
| 掌纹认证流程 | ✅ 已测试 | 2026-04-02 |
| 虹膜认证流程 | ⏳ 待测试 | - |
| 密码认证流程 | ⏳ 待测试 | - |
# IAMS 模拟服务设计文档

> 模拟 IAMS 平台下发凭证数据，用于测试 Noah Ark 后端系统
> 
> 文档版本：v2.1  
> 创建时间：2026-03-22  
> 最后更新：2026-03-25  
> **变更说明**：每个凭证单独下发，通过 personId 关联；虹膜凭证包含 faceImage

---

## 一、测试用户数据

### 1.1 用户信息

| personId | personName | authModel | authTypeList | boxList |
|----------|------------|-----------|--------------|---------|
| **111112345** | test1 | 2（多凭证组合） | 5,7,9 | rc10 |
| **222123456** | test2 | 2（多凭证组合） | 5,8,9 | rc20 |

### 1.2 凭证列表（每个凭证单独下发）

#### test1 用户的凭证（3 个凭证，分 3 次下发）

| 下发次序 | credential_id | type | 内容 | 说明 |
|----------|---------------|------|------|------|
| 第 1 次 | 111112345-type7 | 7 | 虹膜 + 人脸照片 | 虹膜凭证（下发虹膜设备） |
| 第 2 次 | 111112345-type5 | 5 | bcrypt('888888') | 正常密码（只存数据库） |
| 第 3 次 | 111112345-type9 | 9 | bcrypt('6666') | 胁迫码（只存数据库） |

#### test2 用户的凭证（3 个凭证，分 3 次下发）

| 下发次序 | credential_id | type | 内容 | 说明 |
|----------|---------------|------|------|------|
| 第 1 次 | 222123456-type8 | 8 | 掌纹 Base64 | 掌纹凭证（下发掌纹设备） |
| 第 2 次 | 222123456-type5 | 5 | bcrypt('666666') | 正常密码（只存数据库） |
| 第 3 次 | 222123456-type9 | 9 | bcrypt('5555') | 胁迫码（只存数据库） |

**凭证总计**：
- 虹膜凭证 × 1（需要下发虹膜设备，**包含 faceImage**）
- 掌纹凭证 × 1（需要下发掌纹设备）
- 密码凭证 × 2（只存数据库）
- 胁迫码 × 2（只存数据库）

---

## 二、凭证下发数据（每个凭证独立）

### 2.1 test1 用户 - 第 1 次下发（虹膜 type=7，**包含 faceImage**）

```javascript
// MQTT Publish - IAMS → 本地后端
{
  topic: `sys/face/noah_ark_01/down/passport-add`,
  payload: {
    time: 1711123456789,
    requestId: "req_001",
    deviceId: "noah_ark_01",
    op: "passport-add",
    data: {
      opId: "1",
      passportVer: "noah_ark_01_1711123456",
      personId: "111112345",           // ⭐ 用户 ID（长数字）
      personName: "test1",
      personType: "n",
      id: 111112345-type7,             // ⭐ 凭证 ID
      type: 7,                         // ⭐ 凭证类型：虹膜
      irisLeftImage: "Qk02tAQAAAAAADYEAAAoX19vXXl5es6U0dDPztDw==",
      irisRightImage: "Qk02tAQAAAAAADYEAAAo=",
      faceImage: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a...",  // ⭐ 人脸照片 Base64
      faceImageName: "face_111112345",  // ⭐ 人脸照片文件名
      authModel: 2,
      authTypeList: "5,7,9",
      boxList: "rc10",
      enable: 1
    }
  }
}
```

**⚠️ 重要说明**：
- 虹膜凭证**必须包含 `faceImage` 字段**（人脸照片 Base64）
- 这是虹膜设备的要求，用于显示用户照片
- `faceImageName` 是照片文件名（可选，但建议提供）

### 2.2 test1 用户 - 第 2 次下发（密码 type=5）

```javascript
// MQTT Publish
{
  topic: `sys/face/noah_ark_01/down/passport-add`,
  payload: {
    time: 1711123456790,
    requestId: "req_002",
    deviceId: "noah_ark_01",
    op: "passport-add",
    data: {
      opId: "2",
      passportVer: "noah_ark_01_1711123456",
      personId: "111112345",
      personName: "test1",
      personType: "n",
      id: 111112345-type5,
      type: 5,                     // ⭐ 凭证类型：密码
      content: "$2b$10$xyz...",    // bcrypt('888888')
      authModel: 2,
      authTypeList: "5,7,9",
      boxList: "rc10",
      enable: 1
    }
  }
}
```

### 2.3 test1 用户 - 第 3 次下发（胁迫码 type=9）

```javascript
// MQTT Publish
{
  topic: `sys/face/noah_ark_01/down/passport-add`,
  payload: {
    time: 1711123456791,
    requestId: "req_003",
    deviceId: "noah_ark_01",
    op: "passport-add",
    data: {
      opId: "3",
      passportVer: "noah_ark_01_1711123456",
      personId: "111112345",
      personName: "test1",
      personType: "n",
      id: 111112345-type9,
      type: 9,                     // ⭐ 凭证类型：胁迫码
      content: "$2b$10$abc...",    // bcrypt('6666')
      authModel: 2,
      authTypeList: "5,7,9",
      boxList: "rc10",
      enable: 1
    }
  }
}
```

### 2.4 test2 用户 - 第 1 次下发（掌纹 type=8）

```javascript
// MQTT Publish
{
  topic: `sys/face/noah_ark_01/down/passport-add`,
  payload: {
    time: 1711123456792,
    requestId: "req_004",
    deviceId: "noah_ark_01",
    op: "passport-add",
    data: {
      opId: "4",
      passportVer: "noah_ark_01_1711123456",
      personId: "222123456",           // ⭐ 另一个用户
      personName: "test2",
      personType: "n",
      id: 222123456-type8,
      type: 8,                         // ⭐ 凭证类型：掌纹
      palmFeature: "2eHwPbSb0D31QkC9lOlBPPNAQb04WIe8iv...",
      authModel: 2,
      authTypeList: "5,8,9",
      boxList: "rc20",
      enable: 1
    }
  }
}
```

### 2.5 test2 用户 - 第 2 次下发（密码 type=5）

```javascript
// MQTT Publish
{
  topic: `sys/face/noah_ark_01/down/passport-add`,
  payload: {
    time: 1711123456793,
    requestId: "req_005",
    deviceId: "noah_ark_01",
    op: "passport-add",
    data: {
      opId: "5",
      passportVer: "noah_ark_01_1711123456",
      personId: "222123456",
      personName: "test2",
      personType: "n",
      id: 222123456-type5,
      type: 5,
      content: "$2b$10$def...",    // bcrypt('666666')
      authModel: 2,
      authTypeList: "5,8,9",
      boxList: "rc20",
      enable: 1
    }
  }
}
```

### 2.6 test2 用户 - 第 3 次下发（胁迫码 type=9）

```javascript
// MQTT Publish
{
  topic: `sys/face/noah_ark_01/down/passport-add`,
  payload: {
    time: 1711123456794,
    requestId: "req_006",
    deviceId: "noah_ark_01",
    op: "passport-add",
    data: {
      opId: "6",
      passportVer: "noah_ark_01_1711123456",
      personId: "222123456",
      personName: "test2",
      personType: "n",
      id: 222123456-type9,
      type: 9,
      content: "$2b$10$ghi...",    // bcrypt('5555')
      authModel: 2,
      authTypeList: "5,8,9",
      boxList: "rc20",
      enable: 1
    }
  }
}
```

---

## 三、数据库存储结果

### 3.1 credentials 表数据

下发完成后，数据库中的凭证表：

| id | person_id | credential_id | type | content | 说明 |
|----|-----------|---------------|------|---------|------|
| 1 | 111112345 | 111112345-type7 | 7 | NULL | 虹膜（含 faceImage） |
| 2 | 111112345 | 111112345-type5 | 5 | $2b$10$xyz... | 正常密码 |
| 3 | 111112345 | 111112345-type9 | 9 | $2b$10$abc... | 胁迫码 |
| 4 | 222123456 | 222123456-type8 | 8 | 2eHwPbSb... | 掌纹特征 |
| 5 | 222123456 | 222123456-type5 | 5 | $2b$10$def... | 正常密码 |
| 6 | 222123456 | 222123456-type9 | 9 | $2b$10$ghi... | 胁迫码 |

**重要说明**：
- ✅ **只有一个 credentials 表**
- ✅ **每个凭证都是独立的一行**
- ✅ **通过 person_id 关联到同一个用户**
- ✅ **type 字段区分凭证类型（5=密码，7=虹膜，8=掌纹，9=胁迫码）**
- ✅ **虹膜凭证的 faceImage 存储在 iris_left_image 字段旁边（或单独字段）**

### 3.2 数据库表结构

```sql
CREATE TABLE credentials (
    id BIGINT PRIMARY KEY IDENTITY(1,1),
    person_id VARCHAR(64) NOT NULL,        -- 用户 ID（长数字格式，如 111112345）
    credential_id BIGINT NOT NULL,         -- 凭证 ID（如 111112345-type7）
    type TINYINT NOT NULL,                 -- 凭证类型
    content TEXT,                          -- 凭证内容（密码哈希/特征数据）
    iris_left_image TEXT,                  -- 虹膜左眼图像（type=7 时使用）
    iris_right_image TEXT,                 -- 虹膜右眼图像（type=7 时使用）
    face_image TEXT,                       -- ⭐ 人脸照片（type=7 时使用）
    face_image_name VARCHAR(255),          -- ⭐ 人脸照片文件名
    palm_feature TEXT,                     -- 掌纹特征（type=8 时使用）
    auth_model TINYINT,                    -- 认证模式
    auth_type_list VARCHAR(32),            -- 认证类型列表
    box_list VARCHAR(32),                  -- 设备列表
    created_at DATETIME DEFAULT GETDATE(), -- 创建时间
    updated_at DATETIME DEFAULT GETDATE(), -- 更新时间
    
    INDEX idx_person_id (person_id),
    INDEX idx_credential_id (credential_id),
    INDEX idx_type (type)
);
```

---

## 四、IAMS 模拟服务实现

### 4.1 项目结构

```
iams-mock-service/
├── index.js              # 主入口
├── config.js             # 配置
├── test-data.js          # 测试数据
├── mqtt-client.js        # MQTT 客户端
└── package.json
```

### 4.2 测试数据配置

```javascript
// test-data.js
module.exports = {
  // 凭证列表（每个凭证独立）
  credentials: [
    // test1 用户的 3 个凭证
    {
      personId: "111112345",
      personName: "test1",
      credential_id: "111112345-type7",
      type: 7,
      irisLeftImage: "Qk02tAQAAAAAADYEAAAoX19vXXl5es6U0dDPztDw==",
      irisRightImage: "Qk02tAQAAAAAADYEAAAo=",
      faceImage: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a...",  // ⭐ 人脸照片
      faceImageName: "face_111112345",
      authModel: 2,
      authTypeList: "5,7,9",
      boxList: "rc10"
    },
    {
      personId: "111112345",
      personName: "test1",
      credential_id: "111112345-type5",
      type: 5,
      content: "$2b$10$xyz...",  // bcrypt('888888')
      authModel: 2,
      authTypeList: "5,7,9",
      boxList: "rc10"
    },
    {
      personId: "111112345",
      personName: "test1",
      credential_id: "111112345-type9",
      type: 9,
      content: "$2b$10$abc...",  // bcrypt('6666')
      authModel: 2,
      authTypeList: "5,7,9",
      boxList: "rc10"
    },
    
    // test2 用户的 3 个凭证
    {
      personId: "222123456",
      personName: "test2",
      credential_id: "222123456-type8",
      type: 8,
      palmFeature: "2eHwPbSb0D31QkC9lOlBPPNAQb04WIe8iv...",
      authModel: 2,
      authTypeList: "5,8,9",
      boxList: "rc20"
    },
    {
      personId: "222123456",
      personName: "test2",
      credential_id: "222123456-type5",
      type: 5,
      content: "$2b$10$def...",  // bcrypt('666666')
      authModel: 2,
      authTypeList: "5,8,9",
      boxList: "rc20"
    },
    {
      personId: "222123456",
      personName: "test2",
      credential_id: "222123456-type9",
      type: 9,
      content: "$2b$10$ghi...",  // bcrypt('5555')
      authModel: 2,
      authTypeList: "5,8,9",
      boxList: "rc20"
    }
  ]
};
```

### 4.3 下发逻辑

```javascript
// index.js
const mqtt = require('mqtt');
const config = require('./config');
const testData = require('./test-data');

// 连接 MQTT
const client = mqtt.connect(config.mqtt);

client.on('connect', () => {
  console.log('✅ MQTT 连接成功');
  console.log('📡 开始下发凭证数据...\n');
  
  sendAllCredentials();
});

// 下发所有凭证（每个凭证独立下发）
async function sendAllCredentials() {
  for (const cred of testData.credentials) {
    console.log(`📤 下发凭证：personId=${cred.personId}, credential_id=${cred.credential_id}, type=${cred.type}`);
    
    await sendPassportAdd(cred);
    
    // 间隔 1 秒
    await sleep(config.sendInterval);
  }
  
  console.log('\n✅ 所有凭证下发完成');
  console.log(`📊 总计：${testData.credentials.length} 个凭证`);
  console.log(`   - 虹膜凭证：1 个（下发虹膜设备，含 faceImage）`);
  console.log(`   - 掌纹凭证：1 个（下发掌纹设备）`);
  console.log(`   - 密码凭证：2 个（只存数据库）`);
  console.log(`   - 胁迫码：2 个（只存数据库）`);
}

// 发送单个凭证
async function sendPassportAdd(credential) {
  const message = {
    time: Date.now(),
    requestId: `req_${Date.now()}`,
    deviceId: config.deviceId,
    op: 'passport-add',
    data: {
      opId: credential.credential_id.toString(),
      passportVer: config.passportVer,
      personId: credential.personId,
      personName: credential.personName,
      personType: 'n',
      id: credential.credential_id,
      type: credential.type,
      // 根据类型填充不同字段
      content: credential.content || null,
      irisLeftImage: credential.irisLeftImage || null,
      irisRightImage: credential.irisRightImage || null,
      faceImage: credential.faceImage || null,       // ⭐ 虹膜凭证必须包含
      faceImageName: credential.faceImageName || null, // ⭐ 虹膜凭证必须包含
      palmFeature: credential.palmFeature || null,
      authModel: credential.authModel,
      authTypeList: credential.authTypeList,
      boxList: credential.boxList,
      enable: 1,
      startTime: Date.now(),
      endTime: null,
      tags: [1],
      showInfo: ['欢迎', credential.personName]
    }
  };
  
  const topic = `sys/face/${config.deviceId}/down/passport-add`;
  
  return new Promise((resolve, reject) => {
    client.publish(topic, JSON.stringify(message), (err) => {
      if (err) {
        console.error(`❌ 下发失败`, err);
        reject(err);
      } else {
        console.log(`✅ 下发成功：personId=${credential.personId}, type=${credential.type}`);
        resolve();
      }
    });
  });
}

// 辅助函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## 五、测试验证

### 5.1 启动服务

```bash
# 进入项目目录
cd iams-mock-service

# 安装依赖
npm install

# 启动 IAMS 模拟服务
node index.js

# 输出：
✅ MQTT 连接成功
📡 开始下发凭证数据...

📤 下发凭证：personId=111112345, credential_id=111112345-type7, type=7
✅ 下发成功：personId=111112345, type=7（虹膜，含 faceImage）

📤 下发凭证：personId=111112345, credential_id=111112345-type5, type=5
✅ 下发成功：personId=111112345, type=5（密码）

📤 下发凭证：personId=111112345, credential_id=111112345-type9, type=9
✅ 下发成功：personId=111112345, type=9（胁迫码）

📤 下发凭证：personId=222123456, credential_id=222123456-type8, type=8
✅ 下发成功：personId=222123456, type=8（掌纹）

📤 下发凭证：personId=222123456, credential_id=222123456-type5, type=5
✅ 下发成功：personId=222123456, type=5（密码）

📤 下发凭证：personId=222123456, credential_id=222123456-type9, type=9
✅ 下发成功：personId=222123456, type=9（胁迫码）

✅ 所有凭证下发完成
📊 总计：6 个凭证
   - 虹膜凭证：1 个（下发虹膜设备，含 faceImage）
   - 掌纹凭证：1 个（下发掌纹设备）
   - 密码凭证：2 个（只存数据库）
   - 胁迫码：2 个（只存数据库）
```

### 5.2 数据库验证

```sql
-- 查询所有凭证
SELECT person_id, credential_id, type, 
       CASE type 
         WHEN 5 THEN '密码'
         WHEN 7 THEN '虹膜'
         WHEN 8 THEN '掌纹'
         WHEN 9 THEN '胁迫码'
         ELSE '未知'
       END AS type_name
FROM credentials
ORDER BY person_id, credential_id;

-- 结果：
-- person_id   | credential_id        | type | type_name
-- 111112345   | 111112345-type7      | 7    | 虹膜
-- 111112345   | 111112345-type5      | 5    | 密码
-- 111112345   | 111112345-type9      | 9    | 胁迫码
-- 222123456   | 222123456-type8      | 8    | 掌纹
-- 222123456   | 222123456-type5      | 5    | 密码
-- 222123456   | 222123456-type9      | 9    | 胁迫码
```

---

## 六、核心要点总结

### 6.1 单表结构

```sql
CREATE TABLE credentials (
    id BIGINT PRIMARY KEY IDENTITY(1,1),
    person_id VARCHAR(64) NOT NULL,    -- 用户 ID（长数字格式）
    credential_id BIGINT NOT NULL,     -- 凭证 ID
    type TINYINT NOT NULL,             -- 凭证类型
    content TEXT,                      -- 凭证内容
    iris_left_image TEXT,              -- 虹膜左眼
    iris_right_image TEXT,             -- 虹膜右眼
    face_image TEXT,                   -- ⭐ 人脸照片（虹膜凭证必须）
    palm_feature TEXT,                 -- 掌纹特征
    ...
);
```

### 6.2 下发方式

- ✅ **每个凭证单独下发**（独立的 MQTT 消息）
- ✅ **同一个用户的多个凭证**：多次下发，personId 相同，credential_id 不同
- ✅ **通过 type 字段区分**：5=密码，7=虹膜，8=掌纹，9=胁迫码
- ✅ **下发间隔 1 秒**：避免消息堆积
- ✅ **虹膜凭证必须包含 faceImage**：人脸照片 Base64

### 6.3 凭证下发规则

| 凭证类型 | type | 下发目标 | 特殊字段 |
|----------|------|----------|----------|
| 虹膜 | 7 | 虹膜设备 ✅ | faceImage, faceImageName |
| 掌纹 | 8 | 掌纹设备 ✅ | - |
| 密码 | 5 | 无（只存数据库） | - |
| 胁迫码 | 9 | 无（只存数据库） | - |

### 6.4 凭证类型对照表

| type | 名称 | 下发设备 | 特殊字段 |
|------|------|----------|----------|
| 5 | 密码 | ❌ 否 | content |
| 7 | 虹膜 | ✅ 是 | irisLeftImage, irisRightImage, **faceImage** |
| 8 | 掌纹 | ✅ 是 | palmFeature |
| 9 | 胁迫码 | ❌ 否 | content |

---

## 七、变更历史

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v1.0 | 2026-03-22 | 初始版本 |
| v2.0 | 2026-03-22 | 修正：每个凭证单独下发，通过 personId 关联 |
| v2.1 | 2026-03-25 | 修正：personId 用长数字，personName 用 test1/test2 |
| **v2.2** | **2026-03-25** | **新增：虹膜凭证包含 faceImage 字段，修正凭证数量为 6 个** |

---

*诺亚方舟项目组*

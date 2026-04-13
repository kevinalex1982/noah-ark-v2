# 更新说明 - 添加 faceImage 字段

> 更新时间：2026-03-25  
> 更新人：BG 项目组

---

## 背景

根据虹膜设备开发商确认：
- 虹膜设备接收凭证时**必须传输 `faceImage` 字段**（人脸照片 Base64）
- 照片内容**任意**即可（卡通、工作卡片照片都可以）
- 虹膜设备**不会验证**图片是否包含人脸
- 照片仅用于显示，不做识别用途

---

## ⭐ 重要说明：faceImage 的添加时机

**IAMS → 本地后端**：
- ❌ **IAMS 下发时不需要包含 faceImage**
- ❌ **数据库 credentials 表不存储 faceImage**（因为 IAMS 没下发）

**本地后端 → 虹膜设备**：
- ✅ **下发到虹膜设备时，本地后端自己添加 faceImage**
- ✅ **faceImage 只存在于 sync_queue 的 payload 中**（下发给设备时用）

**数据流向**：
```
IAMS 平台
    ↓ (MQTT passport-add，不含 faceImage)
本地后端 → 存储到 credentials 表（不含 face_image 字段）
    ↓ (添加到 sync_queue，此时添加 faceImage)
虹膜设备（收到含 faceImage 的数据）
```

---

## 更新内容

### 1. 数据库表结构更新

**文件**：`noah-ark-v2/lib/database.ts`

**新增字段**：
```sql
face_image TEXT,                   -- 人脸照片 Base64（虹膜凭证使用）
face_image_name VARCHAR(255),      -- 人脸照片文件名
```

**说明**：虽然 IAMS 下发时没有 faceImage，但数据库保留这两个字段，以备将来 IAMS 可能下发 faceImage。

### 2. 凭证类型定义更新

**文件**：`noah-ark-v2/lib/db-credentials.ts`

**更新内容**：
- Credential 接口添加 `face_image` 和 `face_image_name` 字段
- upsertCredential 函数支持 `face_image` 和 `face_image_name` 参数（可选）

### 3. 模拟 IAMS 下发 API 更新

**文件**：`noah-ark-v2/app/api/devices/simulate-iams/route.ts`

**更新内容**：
- 添加 `SAMPLE_FACE_IMAGE` 常量（示例人脸照片 Base64）
- **存储到数据库时**：不包含 face_image（模拟 IAMS 下发）
- **下发到虹膜设备时**：在 sync_queue payload 中添加 faceImage 和 faceImageName

### 4. 示例人脸照片

**文件**：`noah-ark-v2/data/face_photo_sample.txt`

**说明**：示例人脸照片 Base64 编码（卡通/工作卡片照片）

---

## 凭证下发规则

| 凭证类型 | type | 下发目标 | 特殊字段 |
|----------|------|----------|----------|
| 虹膜 | 7 | 虹膜设备 ✅ | faceImage, faceImageName（设备下发时添加） |
| 掌纹 | 8 | 掌纹设备 ✅ | - |
| 密码 | 5 | 无（只存数据库） | - |
| 胁迫码 | 9 | 无（只存数据库） | - |

---

## 测试凭证数量

**总计 6 个凭证**：
- 虹膜凭证 × 1（下发虹膜设备，**faceImage 在设备下发时添加**）
- 掌纹凭证 × 1（下发掌纹设备）
- 密码凭证 × 2（只存数据库）
- 胁迫码 × 2（只存数据库）

---

## 相关文档

以下文档已同步更新：
1. ✅ Next.js 后端设计文档.md
2. ✅ IAMS 模拟服务设计文档.md
3. ✅ 数据库设计文档 1.0.md

---

## 代码示例

### 1. IAMS 下发 → 存储到数据库（不含 faceImage）

```typescript
// 模拟 IAMS 下发凭证
await upsertCredential({
  person_id: "111112345",
  person_name: "test1",
  credential_id: "111112345-type7",
  type: 7,  // 虹膜
  iris_left_image: "base64_iris_left_111112345",
  iris_right_image: "base64_iris_right_111112345",
  // ⭐ 注意：这里不传 face_image，因为 IAMS 下发时没有
  auth_type_list: JSON.stringify([7]),
});
```

### 2. 数据库 → 虹膜设备（添加 faceImage）

```typescript
// 添加到同步队列（下发到虹膜设备）
await addToSyncQueue({
  message_id: `iris-${Date.now()}-111112345`,
  device_id: "iris-001",
  action: "passport-add",
  payload: {
    personId: "111112345",
    personName: "test1",
    credentialId: "111112345-type7",
    credentialType: 7,
    irisLeftImage: "base64_iris_left_111112345",
    irisRightImage: "base64_iris_right_111112345",
    faceImage: SAMPLE_FACE_IMAGE,  // ⭐ 下发到设备时添加（IAMS 下发时没有）
    faceImageName: "face_111112345",  // ⭐ 下发到设备时添加
    authTypeList: [7],
  },
  max_retries: 3,
});
```

---

## 注意事项

1. **faceImage 是虹膜设备的强制要求**，缺少该字段会导致下发失败
2. **IAMS 下发时不需要 faceImage**，faceImage 是本地后端下发到虹膜设备时自己添加的
3. faceImage 可以是任意 Base64 编码的图片（卡通、工作卡片照片都可以）
4. faceImageName 是照片文件名，建议格式：`face_{personId}`
5. 密码和胁迫码凭证**不需要** faceImage 字段

---

*诺亚方舟项目组*

# AES 加密方案记录

## 背景

IAMS 平台下发的凭证数据中，**用户编码（personId / staffNum）是 AES 加密后的密文**。
虹膜设备识别完成后，返回的也是加密后的用户编码。

## 加密参数

| 参数 | 值 |
|------|---|
| 加密方式 | AES |
| 加密模式 | ECB |
| 填充方式 | pkcs5padding |
| 数据块 | 128位 |
| 密码（密钥） | `yanqi78989789843`（16字节 = 128位） |
| 输出格式 | Base64 |
| 字符集 | UTF-8 |

## 数据流现状

```
IAMS 下发凭证（MQTT）
  → personId 已经是 AES 加密密文
  → 直接存入 credentials.person_id（存的是密文）

虹膜识别完成后
  → 设备返回 staffNum（AES 加密密文）
  → 用此密文在 credentials.person_id 中查询匹配

用户输入用户编码（kiosk 页面）
  → 目前输入的是明文数字
  → 但数据库中 person_id 存的是密文
  → ❌ 明文 ≠ 密文，无法匹配
```

## 解决方案

**不在接收 IAMS 数据时解密**，改为**在用户输入时加密**：

1. 新增 `lib/crypto.ts` 模块，实现 AES/ECB/PKCS5Padding/Base64 加密函数
2. 在 `/api/auth/verify-identity` 接口中，将用户输入的明文编码加密后再查询数据库
3. IAMS 下发的密文原样存储，不做解密处理
4. 虹膜设备返回的密文直接匹配，无需改动
5. 系统设置中新增 AES 加密开关，启用时加解密，停用时走明文流程
6. 凭证列表页支持双击用户编码查看解密明文（仅 AES 启用时有效）

### 优点
- 改动最小：只需增加一个加密函数 + 修改 verify-identity 一处
- IAMS 下发流程完全不变
- 虹膜设备识别流程完全不变
- 数据库始终存储密文，无需迁移
- 灵活可控：通过设置开关随时切换加密/明文模式

### 已实现的文件
| 文件 | 说明 |
|------|------|
| `lib/crypto.ts` | AES 加密/解密工具函数（新建） |
| `lib/settings.ts` | 新增 `aesEnabled` 字段 + `isAesEnabled()` 辅助函数 |
| `app/api/auth/verify-identity/route.ts` | 用户输入加密后查询数据库 |
| `app/api/auth/decrypt/route.ts` | 双击解密 API（新建） |
| `app/api/settings/route.ts` | 接受 `aesEnabled` 参数 |
| `app/dashboard/credentials/page.tsx` | 双击用户编码查看明文 + DecryptModal 组件 |
| `app/dashboard/settings/page.tsx` | AES 加密开关 UI（Toggle Switch） |

### 完整数据流（AES 启用时）

```
IAMS 下发凭证（MQTT）
  → personId 已经是 AES 加密密文
  → 直接存入 credentials.person_id（存的是密文）

用户输入用户编码（kiosk 页面）
  → 输入明文数字，如 "12345"
  → verify-identity API 将明文加密为 Base64 密文
  → 用密文查询数据库 credentials.person_id
  → 找到匹配记录，返回加密的 identityId

后续所有认证流程
  → identityId（密文）在 URL 中传递
  → 密码验证、虹膜匹配、掌纹匹配都用密文 identityId
  → 数据库中 person_id 也是密文，直接匹配

凭证列表页
  → 双击用户编码（密文）
  → 调用 /api/auth/decrypt API
  → 弹出模态框显示解密后的明文身份编码
```

## 设置说明

- **启用 AES**：IAMS 下发的用户编码为 AES 加密密文时开启（默认开启）
- **停用 AES**：IAMS 下发明文用户编码时使用，双击解密功能也不可用
- 修改设置后需点击"保存设置"才会生效

## 虹膜设备冷却机制

详见 `功能实现文档.md` 第二十五章

## 服务器日志查看

详见 `功能实现文档.md` 第二十五章

## 掌纹设备在线检查

- 已从 **105** 接口改为 **104** 接口（`lib/device-sync.ts:956`）

## 记录日期
2026-04-15

# MQTT虹膜测试计划（详细版）

## 一、虹膜设备

### 1.1 设备信息
- IP: 192.168.3.202
- 端口: 9003
- 协议: HTTP POST

### 1.2 虹膜添加流程（必须严格按顺序）

```
1. 调用 memberSaveState(state=1) 锁定设备
2. 等待 500ms
3. 调用 memberSave 上传数据
4. 等待 500ms
5. 调用 memberSaveState(state=0) 解锁设备
```

### 1.3 memberSave 请求参数

```json
{
  "staffNum": "人员ID",
  "cardNum": "",
  "cardType": 0,
  "faceImage": "人脸图片Base64（必须从文件读取！）",
  "leftIrisImage": "左眼虹膜BMP Base64",
  "rightIrisImage": "右眼虹膜BMP Base64",
  "name": "人员姓名",
  "openDoor": 1,
  "purview": 30,
  "purviewEndTime": 0.0,
  "purviewStartTime": 0.0,
  "singleIrisAllowed": 0
}
```

**重要**：
- 人脸图片必须从 `data/face_photo_sample.txt` 读取
- 虹膜图片必须是 BMP 格式（需要转换）
- 原始虹膜数据格式：`左眼|==BMP-SEP==|右眼`

### 1.4 虹膜删除流程

```
直接调用 memberDelete，不需要锁定！
```

```json
{
  "staffNum": "人员ID"
}
```

### 1.5 虹膜错误码

| errorCode | 含义 | 解决方案 |
|-----------|------|----------|
| 0 | 成功 | - |
| 5 | 设备未锁定 | 先调用 memberSaveState(1) |
| 6 | 左眼虹膜为空 | 检查数据 |
| 16 | 人员不存在 | 先添加 |
| 97 | 设备忙 | 等待重试 |
| 98 | 设备状态异常 | 重置设备 |

---

## 二、掌纹设备

### 2.1 设备信息
- IP: 127.0.0.1
- 端口: 8080
- 协议: HTTP POST

### 2.2 HTTP请求要求（关键！）

1. **sendData 必须放在 URL 中**，不是 POST body
2. **JSON 不能有空格**
3. **必须用 Node.js http 模块**，不能用 fetch
4. **sendData 不能 URL 编码**

正确格式：
```
POST /api?sendData={"request":"110","userId":"neo","featureData":"xxx"}
```

### 2.3 掌纹添加（110接口）

```
POST http://127.0.0.1:8080/api?sendData={"request":"110","userId":"用户ID","featureData":"特征数据"}
```

**关键**：userId 必须和 featureData 里的用户名匹配！
featureData 格式：`[Base64特征]=[用户名]^^^^^^...`

### 2.4 掌纹删除（108接口）

```
POST http://127.0.0.1:8080/api?sendData={"request":"108","userId":"用户ID"}
```

---

## 三、内存队列方案

### 3.1 数据结构

```typescript
const messageQueue: Array<{
  deviceId: string;
  action: string;
  message: any;
}> = [];

let isProcessing = false;
```

### 3.2 MQTT收到消息时

```typescript
// 加入队列
messageQueue.push({ deviceId, action, message });
console.log(`[队列] 收到 ${action}，队列长度: ${messageQueue.length}`);

// 触发处理
processQueue();
```

### 3.3 处理队列

```typescript
async function processQueue() {
  if (isProcessing) return;  // 正在处理，不重复进入
  isProcessing = true;

  while (messageQueue.length > 0) {
    const item = messageQueue.shift();
    console.log(`[队列] 处理 ${item.action}，剩余 ${messageQueue.length}`);

    await processOneMessage(item);

    // 等待200ms再处理下一个
    if (messageQueue.length > 0) {
      await sleep(200);
    }
  }

  isProcessing = false;
}
```

---

## 四、测试流程

1. 启动服务器 `npm run dev`
2. 运行测试 `node scripts/test-mqtt-iris-stress.js`
3. 观察日志：
   - `[队列] 收到 passport-add`
   - `[队列] 处理 passport-add`
   - `[设备] 虹膜下发 xxx`
   - `[队列] ✅ passport-add 成功`
   - `[队列] 等待200ms...`
   - 下一条消息...

---

## 五、修改文件

- `lib/mqtt-client.ts` - 添加内存队列逻辑
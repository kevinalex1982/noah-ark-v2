# Bug 修复记录

> 创建时间：2026-04-18
> 用途：记录近期修复的 Bug、根因分析、修复方案及心得

---

## 一、安装后启动失败 — Cannot find module dist/main.js

**现象**：安装后首次启动报错 `Cannot find module C:\...\Programs\noah-ark-electron\resources\app\main.js`

**根因**：electron-builder 的 `extraResources` 把根目录的 `package.json`（`"main": "electron/main.js"`）拷贝到了 `app/package.json`，覆盖了 electron 自带的 `package.json`（`"main": "dist/main.js"`）。导致 Electron 启动时按错误路径找 `main.js`。

**修复**：移除 `electron/package.json` 中多余的 `../package.json → app/package.json` extraResources 配置，让 electron-builder 自带的 `package.json` 生效。

**心得**：
- `extraResources` 会原样拷贝文件到 `resources/app/` 下，可能与 electron 自身打包文件冲突
- 如果根目录 `package.json` 和 electron 目录的 `package.json` 内容不一致，必须格外小心
- 排查方法：解压安装包或检查 `resources/app/package.json` 的 `main` 字段，与实际 JS 文件路径对比

---

## 二、凭证管理页面"操作"列不显示

**现象**：现场设备凭证管理页面最后一列"操作"（查看详细按钮）不可见，但 F12 开发者模式中 DOM 元素存在

**根因**：表格外层容器使用了 `overflow-hidden`，表格横向超出可视区域时，"操作"列被裁剪掉。现场设备分辨率/缩放比例不同，更容易触发。

**修复**：将表格外层容器的 `overflow-hidden` 改为 `overflow-x-auto`。同时优化列结构：去掉"人员"列（与"用户编码"重复），新增"识别模式"和"识别列表"两列。

**心得**：
- `overflow-hidden` 在固定宽度容器中会静默裁剪内容，用户看不到也滚不动
- 表格列数多、单列内容长（如 `whitespace-nowrap`）时，横向溢出是必然的
- 浏览器缓存也会让旧版 JS 被加载，但这次是纯 CSS 层面的问题

---

## 三、组合认证掌纹轮询返回"请求代码未定义"

**现象**：组合认证包含掌纹时，日志频繁出现 `[PalmProxy] 响应: {"response":"0","code":"0","des":"请求代码未定义"}`

**根因**：`app/kiosk/combined/page.tsx` 掌纹轮询时发的请求码是 `101`，而掌纹设备不识别 `101`。单独掌纹认证页面（`app/kiosk/palm/page.tsx`）用的是 `103`。

- `103`：开始识别 + 查询识别结果
- `102`：停止识别
- `101`：未定义

**修复**：将 `combined/page.tsx` 轮询中的 `request: 101` 改为 `request: 103`。同时修复了返回按钮逻辑：第一步返回跳转到 `/kiosk`（用户编码输入页），而非 `/kiosk/select`。

**心得**：
- 两个页面独立开发时容易引入不一致的魔法数字
- 请求码、指令码等应该提取为常量，而不是在每个页面硬编码
- 测试时要覆盖组合认证和单独认证两种路径

---

## 四、同一认证产生两条通行记录

**现象**：掌纹认证时，同一时间产生两条通行记录（personId 不同但时间相差 1 秒）

**根因**：掌纹设备在 polling 过程中可能连续多次返回 `code=200`，前端每次识别成功都调用 `/api/pass-log/upload`，导致重复写入。

**修复**：在 `lib/upload-pass-log.ts` 的 `uploadPassLog` 函数中，插入数据库前增加去重检查。调用新增的 `getRecentPassLogByPerson` 查询最近 5 秒内是否存在相同 `personId + credentialId + authType` 的记录，存在则跳过。

**涉及文件**：
- `lib/db-pass-logs.ts` — 新增 `getRecentPassLogByPerson` 函数
- `lib/upload-pass-log.ts` — 插入前调用去重检查

**心得**：
- 设备行为不可完全信任，轮询场景下同一状态可能被多次触发
- 数据库层面的去重是最后一道防线，前端防重复是优化
- 去重窗口要合理：太短无法防住，太长会误杀正常连续认证

---

## 五、单凭证模式下一人只显示部分认证方式

**现象**：两个人都配置了相同的 4 种凭证类型（密码、虹膜、掌纹、胁迫码），但一人显示全部认证方式按钮，另一人只显示虹膜

**根因**：`lib/database.ts` 的 `findByUserCode` 使用 `SELECT ... LIMIT 1` 只取一条凭证记录，返回该条上的 `auth_type_list`。IAMS 逐条下发凭证时，每条都带有 `auth_type_list`，但内容可能不完整。凭证入库顺序不同，`LIMIT 1` 取到的行就不同，导致认证方式显示不一致。

**修复**：改为查询该用户所有凭证行的 `auth_type_list` 并取**并集**，不再依赖 `LIMIT 1` 随机取到的单条记录。

**心得**：
- `LIMIT 1` 在没有 `ORDER BY` 时返回哪一行是不可预测的
- 多行数据合并（并集）比取单行更可靠
- 设计时要考虑 IAMS 的逐条下发行为，每条凭证的属性字段可能不一致

---

## 六、设备连接失败返回 401 状态码

**现象**：掌纹和虹膜设备连接不上时，代理 API 返回 500 状态码，IAMS 无法区分是设备不可用还是服务端异常。

**根因**：`app/api/device/palm/query/route.ts` 和 `app/api/device/iris/records/route.ts` 在请求失败或超时returning 500 状态码。

**修复**：
- 掌纹代理：`error` 和 `timeout` 回调改为返回 401 + `"连接不上"`
- 虹膜代理：`fetch` catch 块改为返回 401 + `"连接不上"`

**心得**：
- 401 更适合表示"设备认证/连接失败"，IAMS 可以据此判断设备离线
- 500 应保留给真正的服务端内部异常

---

## 七、掌纹设备注册失败时错误信息透传 IAMS

**现象**：掌纹设备注册返回 404（如用户已存在）时，返回给 IAMS 的错误信息是包裹后的 `"掌纹设备返回错误：{...}"`，IAMS 无法读取设备原始的 msg/des 字段。

**根因**：`lib/device-sync.ts` 的 `syncToPalmDeviceMQTT` 函数在设备返回非 200 时，将完整 JSON 包装在自定义错误信息中。而 `lib/mqtt-client.ts` 使用 `result.code ?? (result.success ? 200 : 500)` 提取响应码，没有 `code` 字段时默认 500。

**修复**：
- 提取设备返回的 `msg` 或 `des` 字段作为错误信息，不再包裹
- 同时返回 `code: 401`，mqtt-client 会将其透传给 IAMS
- `deleteFromPalmDeviceMQTT` 也做了同样修改

**涉及文件**：
- `lib/device-sync.ts` — `syncToPalmDeviceMQTT` 和 `deleteFromPalmDeviceMQTT`

**心得**：
- 设备端错误信息应该直接透传，不要二次包装
- `code` 字段需要显式返回，mqtt-client 才会使用它而非默认 200/500
- 401 表示"设备侧认证/授权失败"（如用户已存在、凭证无效等）

---

## 八、虹膜认证 identityId 明文与设备加密值比对不匹配

**现象**：虹膜单独认证和组合认证时，用户输入正确的身份编码后，虹膜设备返回识别记录但始终提示"识别到其他人"，认证无法成功。

**根因**：用户输入的 `identityId` 是明文（如 `nuoyadev`），通过 URL 参数传递到前端各认证页面。虹膜设备返回的 `staffNum` 是 IAMS 下发的 AES 加密值（如 `qikMVt8naWgLYk2tSlAHLoywISNqRqQNOF+rGWVj+s4=`）。前端直接比对 `record.staffNum === identityId`，明文 ≠ 密文，永远不匹配。

**数据库中的凭证值**：IAMS 下发时是加密值，存入数据库的也是加密值。只有用户输入环节用的是明文。

**修复**：
- 新增 `app/api/device/iris/verify/route.ts` 服务端验证接口
- 前端将设备返回的 `records` 数组和明文 `identityId` 发送到服务端
- 服务端用 `aesEncrypt(identityId)` 加密后再与 `record.staffNum` 比对
- 修改 `app/kiosk/iris/page.tsx`（单独认证）和 `app/kiosk/combined/page.tsx`（组合认证），改为调用服务端验证接口

**涉及文件**：
- `app/api/device/iris/verify/route.ts` — 新增，服务端比对
- `app/kiosk/iris/page.tsx` — 单独认证页，改用服务端验证
- `app/kiosk/combined/page.tsx` — 组合认证页，改用服务端验证

**心得**：
- 加密/解密的边界要清晰：数据库存密文、设备用密文、用户输明文
- 所有服务端查询/比对必须用加密后的值
- 前端不能直接拿明文和设备返回值做比对

---

## 九、虹膜轮询时间窗口覆盖不足导致漏记

**现象**：服务端日志显示多个虹膜查询请求几乎同时到达（startTime 相差仅几毫秒），但轮询间隔应为 3 秒。设备返回同一条记录重复推送。

**根因**：`startTime` 时间窗口设为 3 秒，轮询间隔也是 3 秒。如果请求有网络延迟，两次轮询的时间窗口之间会出现**间隙**，导致设备产生的记录落在间隙中未被捕获。

**修复**：
- 将虹膜轮询的 `startTime` 时间窗口从 3 秒扩大到 **6 秒**，每次轮询与上次有 3 秒重叠，确保无缝覆盖
- 移除 `lastCreateTime` 逻辑（统一传 0），简化为依赖时间窗口 + 服务端去重
- 组合认证页面同步修改

**心得**：
- 时间窗口应大于轮询间隔，留出网络延迟的余量
- 依赖设备侧 `createTime` 做去重不够可靠，设备时间可能与服务端不一致
- 通行记录层面已有 5 秒去重，轮询层面多做一次重叠即可

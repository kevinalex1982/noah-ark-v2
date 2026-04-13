此文档只是记录一些没有完成的任务给kevin记忆，不是给agent使用的
实现 passportVer 版本号校验 - 代码中还没实现
创建 auth_log 表 - 数据库初始化时创建
实现 pass-log 上传逻辑 - 认证完成后上传 IAMS
IAMS怎么下发虹膜数据给我


启动指令 窗口 1：启动后端
cd E:\work\enki\noah-ark-v2
.\start-dev.ps1
窗口 2：启动 MQTT（可选）
cd E:\work\enki\noah-ark-v2
.\start-mqtt.ps1
窗口 3：启动 Electron
cd E:\work\enki\noah-ark-v2\electron
.\start-electron.ps1

重启claude 时要跟它说一句 读一下开发约束文档


虹膜下发有几率超时  但是快的时候非常快 不是时间的问题，尝试过设置成60秒 该超时还是超时
超时用api 间隔时间来解决

测试 如果是同样的操作 测试最多3次好吗 不要没完没了的呀


公司公网地址 58.33.106.19  3881  mqtt  用户名: yq-device
密码: yqyq123!@#

58.33.106.19:8089是诺亚iams  

现在下发的authlist为空 所以还不能验证
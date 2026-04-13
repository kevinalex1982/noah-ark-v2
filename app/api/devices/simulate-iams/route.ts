/**
 * 模拟 IAMS 下发凭证 API
 * POST /api/devices/simulate-iams
 *
 * 下发测试凭证到设备和数据库：
 * - test1: 虹膜凭证（下发虹膜设备）
 * - test2: 掌纹凭证（下发掌纹设备，使用 kevin 的特征数据）
 * - 密码/胁迫码只存数据库，不下发设备
 *
 * 关键规则：
 * - 掌纹设备 110 接口要求 userId 必须和 featureData 里的用户名匹配
 * - 失败的下发会加入 sync_queue 等待重试
 */

import { NextResponse } from 'next/server';
import { getDeviceConfigs, addToSyncQueue, addSyncLog, updateQueueStatus } from '@/lib/sync-queue';
import { upsertCredential } from '@/lib/db-credentials';
import { syncToIrisDevice, syncToPalmDeviceMQTT } from '@/lib/device-sync';
import { initDatabase } from '@/lib/database';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// 测试身份数据
const TEST_IDENTITIES = [
  {
    personId: 'test1',
    personName: 'test1',
    authTypes: [5, 7, 9], // 密码、虹膜、胁迫
  },
  {
    personId: 'test2',
    personName: 'test2',
    authTypes: [5, 8, 9], // 密码、掌纹、胁迫
  },
];

// 示例虹膜图片（简化版）- 实际从 iris_user_*.json 文件读取
let SAMPLE_IRIS_LEFT = 'SAMPLE_IRIS_LEFT_BASE64';
let SAMPLE_IRIS_RIGHT = 'SAMPLE_IRIS_RIGHT_BASE64';
let IRIS_USER_NAME = 'test1';
let IRIS_STAFF_NUM = 'test1';
let IRIS_STAFF_NUM_DEC = '111111111111111111';

/**
 * 读取虹膜特征数据
 * 从 data/iris_user_*.json 文件读取真实虹膜图片
 */
function loadIrisData(): void {
  try {
    const dataDir = join(process.cwd(), 'data');
    const files = require('fs').readdirSync(dataDir);
    const irisFile = files.find((f: string) => f.startsWith('iris_user_') && f.endsWith('.json'));

    if (irisFile) {
      const content = require('fs').readFileSync(join(dataDir, irisFile), 'utf-8');
      const json = JSON.parse(content);

      // 文件可能是数组格式
      const userData = Array.isArray(json) ? json[0] : json;

      if (userData.irisLeftImage) {
        SAMPLE_IRIS_LEFT = userData.irisLeftImage;
        SAMPLE_IRIS_RIGHT = userData.irisRightImage || userData.irisLeftImage;
        IRIS_USER_NAME = userData.name || 'test1';
        IRIS_STAFF_NUM = userData.staffNum || 'test1';
        IRIS_STAFF_NUM_DEC = userData.staffNumDec || '111111111111111111';
        console.log(`[SimulateIAMS] 从 ${irisFile} 加载虹膜数据: ${IRIS_USER_NAME}`);
      }
    }
  } catch (error) {
    console.warn('[SimulateIAMS] 无法读取虹膜数据文件，使用默认值');
  }
}

// 启动时加载虹膜数据
loadIrisData();

/**
 * 从 featureData 末尾提取 userId
 * 掌纹设备 featureData 结构：[Base64特征数据]=[其他数据][用户名]^^^^^^^^...
 * 规则：110 下发时 userId 必须和 featureData 里的用户名匹配
 *
 * 注意：由于结构复杂，建议优先使用 JSON 中的 userId 字段
 */
function extractUserIdFromFeature(featureData: string): string | null {
  // 找到第一个 ^ 的位置
  const firstCaret = featureData.indexOf('^');
  if (firstCaret < 0) return null;

  // 从第一个 ^ 往前找用户名
  const beforeCaret = featureData.substring(0, firstCaret);

  // 用户名是 = 后面的最后一部分
  // 但由于 Base64 编码中有多个 =，我们需要找到真正的用户名
  // 通常用户名紧跟在 ^ 之前，是一个短字符串

  // 方法：从后往前找，跳过 Base64 字符（A-Za-z0-9+/=），找到用户名的开始
  // 但更简单的方法是：用户名在最后一个 = 之后，且不包含 Base64 典型模式

  const lastEq = beforeCaret.lastIndexOf('=');
  if (lastEq < 0) return beforeCaret.trim() || null;

  // = 后面的内容
  const afterEq = beforeCaret.substring(lastEq + 1);

  // 如果内容很长（>30字符），可能包含其他数据，取最后部分作为用户名
  if (afterEq.length > 30) {
    // 尝试找到用户名边界（通常用户名较短，在字符串末尾）
    // 用户名前可能有一些 Base64 填充字符
    const match = afterEq.match(/([a-zA-Z][a-zA-Z0-9_-]{2,20})$/);
    return match ? match[1] : afterEq.substring(afterEq.length - 20);
  }

  return afterEq.trim() || null;
}

/**
 * 合并虹膜图片到 content 字段
 * 新格式：用 |==BMP-SEP==| 分隔左右眼
 */
function mergeIrisToContent(leftIris: string, rightIris?: string): string {
  const SEPARATOR = '|==BMP-SEP==|';
  if (rightIris) {
    return leftIris + SEPARATOR + rightIris;
  }
  return leftIris; // 只有左眼
}

/**
 * 读取示例掌纹特征数据
 * 从 palm_user_kevin.json 文件读取
 * 返回 { featureData, userId }
 */
function getSamplePalmFeature(): { featureData: string; userId: string } {
  try {
    const dataDir = join(process.cwd(), 'data');
    const files = require('fs').readdirSync(dataDir);
    // 优先使用 palm_user_kevin.json
    const palmFile = files.find((f: string) => f.startsWith('palm_user_kevin') && f.endsWith('.json'))
      || files.find((f: string) => f.startsWith('palm_user_') && f.endsWith('.json'));

    if (palmFile) {
      const content = require('fs').readFileSync(join(dataDir, palmFile), 'utf-8');
      const json = JSON.parse(content);
      if (json.featureData) {
        // ⚠️ 重要：优先使用 JSON 中的 userId 字段
        // 因为从 featureData 中提取容易出错
        const userId = json.userId || extractUserIdFromFeature(json.featureData) || 'kevin';
        console.log(`[SimulateIAMS] 从 ${palmFile} 读取，userId: ${userId}`);
        return { featureData: json.featureData, userId };
      }
    }
  } catch (error) {
    console.warn('[SimulateIAMS] 无法读取掌纹特征文件，使用默认值');
  }
  return { featureData: 'SAMPLE_PALM_FEATURE_BASE64', userId: 'test2' };
}

/**
 * 读取示例人脸图片
 */
function getSampleFaceImage(): string {
  try {
    const filePath = join(process.cwd(), 'data', 'face_photo_sample.txt');
    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf-8').trim();
    }
  } catch (error) {
    console.warn('[SimulateIAMS] 无法读取人脸图片文件，使用默认值');
  }
  // 返回一个最小有效 JPEG
  return '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
}

export async function POST() {
  try {
    await initDatabase();

    const devices = await getDeviceConfigs();
    const irisDevice = devices.find(d => d.device_type === 'iris');
    const palmDevice = devices.find(d => d.device_type === 'palm');

    const results: {
      personName: string;
      credentialType: number;
      targetDevice: string;
      status: 'success' | 'failed' | 'skipped';
      message: string;
    }[] = [];

    let irisCount = 0;
    let palmCount = 0;
    let passwordCount = 0;
    let duressCount = 0;

    // 获取掌纹特征数据（从 palm_user_kevin.json 读取）
    const palmData = getSamplePalmFeature();
    const featurePreview = palmData.featureData.substring(0, 10) + '...';
    console.log(`[SimulateIAMS] 掌纹特征 userId: ${palmData.userId}, featureData: ${featurePreview} (长度: ${palmData.featureData.length})`);

    // 处理 test1 - 虹膜凭证
    const test1 = TEST_IDENTITIES[0];
    for (const authType of test1.authTypes) {
      const credentialId = Date.now() + authType;

      if (authType === 7) {
        // 虹膜凭证 - 使用真实的配套数据（person_id 和设备上的 staffNum 必须一致）
        // 模拟真实 MQTT 下发：数据是配套的
        const realIrisUserId = IRIS_STAFF_NUM;  // 从文件读取的真实 staffNum
        const realIrisUserName = IRIS_USER_NAME;  // 从文件读取的真实用户名

        // 新格式：虹膜数据合并到 content 字段，用 |==BMP-SEP==| 分隔
        const irisContent = mergeIrisToContent(SAMPLE_IRIS_LEFT, SAMPLE_IRIS_RIGHT);
        console.log(`[SimulateIAMS] 虹膜数据已合并到 content 字段，长度: ${irisContent.length}`);

        await upsertCredential({
          person_id: realIrisUserId,  // 使用真实的 staffNum，确保数据配套
          person_name: realIrisUserName,  // 使用真实的用户名
          person_type: 'n',
          credential_id: credentialId,
          type: 7,
          content: irisContent,  // 虹膜数据：左眼|==BMP-SEP==|右眼
          show_info: `${realIrisUserName} 虹膜凭证`,
          auth_model: 2,
          auth_type_list: test1.authTypes.join(','),
        });
        irisCount++;

        // 下发到虹膜设备
        if (irisDevice) {
          const startTime = Date.now();
          try {
            // 保存发送数据到文件（模拟下发1.json）
            const sendData = {
              staffNum: realIrisUserId,
              staffNumDec: IRIS_STAFF_NUM_DEC,
              memberName: realIrisUserName,
              irisLeftImage: SAMPLE_IRIS_LEFT,
              irisRightImage: SAMPLE_IRIS_RIGHT,
              faceImage: getSampleFaceImage(),
            };
            try {
              const dataDir = join(process.cwd(), 'data');
              if (!existsSync(dataDir)) {
                mkdirSync(dataDir, { recursive: true });
              }
              const sendFilePath = join(dataDir, '模拟下发1.json');
              writeFileSync(sendFilePath, JSON.stringify(sendData, null, 2), 'utf-8');
              console.log(`[SimulateIAMS] 数据已保存到: ${sendFilePath}`);
            } catch (e) {
              console.error('[SimulateIAMS] 保存数据文件失败:', e);
            }

            const result = await syncToIrisDevice(irisDevice.endpoint, {
              staffNum: realIrisUserId,           // 使用真实的 staffNum
              staffNumDec: IRIS_STAFF_NUM_DEC,    // 使用真实的 staffNumDec
              memberName: realIrisUserName,       // 使用真实的用户名
              irisLeftImage: SAMPLE_IRIS_LEFT,    // 真实虹膜图片
              irisRightImage: SAMPLE_IRIS_RIGHT,  // 真实虹膜图片
              faceImage: getSampleFaceImage(),    // 默认人脸图片
            });

            const durationMs = Date.now() - startTime;

            if (result.success) {
              // 成功也创建队列项并记录日志，这样下发记录里能看到
              const queueId = await addToSyncQueue({
                message_id: `sim-iris-${Date.now()}`,
                device_id: irisDevice.device_id,
                action: 'sync_iris',
                payload: {
                  staffNum: realIrisUserId,
                  staffNumDec: IRIS_STAFF_NUM_DEC,
                  memberName: realIrisUserName,
                  irisLeftImage: SAMPLE_IRIS_LEFT,
                  irisRightImage: SAMPLE_IRIS_RIGHT,
                  faceImage: getSampleFaceImage(),
                },
              });

              // 立即更新为成功
              await updateQueueStatus(queueId, 'success');

              // 记录成功日志
              await addSyncLog({
                queue_id: queueId,
                device_id: irisDevice.device_id,
                device_type: 'iris',
                action: 'sync_iris',
                status: 'success',
                response: result.response,
                duration_ms: durationMs,
              });

              results.push({
                personName: realIrisUserName,
                credentialType: authType,
                targetDevice: irisDevice.device_name,
                status: 'success',
                message: '虹膜凭证下发成功',
              });
            } else {
              // 下发失败，加入队列等待重试
              console.log(`[SimulateIAMS] 虹膜下发失败，加入队列: ${result.error}`);

              const queueId = await addToSyncQueue({
                message_id: `sim-iris-${Date.now()}`,
                device_id: irisDevice.device_id,
                action: 'sync_iris',
                payload: {
                  staffNum: realIrisUserId,
                  staffNumDec: IRIS_STAFF_NUM_DEC,
                  memberName: realIrisUserName,
                  irisLeftImage: SAMPLE_IRIS_LEFT,
                  irisRightImage: SAMPLE_IRIS_RIGHT,
                  faceImage: getSampleFaceImage(),
                },
              });

              // 记录同步日志
              await addSyncLog({
                queue_id: queueId,
                device_id: irisDevice.device_id,
                device_type: 'iris',
                action: 'sync_iris',
                status: 'failed',
                error_message: result.error,
                duration_ms: durationMs,
              });

              results.push({
                personName: realIrisUserName,
                credentialType: authType,
                targetDevice: irisDevice.device_name,
                status: 'failed',
                message: `${result.error} (已加入队列等待重试)`,
              });
            }
          } catch (error: any) {
            // 异常也加入队列
            const queueId = await addToSyncQueue({
              message_id: `sim-iris-${Date.now()}`,
              device_id: irisDevice.device_id,
              action: 'sync_iris',
              payload: {
                staffNum: realIrisUserId,
                staffNumDec: IRIS_STAFF_NUM_DEC,
                memberName: realIrisUserName,
                irisLeftImage: SAMPLE_IRIS_LEFT,
                irisRightImage: SAMPLE_IRIS_RIGHT,
                faceImage: getSampleFaceImage(),
              },
            });

            await addSyncLog({
              queue_id: queueId,
              device_id: irisDevice.device_id,
              device_type: 'iris',
              action: 'sync_iris',
              status: 'failed',
              error_message: error.message,
              duration_ms: Date.now() - startTime,
            });

            results.push({
              personName: realIrisUserName,
              credentialType: authType,
              targetDevice: irisDevice.device_name,
              status: 'failed',
              message: `${error.message} (已加入队列等待重试)`,
            });
          }
        } else {
          results.push({
            personName: realIrisUserName,
            credentialType: authType,
            targetDevice: '无虹膜设备',
            status: 'skipped',
            message: '未配置虹膜设备',
          });
        }
      } else if (authType === 5) {
        // 密码凭证
        await upsertCredential({
          person_id: test1.personId,
          person_name: test1.personName,
          person_type: 'n',
          credential_id: credentialId,
          type: 5,
          content: '123456',
          show_info: `${test1.personName} 密码凭证`,
          auth_model: 2,
          auth_type_list: test1.authTypes.join(','),
        });
        passwordCount++;
        results.push({
          personName: test1.personName,
          credentialType: authType,
          targetDevice: '数据库',
          status: 'success',
          message: '密码凭证已保存',
        });
      } else if (authType === 9) {
        // 胁迫码
        await upsertCredential({
          person_id: test1.personId,
          person_name: test1.personName,
          person_type: 'n',
          credential_id: credentialId,
          type: 9,
          content: '999999',
          show_info: `${test1.personName} 胁迫码`,
          auth_model: 2,
          auth_type_list: test1.authTypes.join(','),
        });
        duressCount++;
        results.push({
          personName: test1.personName,
          credentialType: authType,
          targetDevice: '数据库',
          status: 'success',
          message: '胁迫码已保存',
        });
      }
    }

    // 处理 test2 - 掌纹凭证（使用 kevin 的特征数据）
    const test2 = TEST_IDENTITIES[1];
    for (const authType of test2.authTypes) {
      const credentialId = Date.now() + authType + 1000;

      if (authType === 8) {
        // 掌纹凭证 - 使用真实的配套数据（person_id 和 featureData 里的 userId 必须一致）
        // 模拟真实 MQTT 下发：数据是配套的
        const realPalmUserId = palmData.userId;  // 从 featureData 提取的真实 userId

        await upsertCredential({
          person_id: realPalmUserId,  // 使用真实的 userId，确保数据配套
          person_name: realPalmUserId,  // 姓名也用 userId
          person_type: 'n',
          credential_id: credentialId,
          type: 8,
          palm_feature: palmData.featureData,
          show_info: `${realPalmUserId} 掌纹凭证`,
          auth_model: 1,
          auth_type_list: test2.authTypes.join(','),
        });
        palmCount++;

        // 下发到掌纹设备 - 使用相同的 userId
        if (palmDevice) {
          const startTime = Date.now();
          try {
            const result = await syncToPalmDeviceMQTT(palmDevice.endpoint, {
              userId: realPalmUserId,
              featureData: palmData.featureData,
            });

            const durationMs = Date.now() - startTime;

            if (result.success) {
              // 成功也创建队列项并记录日志，这样下发记录里能看到
              const queueId = await addToSyncQueue({
                message_id: `sim-palm-${Date.now()}`,
                device_id: palmDevice.device_id,
                action: 'sync_palm',
                payload: {
                  userId: realPalmUserId,
                  featureData: palmData.featureData,
                },
              });

              // 立即更新为成功
              await updateQueueStatus(queueId, 'success');

              // 记录成功日志
              await addSyncLog({
                queue_id: queueId,
                device_id: palmDevice.device_id,
                device_type: 'palm',
                action: 'sync_palm',
                status: 'success',
                response: result.response,
                duration_ms: durationMs,
              });

              results.push({
                personName: realPalmUserId,
                credentialType: authType,
                targetDevice: palmDevice.device_name,
                status: 'success',
                message: `掌纹凭证下发成功 (userId: ${realPalmUserId})`,
              });
            } else {
              // 下发失败，加入队列等待重试
              console.log(`[SimulateIAMS] 掌纹下发失败，加入队列: ${result.error}`);

              const queueId = await addToSyncQueue({
                message_id: `sim-palm-${Date.now()}`,
                device_id: palmDevice.device_id,
                action: 'sync_palm',
                payload: {
                  userId: realPalmUserId,
                  featureData: palmData.featureData,
                },
              });

              // 记录同步日志
              await addSyncLog({
                queue_id: queueId,
                device_id: palmDevice.device_id,
                device_type: 'palm',
                action: 'sync_palm',
                status: 'failed',
                error_message: result.error,
                duration_ms: durationMs,
              });

              results.push({
                personName: realPalmUserId,
                credentialType: authType,
                targetDevice: palmDevice.device_name,
                status: 'failed',
                message: `${result.error} (已加入队列等待重试)`,
              });
            }
          } catch (error: any) {
            // 异常也加入队列
            const queueId = await addToSyncQueue({
              message_id: `sim-palm-${Date.now()}`,
              device_id: palmDevice.device_id,
              action: 'sync_palm',
              payload: {
                userId: realPalmUserId,
                featureData: palmData.featureData,
              },
            });

            await addSyncLog({
              queue_id: queueId,
              device_id: palmDevice.device_id,
              device_type: 'palm',
              action: 'sync_palm',
              status: 'failed',
              error_message: error.message,
              duration_ms: Date.now() - startTime,
            });

            results.push({
              personName: realPalmUserId,
              credentialType: authType,
              targetDevice: palmDevice.device_name,
              status: 'failed',
              message: `${error.message} (已加入队列等待重试)`,
            });
          }
        } else {
          results.push({
            personName: realPalmUserId,
            credentialType: authType,
            targetDevice: '无掌纹设备',
            status: 'skipped',
            message: '未配置掌纹设备',
          });
        }
      } else if (authType === 5) {
        // 密码凭证
        await upsertCredential({
          person_id: test2.personId,
          person_name: test2.personName,
          person_type: 'n',
          credential_id: credentialId,
          type: 5,
          content: '654321',
          show_info: `${test2.personName} 密码凭证`,
          auth_model: 1,
          auth_type_list: test2.authTypes.join(','),
        });
        passwordCount++;
        results.push({
          personName: test2.personName,
          credentialType: authType,
          targetDevice: '数据库',
          status: 'success',
          message: '密码凭证已保存',
        });
      } else if (authType === 9) {
        // 胁迫码
        await upsertCredential({
          person_id: test2.personId,
          person_name: test2.personName,
          person_type: 'n',
          credential_id: credentialId,
          type: 9,
          content: '888888',
          show_info: `${test2.personName} 胁迫码`,
          auth_model: 1,
          auth_type_list: test2.authTypes.join(','),
        });
        duressCount++;
        results.push({
          personName: test2.personName,
          credentialType: authType,
          targetDevice: '数据库',
          status: 'success',
          message: '胁迫码已保存',
        });
      }
    }

    return NextResponse.json({
      success: true,
      results,
      summary: {
        total: irisCount + palmCount + passwordCount + duressCount,
        iris: irisCount,
        palm: palmCount,
        password: passwordCount,
        duress: duressCount,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[SimulateIAMS] 模拟下发失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 }
    );
  }
}
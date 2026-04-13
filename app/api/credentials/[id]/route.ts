/**
 * 单个凭证操作 API
 * DELETE /api/credentials/[id] - 删除凭证
 * PATCH /api/credentials/[id] - 更新显示信息
 * PUT /api/credentials/[id] - 更新设备同步字段
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/database';
import { deleteCredential, updateCredentialShowInfo, getCredentialById, updateCredentialFields } from '@/lib/db-credentials';
import { getDeviceConfigs, addToSyncQueue } from '@/lib/sync-queue';
import { deleteFromIrisDevice, deleteFromPalmDeviceMQTT, syncToIrisDevice } from '@/lib/device-sync';

/**
 * 从 content 解析虹膜数据
 * 格式：左眼|==BMP-SEP==|右眼 或 只有左眼
 */
function parseIrisContent(content: string): { leftIris: string; rightIris: string } {
  const SEPARATOR = '|==BMP-SEP==|';
  if (content.includes(SEPARATOR)) {
    const parts = content.split(SEPARATOR);
    return { leftIris: parts[0] || '', rightIris: parts[1] || '' };
  }
  return { leftIris: content, rightIris: '' };
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initDatabase();

    const { id } = await params;
    const credentialId = parseInt(id);
    if (isNaN(credentialId)) {
      return NextResponse.json({
        success: false,
        error: '无效的凭证ID',
      }, { status: 400 });
    }

    // 获取凭证信息
    const credential = await getCredentialById(credentialId);
    if (!credential) {
      return NextResponse.json({
        success: false,
        error: '凭证不存在',
      }, { status: 404 });
    }

    // 获取设备配置
    const devices = await getDeviceConfigs();

    // 虹膜/掌纹类型：先删设备，再删数据库
    if (credential.type === 7 || credential.type === 8) {
      const device = devices.find(d =>
        d.device_type === (credential.type === 7 ? 'iris' : 'palm')
      );

      if (device) {
        let deleteResult: { success: boolean; error?: string };

        try {
          if (credential.type === 7) {
            // 虹膜：使用 person_id 作为 staffNum
            console.log(`[Credentials] 删除虹膜凭证: staffNum=${credential.person_id}`);
            deleteResult = await deleteFromIrisDevice(device.endpoint, credential.person_id);
          } else {
            // 掌纹：从 palm_feature 提取 userId
            const featureData = credential.palm_feature || '';
            const lastEq = featureData.lastIndexOf('=');
            const firstCaret = featureData.indexOf('^');
            let userId = '';
            if (firstCaret > 0 && lastEq > 0) {
              userId = featureData.substring(lastEq + 1, firstCaret);
            } else {
              userId = credential.person_id;
            }
            console.log(`[Credentials] 删除掌纹凭证: userId=${userId}`);
            deleteResult = await deleteFromPalmDeviceMQTT(device.endpoint, userId);
          }

          if (!deleteResult.success) {
            // 设备删除失败，加入队列等待重试，数据库暂时保留
            console.log(`[Credentials] 设备删除失败，加入队列: ${deleteResult.error}`);

            const queueAction = credential.type === 7 ? 'delete_iris' : 'delete_palm';
            const queuePayload = credential.type === 7
              ? { staffNum: credential.person_id }
              : { userId: credential.person_id }; // 简化，后续可以从 palm_feature 提取

            await addToSyncQueue({
              message_id: `del-${credential.type === 7 ? 'iris' : 'palm'}-${Date.now()}`,
              device_id: device.device_id,
              action: queueAction,
              payload: queuePayload,
            });

            return NextResponse.json({
              success: false,
              error: `设备删除失败：${deleteResult.error}，已加入重试队列`,
            });
          }

          console.log(`[Credentials] 设备删除成功`);
        } catch (error: any) {
          // 异常，加入队列
          console.error(`[Credentials] 设备删除异常:`, error);

          const queueAction = credential.type === 7 ? 'delete_iris' : 'delete_palm';
          await addToSyncQueue({
            message_id: `del-${credential.type === 7 ? 'iris' : 'palm'}-${Date.now()}`,
            device_id: device.device_id,
            action: queueAction,
            payload: credential.type === 7
              ? { staffNum: credential.person_id }
              : { userId: credential.person_id },
          });

          return NextResponse.json({
            success: false,
            error: `设备删除异常：${error.message}，已加入重试队列`,
          });
        }
      }
      // 设备未配置，继续删除数据库
    }

    // 设备删除成功 或 非虹膜/掌纹类型：删除数据库
    await deleteCredential(credentialId);

    return NextResponse.json({
      success: true,
      message: '凭证已删除',
      credentialId,
    });
  } catch (error: any) {
    console.error('[Credentials] 删除凭证失败:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initDatabase();

    const { id } = await params;
    const credentialId = parseInt(id);
    if (isNaN(credentialId)) {
      return NextResponse.json({
        success: false,
        error: '无效的凭证ID',
      }, { status: 400 });
    }

    const body = await request.json();
    const { show_info } = body;

    if (show_info === undefined) {
      return NextResponse.json({
        success: false,
        error: '缺少 show_info 参数',
      }, { status: 400 });
    }

    const success = await updateCredentialShowInfo(credentialId, show_info);

    if (!success) {
      return NextResponse.json({
        success: false,
        error: '凭证不存在',
      }, { status: 404 });
    }

    const updated = await getCredentialById(credentialId);

    return NextResponse.json({
      success: true,
      message: '凭证已更新',
      credential: updated,
    });
  } catch (error: any) {
    console.error('[Credentials] 更新凭证失败:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}

/**
 * PUT /api/credentials/[id]
 * 更新设备同步字段，需要同步到设备
 *
 * 虹膜凭证 (type=7)：
 * - content: 左眼|==BMP-SEP==|右眼
 * - person_name: 姓名
 *
 * 任一设备下发相关字段变化都需要同步到设备
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initDatabase();

    const { id } = await params;
    const credentialId = parseInt(id);
    if (isNaN(credentialId)) {
      return NextResponse.json({
        success: false,
        error: '无效的凭证ID',
      }, { status: 400 });
    }

    const body = await request.json();
    const { person_name, content } = body;

    // 获取旧凭证
    const oldCredential = await getCredentialById(credentialId);
    if (!oldCredential) {
      return NextResponse.json({
        success: false,
        error: '凭证不存在',
      }, { status: 404 });
    }

    // 准备更新的值（未提供的字段保持原值）
    const newPersonName = person_name ?? oldCredential.person_name;
    const newContent = content ?? oldCredential.content;

    // 检查是否有变化
    const nameChanged = oldCredential.person_name !== newPersonName;
    const contentChanged = oldCredential.content !== newContent;
    const hasDbChanges = nameChanged || contentChanged;

    if (!hasDbChanges) {
      return NextResponse.json({
        success: true,
        message: '无变化',
        credential: oldCredential,
      });
    }

    // 更新数据库
    await updateCredentialFields(credentialId, {
      person_name: newPersonName,
      content: newContent,
    });
    console.log(`[Credentials] 更新凭证: name=${nameChanged ? '是' : '否'}, content=${contentChanged ? '是' : '否'}`);

    // 判断是否需要同步到设备
    let deviceSyncResult: { success: boolean; error?: string } | null = null;
    let needsDeviceSync = false;

    if (oldCredential.type === 7) {
      // 虹膜：检查 person_name 和 content 是否有变化
      needsDeviceSync = nameChanged || contentChanged;

      console.log(`[Credentials] 虹膜字段变化检查: name=${nameChanged}, content=${contentChanged}`);

      if (needsDeviceSync) {
        const devices = await getDeviceConfigs();
        const irisDevice = devices.find(d => d.device_type === 'iris');

        if (irisDevice) {
          console.log(`[Credentials] 同步虹膜设备更新: ${newPersonName}`);

          // 从 content 解析虹膜数据
          const { leftIris, rightIris } = parseIrisContent(newContent || '');

          try {
            // 调用 memberSave 更新（需要传入完整参数）
            deviceSyncResult = await syncToIrisDevice(irisDevice.endpoint, {
              staffNum: oldCredential.person_id,
              staffNumDec: oldCredential.person_id,
              memberName: newPersonName,
              irisLeftImage: leftIris,
              irisRightImage: rightIris,
            });

            if (!deviceSyncResult.success) {
              // 设备更新失败，加入队列
              console.log(`[Credentials] 虹膜设备更新失败，加入队列: ${deviceSyncResult.error}`);

              await addToSyncQueue({
                message_id: `update-iris-${Date.now()}`,
                device_id: irisDevice.device_id,
                action: 'sync_iris',
                payload: {
                  staffNum: oldCredential.person_id,
                  staffNumDec: oldCredential.person_id,
                  memberName: newPersonName,
                  irisLeftImage: leftIris,
                  irisRightImage: rightIris,
                },
              });
            }
          } catch (error: any) {
            console.error(`[Credentials] 虹膜设备更新异常:`, error);

            // 异常，加入队列
            await addToSyncQueue({
              message_id: `update-iris-${Date.now()}`,
              device_id: irisDevice.device_id,
              action: 'sync_iris',
              payload: {
                staffNum: oldCredential.person_id,
                staffNumDec: oldCredential.person_id,
                memberName: newPersonName,
                irisLeftImage: leftIris,
                irisRightImage: rightIris,
              },
            });

            deviceSyncResult = { success: false, error: error.message };
          }
        }
      }
    }

    const updated = await getCredentialById(credentialId);

    return NextResponse.json({
      success: true,
      message: deviceSyncResult?.success === false
        ? `数据库已更新，设备同步失败：${deviceSyncResult.error}`
        : needsDeviceSync
          ? '凭证已更新并同步到设备'
          : '凭证已更新（无需同步设备）',
      credential: updated,
      deviceSynced: deviceSyncResult?.success ?? (needsDeviceSync ? false : true),
      needsDeviceSync,
    });
  } catch (error: any) {
    console.error('[Credentials] 更新凭证失败:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
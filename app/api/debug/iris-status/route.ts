/**
 * 诊断 API - 检查数据库状态、AES配置、凭证数据
 * GET /api/debug/iris-status?identityId=11112222
 */

import { NextResponse } from 'next/server';
import { initDatabase, getDatabase } from '@/lib/database';
import { isAesEnabled } from '@/lib/settings';
import { aesEncrypt } from '@/lib/crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export async function GET(request: Request) {
  const logs: string[] = [];
  const log = (msg: string) => { console.log('[Debug]', msg); logs.push(msg); };

  try {
    await initDatabase();

    const { searchParams } = new URL(request.url);
    const identityId = searchParams.get('identityId') || '11112222';

    log(`=== 诊断开始, identityId=${identityId} ===`);
    log(`cwd: ${process.cwd()}`);
    log(`DATABASE_PATH: ${process.env.DATABASE_PATH || '(未设置)'}`);
    log(`DATA_DIR: ${process.env.DATA_DIR || '(未设置)'}`);
    log(`NODE_ENV: ${process.env.NODE_ENV || '(未设置)'}`);

    // AES 配置
    const aesEnabled = isAesEnabled();
    log(`AES enabled: ${aesEnabled}`);

    const queryId = aesEnabled ? aesEncrypt(identityId) : identityId;
    log(`查询用的 person_id: ${queryId}`);

    // 数据库查询
    const db = getDatabase();
    const allCreds = await db.execute({
      sql: 'SELECT id, person_id, person_name, credential_id, type, iris_data_path, enable FROM credentials WHERE person_id = ? AND enable = 1',
      args: [queryId]
    });
    log(`找到凭证数 (匹配 person_id): ${allCreds.rows.length}`);
    for (const row of allCreds.rows) {
      log(`  - id=${row.id}, person_id=${row.person_id}, credential_id=${row.credential_id}, type=${row.type}, iris_data_path=${row.iris_data_path || '(null)'}`);
    }

    // 虹膜凭证专门查询
    const irisResult = await db.execute({
      sql: 'SELECT credential_id, iris_data_path FROM credentials WHERE person_id = ? AND type = 7 AND enable = 1 LIMIT 1',
      args: [queryId]
    });
    log(`虹膜凭证查询结果: credential_id=${irisResult.rows[0]?.credential_id || 'null'}, iris_data_path=${irisResult.rows[0]?.iris_data_path || 'null'}`);

    // 检查所有凭证（不限制 person_id）看看数据库里的数据
    const allCredsAll = await db.execute({
      sql: 'SELECT person_id, credential_id, type, enable FROM credentials ORDER BY id DESC LIMIT 10'
    });
    log(`数据库中最近10条凭证:`);
    for (const row of allCredsAll.rows) {
      log(`  - person_id=${row.person_id}, credential_id=${row.credential_id}, type=${row.type}, enable=${row.enable}`);
    }

    // 检查 iris_data_path 列是否存在
    const tableInfo = await db.execute({
      sql: 'PRAGMA table_info(credentials)'
    });
    const hasIrisDataPath = tableInfo.rows.some(r => r.name === 'iris_data_path');
    log(`iris_data_path 列存在: ${hasIrisDataPath}`);

    // 检查加密文件
    const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
    const irisFilePath = join(dataDir, 'iris_data', '900001.json.enc');
    log(`加密文件路径: ${irisFilePath}`);
    log(`加密文件存在: ${existsSync(irisFilePath)}`);

    // 检查 settings.json
    const settingsPath = join(dataDir, 'settings.json');
    log(`settings.json 路径: ${settingsPath}`);
    log(`settings.json 存在: ${existsSync(settingsPath)}`);
    if (existsSync(settingsPath)) {
      try {
        const settingsContent = JSON.parse(readFileSync(settingsPath, 'utf-8'));
        log(`settings.json aesEnabled: ${settingsContent.aesEnabled}`);
      } catch (e) {
        log(`settings.json 解析失败: ${e}`);
      }
    }

    log(`=== 诊断结束 ===`);

    return NextResponse.json({ success: true, logs });
  } catch (error) {
    log(`错误: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json({ success: false, logs }, { status: 500 });
  }
}

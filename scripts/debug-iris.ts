/**
 * 直接诊断数据库和配置状态
 * 运行: npx tsx scripts/debug-iris.ts
 */

import { initDatabase, getDatabase } from '../lib/database';
import { isAesEnabled, getSettings } from '../lib/settings';
import { aesEncrypt } from '../lib/crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

(async () => {
  const logs: string[] = [];
  const log = (msg: string) => { console.log(msg); logs.push(msg); };

  await initDatabase();

  log(`=== 诊断开始 ===`);
  log(`cwd: ${process.cwd()}`);
  log(`DATABASE_PATH env: ${process.env.DATABASE_PATH || '(未设置)'}`);
  log(`DATA_DIR env: ${process.env.DATA_DIR || '(未设置)'}`);

  // AES 配置
  const aesEnabled = isAesEnabled();
  log(`settings.json aesEnabled: ${aesEnabled}`);
  const settings = getSettings();
  log(`settings.json 完整: aesEnabled=${settings.aesEnabled}`);

  const identityId = '11112222';
  const queryId = aesEnabled ? aesEncrypt(identityId) : identityId;
  log(`查询用的 person_id: ${queryId} (aesEnabled=${aesEnabled})`);

  // 数据库查询 - 匹配的凭证
  const db = getDatabase();
  const allCreds = await db.execute({
    sql: 'SELECT id, person_id, person_name, credential_id, type, iris_data_path, enable FROM credentials WHERE person_id = ? AND enable = 1',
    args: [queryId]
  });
  log(`匹配 person_id 的凭证数: ${allCreds.rows.length}`);
  for (const row of allCreds.rows) {
    log(`  [${row.type}] credential_id=${row.credential_id}, person_id=${row.person_id}, iris_data_path=${row.iris_data_path || '(null)'}`);
  }

  // 数据库里最近10条凭证
  log(`\n最近10条凭证（不限制条件）:`);
  const allRecent = await db.execute({
    sql: 'SELECT id, person_id, credential_id, type, enable, iris_data_path FROM credentials ORDER BY id DESC LIMIT 10'
  });
  for (const row of allRecent.rows) {
    log(`  id=${row.id}, person_id=${row.person_id?.substring(0, 15)}..., credential_id=${row.credential_id}, type=${row.type}, enable=${row.enable}, iris_data_path=${row.iris_data_path || '(null)'}`);
  }

  // iris_data_path 列是否存在
  const tableInfo = await db.execute({ sql: 'PRAGMA table_info(credentials)' });
  const hasIrisDataPath = tableInfo.rows.some(r => r.name === 'iris_data_path');
  log(`\niris_data_path 列存在: ${hasIrisDataPath}`);

  // 加密文件
  const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
  const irisFilePath = join(dataDir, 'iris_data', '900001.json.enc');
  log(`加密文件: ${irisFilePath}`);
  log(`文件存在: ${existsSync(irisFilePath)}`);

  // settings.json
  const settingsPath = join(dataDir, 'settings.json');
  log(`settings.json: ${settingsPath}`);
  log(`文件存在: ${existsSync(settingsPath)}`);
  if (existsSync(settingsPath)) {
    log(`内容: ${readFileSync(settingsPath, 'utf-8')}`);
  }

  log(`\n=== 诊断结束 ===`);
  process.exit(0);
})();

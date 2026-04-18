/**
 * 现场数据库诊断脚本
 * 用法：node diagnose-db.mjs
 * 放在项目根目录运行即可
 */

import { createClient } from '@libsql/client';
import fs from 'fs';
import path from 'path';

// 数据库路径（和程序一致）
const dataDir = process.env.DATA_DIR || process.cwd();
const dbPath = path.join(dataDir, 'noah-ark.db');

console.log('='.repeat(60));
console.log('诺亚宝库 - 数据库诊断工具');
console.log('='.repeat(60));
console.log(`数据库路径: ${dbPath}`);

if (!fs.existsSync(dbPath)) {
  console.log('\n❌ 数据库文件不存在！');
  process.exit(1);
}

const stats = fs.statSync(dbPath);
const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
const sizeGB = (stats.size / 1024 / 1024 / 1024).toFixed(2);
console.log(`文件大小: ${sizeMB} MB (${sizeGB} GB)`);
console.log('');

const db = createClient({ url: `file:${dbPath}` });

async function run() {
  // 1. 各表行数
  console.log('【1. 各表行数】');
  const tables = ['credentials', 'sync_queue', 'sync_logs', 'pass_logs', 'device_config', 'device_attrs'];
  for (const table of tables) {
    try {
      const r = await db.execute(`SELECT COUNT(*) as cnt FROM ${table}`);
      console.log(`  ${table}: ${r.rows[0]?.cnt || 0} 行`);
    } catch (e) {
      console.log(`  ${table}: 表不存在`);
    }
  }
  console.log('');

  // 2. credentials 表大字段大小分析
  console.log('【2. credentials 表 - 每条记录大字段大小】');
  try {
    const creds = await db.execute(`
      SELECT id, credential_id, person_name, type,
        LENGTH(content) as content_size,
        LENGTH(iris_left_image) as iris_left_size,
        LENGTH(iris_right_image) as iris_right_size,
        LENGTH(palm_feature) as palm_size
      FROM credentials
      ORDER BY id
    `);
    let totalBig = 0;
    for (const row of creds.rows) {
      const sizes = [
        row.content_size || 0,
        row.iris_left_size || 0,
        row.iris_right_size || 0,
        row.palm_size || 0
      ];
      const rowTotal = sizes.reduce((a, b) => a + b, 0);
      totalBig += rowTotal;
      console.log(`  id=${row.id} cred_id=${row.credential_id} name=${row.person_name} type=${row.type} | content=${(sizes[0]/1024).toFixed(0)}KB irisL=${(sizes[1]/1024).toFixed(0)}KB irisR=${(sizes[2]/1024).toFixed(0)}KB palm=${(sizes[3]/1024).toFixed(0)}KB | 小计=${(rowTotal/1024).toFixed(0)}KB`);
    }
    console.log(`  大字段总计: ${(totalBig / 1024 / 1024).toFixed(2)} MB`);
  } catch (e) {
    console.log(`  查询失败: ${e.message}`);
  }
  console.log('');

  // 3. sync_queue 表 payload 大小分析
  console.log('【3. sync_queue 表 - 每条 payload 大小】');
  try {
    const queues = await db.execute(`
      SELECT id, action, status, credential_id,
        LENGTH(payload) as payload_size,
        created_at
      FROM sync_queue
      ORDER BY id DESC
      LIMIT 20
    `);
    const totalQ = await db.execute(`SELECT COUNT(*) as cnt, COALESCE(SUM(LENGTH(payload)), 0) as total_size FROM sync_queue`);
    console.log(`  总行数: ${totalQ.rows[0]?.cnt || 0}`);
    console.log(`  payload 总大小: ${((totalQ.rows[0]?.total_size || 0) / 1024 / 1024).toFixed(2)} MB`);
    console.log('');
    console.log('  最近 20 条:');
    for (const row of queues.rows) {
      console.log(`  id=${row.id} action=${row.action} status=${row.status} cred_id=${row.credential_id} payload=${((row.payload_size || 0) / 1024).toFixed(0)}KB time=${row.created_at}`);
    }
  } catch (e) {
    console.log(`  查询失败: ${e.message}`);
  }
  console.log('');

  // 4. sync_logs 表 response 大小分析
  console.log('【4. sync_logs 表 - response 字段大小】');
  try {
    const totalL = await db.execute(`SELECT COUNT(*) as cnt, COALESCE(SUM(LENGTH(response)), 0) as total_resp, COALESCE(SUM(LENGTH(error_message)), 0) as total_err FROM sync_logs`);
    const tl = totalL.rows[0];
    console.log(`  总行数: ${tl?.cnt || 0}`);
    console.log(`  response 总大小: ${((tl?.total_resp || 0) / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  error_message 总大小: ${((tl?.total_err || 0) / 1024 / 1024).toFixed(2)} MB`);
  } catch (e) {
    console.log(`  查询失败: ${e.message}`);
  }
  console.log('');

  // 5. 按 action 和 status 统计 sync_queue
  console.log('【5. sync_queue 按 action + status 统计】');
  try {
    const stats = await db.execute(`
      SELECT action, status, COUNT(*) as cnt, COALESCE(SUM(LENGTH(payload)), 0) as total_size
      FROM sync_queue
      GROUP BY action, status
      ORDER BY cnt DESC
    `);
    for (const row of stats.rows) {
      console.log(`  action=${row.action} status=${row.status} 行数=${row.cnt} payload总大小=${((row.total_size || 0) / 1024 / 1024).toFixed(2)} MB`);
    }
  } catch (e) {
    console.log(`  查询失败: ${e.message}`);
  }
  console.log('');

  // 6. 按 credential_id 统计（看是否有重复下发）
  console.log('【6. 按 credential_id 统计下发次数】');
  try {
    const dupes = await db.execute(`
      SELECT credential_id, action, COUNT(*) as cnt
      FROM sync_queue
      WHERE credential_id IS NOT NULL
      GROUP BY credential_id, action
      HAVING cnt > 1
      ORDER BY cnt DESC
      LIMIT 20
    `);
    if (dupes.rows.length > 0) {
      for (const row of dupes.rows) {
        console.log(`  credential_id=${row.credential_id} action=${row.action} 下发次数=${row.cnt}`);
      }
    } else {
      console.log('  没有重复下发记录');
    }
  } catch (e) {
    console.log(`  查询失败: ${e.message}`);
  }
  console.log('');

  // 7. 估算总占用
  console.log('【7. 空间占用估算】');
  try {
    const credBig = await db.execute(`SELECT COALESCE(SUM(
      COALESCE(LENGTH(content), 0) +
      COALESCE(LENGTH(iris_left_image), 0) +
      COALESCE(LENGTH(iris_right_image), 0) +
      COALESCE(LENGTH(palm_feature), 0)
    ), 0) as total FROM credentials`);
    const queueBig = await db.execute(`SELECT COALESCE(SUM(LENGTH(payload)), 0) as total FROM sync_queue`);
    const logsBig = await db.execute(`SELECT COALESCE(SUM(COALESCE(LENGTH(response), 0) + COALESCE(LENGTH(error_message), 0)), 0) as total FROM sync_logs`);

    const credMB = (credBig.rows[0]?.total || 0) / 1024 / 1024;
    const queueMB = (queueBig.rows[0]?.total || 0) / 1024 / 1024;
    const logsMB = (logsBig.rows[0]?.total || 0) / 1024 / 1024;
    const totalEst = credMB + queueMB + logsMB;

    console.log(`  credentials 大字段: ${credMB.toFixed(2)} MB`);
    console.log(`  sync_queue payload: ${queueMB.toFixed(2)} MB`);
    console.log(`  sync_logs response/error: ${logsMB.toFixed(2)} MB`);
    console.log(`  估算总计: ${totalEst.toFixed(2)} MB`);
    console.log(`  实际文件: ${sizeMB} MB`);
    console.log(`  差值（碎片/开销）: ${(parseFloat(sizeMB) - totalEst).toFixed(2)} MB`);
  } catch (e) {
    console.log(`  查询失败: ${e.message}`);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('诊断完成');
  console.log('='.repeat(60));
}

run().catch(e => {
  console.error('运行失败:', e);
  process.exit(1);
});

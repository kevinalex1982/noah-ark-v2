/**
 * 拉取掌纹设备用户数据
 * 用法: npx tsx scripts/fetch_palm_user.ts [userId]
 * - 无参数: 调用 105 获取用户列表
 * - 有 userId: 调用 109 获取特征数据
 *
 * 重要发现：
 * - featureData 末尾包含 userId（格式: ...=用户名^^^^^...）
 * - 110 下发时 userId 必须和 featureData 里的 userId 匹配
 */

import http from 'http';
import fs from 'fs';
import path from 'path';

const PALM_ENDPOINT = process.env.PALM_DEVICE_ENDPOINT || 'http://127.0.0.1:8080';

function sendRequest(request: string, userId?: string): Promise<string> {
  const url = new URL(PALM_ENDPOINT);
  const host = url.hostname;
  const port = parseInt(url.port) || 80;

  let sendData: string;
  if (request === '105') {
    sendData = JSON.stringify({ request: '105' });
  } else if (request === '109' && userId) {
    sendData = JSON.stringify({ request: '109', userId });
  } else {
    throw new Error('Invalid parameters');
  }

  const requestPath = `/api?sendData=${sendData}`;

  return new Promise((resolve, reject) => {
    console.log(`[Request] ${request}${userId ? ` userId=${userId}` : ''}`);

    const req = http.request({
      hostname: host,
      port: port,
      path: requestPath,
      method: 'POST',
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`[Status] ${res.statusCode}`);
        resolve(data);
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.end();
  });
}

/**
 * 从 featureData 末尾提取 userId
 * 格式: ...=用户名^^^^^...
 */
function extractUserIdFromFeature(featureData: string): string | null {
  const lastEq = featureData.lastIndexOf('=');
  if (lastEq < 0) return null;

  const afterEq = featureData.substring(lastEq + 1);
  // 移除末尾的 ^ 字符
  const userId = afterEq.replace(/\^+$/, '').trim();
  return userId || null;
}

async function main() {
  const userId = process.argv[2];

  if (!userId) {
    // 105 - 获取用户列表
    console.log('=== 获取掌纹用户列表 (105) ===\n');
    const response = await sendRequest('105');
    console.log('[Response]\n');
    try {
      const json = JSON.parse(response);
      console.log(JSON.stringify(json, null, 2));
    } catch {
      console.log(response);
    }
  } else {
    // 109 - 获取指定用户特征
    console.log(`=== 获取用户特征 (109) userId=${userId} ===\n`);
    const response = await sendRequest('109', userId);

    try {
      const json = JSON.parse(response);

      if (json.code !== '200') {
        console.log(`[Error] 获取失败, code: ${json.code}`);
        return;
      }

      const fd = json.featureData as string;

      // 提取 featureData 里的 userId
      const userIdInFeature = extractUserIdFromFeature(fd);

      console.log('\n[分析结果]');
      console.log(`  设备返回 userId: "${json.userId}"`);
      console.log(`  featureData 里的 userId: "${userIdInFeature}"`);
      console.log(`  featureData 长度: ${fd.length}`);

      if (userIdInFeature && userIdInFeature !== json.userId) {
        console.log(`\n[警告] userId 不匹配！`);
        console.log(`  110 下发时必须使用 featureData 里的 userId: "${userIdInFeature}"`);
      } else {
        console.log(`\n[OK] userId 匹配，可以直接下发`);
      }

      // 保存到 data 目录（保留原始数据，不做修改）
      const dataDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const filename = `palm_user_${userId}.json`;
      const filepath = path.join(dataDir, filename);
      fs.writeFileSync(filepath, JSON.stringify(json, null, 2));
      console.log(`\n[保存] ${filepath}`);

      // 显示使用示例
      console.log('\n[使用示例] 下发到设备:');
      console.log(`  curl -X POST "http://127.0.0.1:8080/api?sendData={\\"request\\":\\"110\\",\\"userId\\":\\"${userIdInFeature || userId}\\",\\"featureData\\":\\"...\\"}"`);

    } catch (e) {
      console.log('[Raw Response]\n', response);
    }
  }
}

main().catch(console.error);
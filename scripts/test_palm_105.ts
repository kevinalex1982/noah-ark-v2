/**
 * 掌纹设备 105 接口压力测试
 * 每种方式测试 100 次，间隔 5 秒
 */

import http from 'http';

const HOST = '127.0.0.1';
const PORT = 8080;
const TOTAL = 100;
const INTERVAL = 5000; // 5秒

interface Stats {
  name: string;
  success: number;
  fail: number;
  econnreset: number;
  timeout: number;
  other: string[];
}

function rawRequest(name: string, path: string, method: string = 'POST'): Promise<{ status: number; data: string; error?: string }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path: path,
      method,
      agent: false,
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, data, error: undefined });
      });
    });
    req.on('error', (e) => resolve({ status: 0, data: '', error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, data: '', error: 'timeout' }); });
    req.end();
  });
}

function checkResult(data: string): boolean {
  try {
    const json = JSON.parse(data);
    return json.code === '200' || json.code === 200 || json.response === '105' || json.response === 200;
  } catch {
    return false;
  }
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTest() {
  console.log('=== 掌纹设备 105 压力测试 ===');
  console.log(`设备: ${HOST}:${PORT}, 每种方式 ${TOTAL} 次, 间隔 ${INTERVAL / 1000}s\n`);

  const statsA: Stats = { name: 'A-直接拼path-POST', success: 0, fail: 0, econnreset: 0, timeout: 0, other: [] };
  const statsB: Stats = { name: 'B-模板字符串-fetch', success: 0, fail: 0, econnreset: 0, timeout: 0, other: [] };
  const statsC: Stats = { name: 'C-URL类编码-fetch', success: 0, fail: 0, econnreset: 0, timeout: 0, other: [] };

  // 方式A: http.request + 原始 path
  // 方式B: http.request + 模板字符串 path（引号不编码）
  // 方式C: new URL().pathname + .search（引号会被编码）

  for (let i = 0; i < TOTAL; i++) {
    const round = i + 1;
    console.log(`\n--- 第 ${round}/${TOTAL} 轮 ---`);

    // A
    const ra = await rawRequest('A', '/api?sendData={"request":"105"}');
    if (ra.error) {
      if (ra.error.includes('ECONNRESET')) statsA.econnreset++;
      else if (ra.error === 'timeout') statsA.timeout++;
      else statsA.other.push(ra.error);
      statsA.fail++;
      console.log(`  A: ❌ ${ra.error}`);
    } else if (checkResult(ra.data)) {
      statsA.success++;
      console.log(`  A: ✅`);
    } else {
      statsA.fail++;
      statsA.other.push(ra.data.substring(0, 50));
      console.log(`  A: ❌ ${ra.data.substring(0, 80)}`);
    }

    await sleep(200);

    // B - 模板字符串 path，和 A 一样但用不同写法验证
    const pathB = '/api?sendData={"request":"105"}';
    const rb = await rawRequest('B', pathB);
    if (rb.error) {
      if (rb.error.includes('ECONNRESET')) statsB.econnreset++;
      else if (rb.error === 'timeout') statsB.timeout++;
      else statsB.other.push(rb.error);
      statsB.fail++;
      console.log(`  B: ❌ ${rb.error}`);
    } else if (checkResult(rb.data)) {
      statsB.success++;
      console.log(`  B: ✅`);
    } else {
      statsB.fail++;
      statsB.other.push(rb.data.substring(0, 50));
      console.log(`  B: ❌ ${rb.data.substring(0, 80)}`);
    }

    await sleep(200);

    // C - URL 类编码后的 path（错误写法）
    const urlObj = new URL(`http://${HOST}:${PORT}/api?sendData={"request":"105"}`);
    const pathC = urlObj.pathname + urlObj.search;
    const rc = await rawRequest('C', pathC);
    if (rc.error) {
      if (rc.error.includes('ECONNRESET')) statsC.econnreset++;
      else if (rc.error === 'timeout') statsC.timeout++;
      else statsC.other.push(rc.error);
      statsC.fail++;
      console.log(`  C: ❌ ${rc.error}`);
    } else if (checkResult(rc.data)) {
      statsC.success++;
      console.log(`  C: ✅`);
    } else {
      statsC.fail++;
      statsC.other.push(rc.data.substring(0, 50));
      console.log(`  C: ❌ ${rc.data.substring(0, 80)}`);
    }

    if (round < TOTAL) {
      await sleep(INTERVAL);
    }
  }

  console.log('\n\n========== 最终结果 ==========');
  for (const s of [statsA, statsB, statsC]) {
    const rate = ((s.success / TOTAL) * 100).toFixed(1);
    console.log(`\n${s.name}:`);
    console.log(`  ✅ 成功: ${s.success}/${TOTAL} (${rate}%)`);
    console.log(`  ❌ 失败: ${s.fail}/${TOTAL}`);
    if (s.econnreset > 0) console.log(`     ECONNRESET: ${s.econnreset}`);
    if (s.timeout > 0) console.log(`     超时: ${s.timeout}`);
    if (s.other.length > 0) {
      const uniq = [...new Set(s.other)];
      console.log(`     其他错误: ${uniq.slice(0, 5).join(' | ')}`);
    }
  }
  console.log('\n========== 结束 ==========');
}

runTest().catch(console.error);

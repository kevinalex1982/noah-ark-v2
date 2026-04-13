/**
 * 简单虹膜测试 - 5轮添加删除
 * 锁定 → 200ms → 添加 → 200ms → 解锁 → 200ms → 删除 → 200ms → 下一轮
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DEVICE = 'http://192.168.3.202:9003';
const PERSON_ID = '123456';
const PERSON_NAME = 'test_user';

// 读取数据
const irisData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/iris_user_123_full_20260317_214108.json'), 'utf-8'));
const user = Array.isArray(irisData) ? irisData[0] : irisData;
const faceImage = fs.readFileSync(path.join(__dirname, '../data/face_photo_sample.txt'), 'utf-8').trim();

// BMP转换
async function toBmp(base64) {
  const buf = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  const { data, info } = await sharp(buf).grayscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const pad = (4 - (width % 4)) % 4;
  const pixelSize = (width + pad) * height;
  const paletteSize = 1024;
  const fileSize = 54 + paletteSize + pixelSize;
  const bmp = Buffer.alloc(fileSize);
  let o = 0;
  bmp.write('BM', o); o += 2;
  bmp.writeUInt32LE(fileSize, o); o += 4;
  bmp.writeUInt16LE(0, o); o += 2;
  bmp.writeUInt16LE(0, o); o += 2;
  bmp.writeUInt32LE(54 + paletteSize, o); o += 4;
  bmp.writeUInt32LE(40, o); o += 4;
  bmp.writeInt32LE(width, o); o += 4;
  bmp.writeInt32LE(height, o); o += 4;
  bmp.writeUInt16LE(1, o); o += 2;
  bmp.writeUInt16LE(8, o); o += 2;
  bmp.writeUInt32LE(0, o); o += 4;
  bmp.writeUInt32LE(pixelSize, o); o += 4;
  bmp.writeInt32LE(2835, o); o += 4;
  bmp.writeInt32LE(2835, o); o += 4;
  bmp.writeUInt32LE(256, o); o += 4;
  bmp.writeUInt32LE(0, o); o += 4;
  for (let i = 0; i < 256; i++) { bmp[o++] = i; bmp[o++] = i; bmp[o++] = i; bmp[o++] = 0; }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) bmp[o++] = data[y * width + x];
    for (let p = 0; p < pad; p++) bmp[o++] = 0;
  }
  return bmp.toString('base64');
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  return res.json();
}

async function main() {
  console.log('=== 虹膜测试 5轮 ===\n');

  const leftBmp = await toBmp(user.irisLeftImage);
  const rightBmp = await toBmp(user.irisRightImage);
  console.log(`虹膜数据准备完成: 左${leftBmp.length} 右${rightBmp.length}\n`);

  for (let i = 1; i <= 5; i++) {
    console.log(`--- 第${i}轮 ---`);

    // 锁定
    let r = await post(`${DEVICE}/memberSaveState`, { ip: '192.168.3.202', state: 1 });
    console.log(`锁定: ${r.errorCode === 0 ? 'OK' : 'FAIL ' + r.errorCode}`);
    await new Promise(t => setTimeout(t, 200));

    // 添加
    r = await post(`${DEVICE}/memberSave`, {
      staffNum: PERSON_ID, cardNum: '', cardType: 0,
      faceImage, leftIrisImage: leftBmp, rightIrisImage: rightBmp,
      name: PERSON_NAME, openDoor: 1, purview: 30,
      purviewEndTime: 0, purviewStartTime: 0, singleIrisAllowed: 0,
    });
    console.log(`添加: ${r.errorCode === 0 ? 'OK' : 'FAIL ' + r.errorCode}`);
    await new Promise(t => setTimeout(t, 200));

    // 解锁
    r = await post(`${DEVICE}/memberSaveState`, { ip: '192.168.3.202', state: 0 });
    console.log(`解锁: ${r.errorCode === 0 ? 'OK' : 'FAIL ' + r.errorCode}`);
    await new Promise(t => setTimeout(t, 200));

    // 删除
    r = await post(`${DEVICE}/memberDelete`, { staffNum: PERSON_ID });
    console.log(`删除: ${r.errorCode === 0 ? 'OK' : 'FAIL ' + r.errorCode}`);
    await new Promise(t => setTimeout(t, 200));

    console.log('');
  }

  console.log('=== 测试完成 ===');
}

main().catch(e => console.error('错误:', e));
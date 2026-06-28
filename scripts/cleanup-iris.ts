import { initDatabase } from './lib/database';
import { deleteCredential } from './lib/db-credentials';
import { unlinkSync } from 'fs';

(async () => {
  await initDatabase();
  await deleteCredential(900002);
  console.log('已删除 credentialId=900002');
  await deleteCredential(900001);
  console.log('已删除 credentialId=900001');
  try { unlinkSync('data/iris_data/900001.json.enc'); console.log('已删除 900001.json.enc'); } catch(e) { console.log('删除文件失败:', (e as Error).message); }
  console.log('清理完成');
  process.exit(0);
})();

// 消费 data/pending/ 下本机排队过来的线索，写进云端 collection_items，成功后删除队列文件。
// 在 GitHub Actions 里运行；也可以本机临时用（本机通常连不上 Supabase，别指望）。
//
// 幂等：写入用 ignore-duplicates，同一个 id 重复提交不会覆盖云端已有状态
// （用户已经「入库 / 忽略」过的线索不会被冲回待审）。
//
// 用法：SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/consume-pending.mjs
import { readFile, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { FIELDS, pickLead } from './import-leads-to-cloud.mjs';

const QUEUE_DIR = new URL('../data/pending/', import.meta.url);

// 读取队列目录，合并去重并规整成可直接提交的数据库行。
// 抽成导出函数便于单元测试：队列格式一旦写错，表现出来是「跑了但一条没入库」，
// 在云端很难看出来。
export async function collectRows(dir = QUEUE_DIR) {
  if (!existsSync(dir)) return { rows: [], dropped: 0, files: [] };
  const files = (await readdir(dir)).filter(name => name.endsWith('.json')).sort();
  const seen = new Set();
  const rows = [];
  let dropped = 0;
  for (const name of files) {
    let payload;
    try {
      payload = JSON.parse(await readFile(new URL(name, dir), 'utf8'));
    } catch (error) {
      console.error(`跳过损坏的队列文件 ${name}：${error.message}`);
      continue;
    }
    for (const item of payload.items || []) {
      const row = pickLead(item);
      if (!row) { dropped += 1; continue; }
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(Object.fromEntries(FIELDS.map(field => [field, row[field] ?? (field === 'published_on' ? null : '')])));
    }
  }
  return { rows, dropped, files };
}

async function main() {
  const endpoint = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!endpoint || !key) throw new Error('缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 环境变量');

  const { rows, dropped, files } = await collectRows();
  if (!files.length) {
    console.log('没有待入库队列，跳过');
    return;
  }

  if (!rows.length) {
    console.log('队列里没有可用线索，保留文件等待人工核对');
    return;
  }

  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  let sent = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const response = await fetch(`${endpoint}/rest/v1/collection_items?on_conflict=id`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`写入队列线索失败 (${response.status})：${(await response.text()).slice(0, 300)}`);
    sent += batch.length;
  }

  // 只有写入成功后才会删文件；失败则保留，下一次运行自动重试。
  for (const name of files) await unlink(new URL(name, QUEUE_DIR)).catch(() => {});
  console.log(`队列已入库 ${sent} 条（跳过 ${dropped} 条不完整记录），清理 ${files.length} 个队列文件`);
}

// 只有被直接执行时才连库；被测试 import 时不触发，避免缺环境变量把测试进程杀掉。
if (process.argv[1] && process.argv[1].endsWith('consume-pending.mjs')) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

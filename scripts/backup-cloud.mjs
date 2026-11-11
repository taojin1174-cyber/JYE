// 云端数据库 → 本地备份。
// 把 Supabase 全部业务表导出到 backups/<时间戳>/，本机留一份，云端出问题也不丢数据。
// 用法：node scripts/backup-cloud.mjs
// 需要在仓库根目录 .env 里配置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY（.env 不进仓库）。
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';

const TABLES = [
  'products',
  'quotes',
  'members',
  'collection_items',
  'deletion_requests',
  'management_audit',
  'quote_audit',
  'app_migrations',
];

// 读取根目录 .env（已加入 .gitignore，密钥不会进仓库）
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!url || !key) {
  console.error('缺少配置：请在仓库根目录 .env 中填写 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const dir = `backups/${stamp}`;
await mkdir(dir, { recursive: true });

const all = {};
let failed = 0;

for (const table of TABLES) {
  try {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=100000`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 404) {
      console.log(`  跳过 ${table}（云端无此表）`);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
    const rows = await res.json();
    all[table] = rows;
    await writeFile(`${dir}/${table}.json`, JSON.stringify(rows, null, 1) + '\n');
    console.log(`  ${table}: ${rows.length} 条`);
  } catch (e) {
    failed++;
    console.error(`  ${table}: 失败（${e.message}）`);
  }
}

const total = Object.values(all).reduce((n, rows) => n + rows.length, 0);
await writeFile(
  `${dir}/all.json`,
  JSON.stringify({ exported_at: new Date().toISOString(), source: url, total, tables: all }, null, 1) + '\n'
);

console.log(`已备份 ${total} 条记录到 ${dir}/`);

// 只保留最近 30 份，避免无限堆积
const kept = (await readdir('backups')).sort();
for (const old of kept.slice(0, Math.max(0, kept.length - 30))) {
  await rm(`backups/${old}`, { recursive: true, force: true });
}

if (failed) {
  console.error(`有 ${failed} 张表备份失败，请检查密钥是否已轮换。`);
  process.exit(2);
}

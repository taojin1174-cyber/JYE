// 把静态采集快照 data/discovery.json 合并进云端 collection_items 表。
// 仅用于服务端/本机一次性搬运；密钥从环境变量读取，绝不写进仓库或前端。
// 用法：SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-leads-to-cloud.mjs
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';

// 允许直接用仓库根目录的 .env（不进仓库），省去每次手工导出环境变量。
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const FIELDS = ['id', 'source_id', 'source_name', 'title', 'url', 'price_text', 'region_text', 'published_on', 'category', 'kind', 'details', 'status', 'fetched_at'];
const KINDS = new Set(['supply', 'market', 'macro']);
const STATUSES = new Set(['pending', 'converted', 'dismissed']);

export function pickLead(item) {
  const row = {};
  for (const key of FIELDS) if (item[key] !== undefined && item[key] !== null && item[key] !== '') row[key] = item[key];
  if (!row.id || !row.source_id || !row.source_name || !row.title) return null;
  if (!/^https?:\/\//.test(row.url || '')) return null;
  if (!KINDS.has(row.kind)) return null;
  row.status = STATUSES.has(row.status) ? row.status : 'pending';
  if (row.published_on && !/^\d{4}-\d{2}-\d{2}$/.test(row.published_on)) delete row.published_on;
  if (!row.published_on) delete row.published_on;
  return row;
}

async function main() {
  const endpoint = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!endpoint || !key) throw new Error('缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 环境变量');
  const snapshot = JSON.parse(await readFile(new URL('../data/discovery.json', import.meta.url), 'utf8'));
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const rows = items.map(pickLead).filter(Boolean);
  const dropped = items.length - rows.length;
  // PostgREST 批量插入要求每行键集合一致：缺的字段补空值，日期允许 null。
  const normalized = rows.map(row => Object.fromEntries(FIELDS.map(field => [field, row[field] ?? (field === 'published_on' ? null : '')])));
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  let sent = 0;
  for (let i = 0; i < normalized.length; i += 100) {
    const batch = normalized.slice(i, i + 100);
    const response = await fetch(`${endpoint}/rest/v1/collection_items?on_conflict=id`, {
      method: 'POST',
      // ignore-duplicates：只补云端没有的线索。绝不能覆盖已有记录，
      // 否则每天采集都会把用户已经「入库 / 忽略」的线索状态冲回待审。
      headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`写入线索失败 (${response.status})：${(await response.text()).slice(0, 300)}`);
    sent += batch.length;
  }
  const check = await fetch(`${endpoint}/rest/v1/collection_items?select=id`, { headers, signal: AbortSignal.timeout(30000) });
  if (!check.ok) throw new Error(`回读线索失败 (${check.status})`);
  const total = (await check.json()).length;
  console.log(`已写入 ${sent} 条线索（跳过 ${dropped} 条不完整记录），云端现有 ${total} 条。`);
}

if (process.argv[1] && process.argv[1].endsWith('import-leads-to-cloud.mjs')) {
  main().catch(error => { console.error(error.message); process.exit(1); });
}

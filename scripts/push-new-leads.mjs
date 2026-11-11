// 一次性：只把云端不存在的线索补进去，绝不覆盖已有记录的状态。
import { readFile } from 'node:fs/promises';

const FIELDS = ['id', 'source_id', 'source_name', 'title', 'url', 'price_text', 'region_text', 'published_on', 'category', 'kind', 'details', 'status', 'fetched_at'];
const KINDS = new Set(['supply', 'market', 'macro']);

const url = process.env.SUPABASE_URL.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

const res = await fetch(`${url}/rest/v1/collection_items?select=id&limit=100000`, { headers });
if (!res.ok) throw new Error(`读取云端失败 ${res.status} ${await res.text()}`);
const existing = new Set((await res.json()).map((r) => r.id));
console.log(`云端现有线索：${existing.size} 条`);

const snap = JSON.parse(await readFile('data/discovery.json', 'utf8'));
const rows = (snap.items || [])
  .map((item) => {
    const row = {};
    for (const k of FIELDS) if (item[k] !== undefined && item[k] !== null && item[k] !== '') row[k] = item[k];
    if (!row.id || !row.source_id || !row.source_name || !row.title) return null;
    if (!/^https?:\/\//.test(row.url || '')) return null;
    if (!KINDS.has(row.kind)) return null;
    if (!row.published_on || !/^\d{4}-\d{2}-\d{2}$/.test(row.published_on)) row.published_on = null;
    row.status = 'pending';
    return Object.fromEntries(FIELDS.map((f) => [f, row[f] ?? (f === 'published_on' ? null : '')]));
  })
  .filter(Boolean);

const fresh = rows.filter((r) => !existing.has(r.id));
console.log(`本地快照：${rows.length} 条，其中云端缺失：${fresh.length} 条`);

let sent = 0;
for (let i = 0; i < fresh.length; i += 100) {
  const batch = fresh.slice(i, i + 100);
  const r = await fetch(`${url}/rest/v1/collection_items?on_conflict=id`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(batch),
  });
  if (!r.ok) throw new Error(`写入失败 ${r.status} ${(await r.text()).slice(0, 200)}`);
  sent += batch.length;
}
console.log(`已补写 ${sent} 条新线索（已有记录状态未改动）`);

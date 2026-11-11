// 把肉交所四品类公开供货信息转换成网站「来源中心」的待审线索，并合并进采集快照。
// 只写入公开字段：联系人、平台脱敏电话、原文价、货量、仓库地区、规格线索。
// 不绕过登录、不补全电话、不推算规格；标价为待核实线索，不进入供货均价。
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

// 允许直接用仓库根目录的 .env（不进仓库），省去每次手工导出环境变量。
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const SOURCE_ID = 'roujiaosuo_cats';
const SOURCE_NAME = '肉交所·四品类';
const CATS = ['清远鸡', '白条鹅', '清远麻鸡', '鸽子'];
const CAT_DESC = { '清远鸡': '清远鸡（冻品）', '白条鹅': '白条鹅（冻品）', '清远麻鸡': '清远麻鸡（冻品）', '鸽子': '鸽子（冻品）' };
const CAT_OF = { '清远鸡': '鸡', '白条鹅': '鹅', '清远麻鸡': '鸡', '鸽子': '' };

const dayString = d => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
// 相对时间以抓取时刻为基准；本机与 GitHub Actions（UTC）都按北京时间统一格式化。
function parseDateText(text, fetchedAt) {
  const s = String(text || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replaceAll('/', '-');
  const base = new Date(fetchedAt).getTime();
  const h = s.match(/(\d+)\s*小时前/), d = s.match(/(\d+)\s*天前/), m = s.match(/(\d+)\s*分钟前/);
  if (h) return dayString(new Date(base - Number(h[1]) * 3600000));
  if (d) return dayString(new Date(base - Number(d[1]) * 86400000));
  if (m) return dayString(new Date(base));
  if (/今天/.test(s)) return dayString(new Date(base));
  if (/昨天/.test(s)) return dayString(new Date(base - 86400000));
  return '';
}
// 只有「单一数值 + 公斤/斤/吨」的原文标价才交给 lead-prefill 预填；
// 区间价、面议、按只计价一律保留原文，价格留空由人工核实后填写。
function priceText(r) {
  const s = String(r.price_raw || r.price_text || '').replace(/\s+/g, ' ').trim();
  return /^\d+(?:\.\d+)?\s*元\s*\/\s*(?:公斤|千克|斤|吨)$/.test(s) ? s : (s || '见原文');
}
function specClue(desc) {
  const d = String(desc || '');
  const m = d.match(/(?:提供冻品|全规格|规格)[：:]?\s*([^。；;]{4,90})/);
  if (m) return m[0].replace(/^全规格/, '规格：').slice(0, 110);
  const kg = d.match(/(\d+(?:\.\d+)?)\s*公斤[：:][^。；;]{2,60}/);
  if (kg) return kg[0].slice(0, 110);
  return '';
}

const raw = JSON.parse(await readFile(new URL('../data/roujiaosuo-leads.json', import.meta.url), 'utf8'));
const rows = (raw.rows || []).filter(r => r.detail_ok !== false && r.url);
const seen = new Set();
const items = [];
for (const r of rows) {
  if (seen.has(r.url)) continue;
  seen.add(r.url);
  const cat = CATS.includes(r.category) ? r.category : (r.keywords || []).find(k => CATS.includes(k)) || '';
  const published_on = parseDateText(r.updated_text, raw.fetched_at) || (/^\d{4}-\d{2}-\d{2}$/.test(r.updated_on || '') ? r.updated_on : '');
  const spec = r.spec_weight || specClue(r.description);
  const perJin = Number.isFinite(r.price_per_jin) ? `${r.price_per_jin} 元/斤（由原文折算，仅供参考）` : '不适用（按只/羽或面议）';
  const details = [
    `品类：${CAT_DESC[cat] || '待核实'}`,
    `联系人：${r.contact || '未公开'}`,
    `电话：${r.phone_masked || '未公开'}（平台脱敏，完整号码需登录平台查看）`,
    `规格/单个重量：${spec || '待核实'}`,
    `元/斤折算：${perJin}`,
    `原文货量：${r.volume_text || '未注明'}（发布量，不是起订量）`,
    `供应商地区：${r.supplier_region || '未注明'}`,
    `鲜冻线索：${r.state_hint || '未标注'}`,
    `认证：${r.certified || '未注明'}`,
    `产地：${r.origin || '未注明'}`,
  ].join('；') + '。税费、运费、规格及有效期待核实。';
  items.push({
    id: createHash('sha256').update(`${SOURCE_ID}|${r.url}`).digest('hex'),
    source_id: SOURCE_ID,
    source_name: SOURCE_NAME,
    kind: 'supply',
    status: 'pending',
    fetched_at: raw.fetched_at,
    title: r.title || '（原文无标题）',
    url: r.url,
    published_on,
    price_text: priceText(r),
    region_text: r.warehouse_detail || r.warehouse || r.supplier_region || '',
    category: CAT_OF[cat] || '',
    details,
  });
}
if (!items.length) throw new Error('四品类线索为空，未覆盖采集快照');

// 默认合并：只替换本来源上次导入的条目，其它来源的线索与本地审核状态不受影响。
// --only-frozen：清空其它来源（禽网苗价行情、官方监测等），系统只保留四品类冻品供货线索。
const onlyFrozen = process.argv.includes('--only-frozen');
const snapshotPath = new URL('../data/discovery.json', import.meta.url);
let snapshot = { fetched_at: raw.fetched_at, runs: [], items: [] };
try { snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')); } catch {}
const kept = onlyFrozen ? [] : (snapshot.items || []).filter(i => i.source_id !== SOURCE_ID);
snapshot.items = [...kept, ...items];
// 顶层时间必须跟随本次抓取，否则页面显示的「最近采集」会一直停在首次导入的时间。
snapshot.fetched_at = raw.fetched_at || new Date().toISOString();
snapshot.runs = onlyFrozen
  ? [{ source_id: SOURCE_ID, ok: true, count: items.length }]
  : [...(snapshot.runs || []).filter(r => r.source_id !== SOURCE_ID), { source_id: SOURCE_ID, ok: true, count: items.length }];
await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
console.log(`[合并${onlyFrozen ? ' · 仅冻品' : ''}] ${SOURCE_NAME} ${items.length} 条待审线索 → data/discovery.json（快照合计 ${snapshot.items.length} 条）`);

// 云端模式：把这批线索单独写库（不含 market 字段，避开 collection_items 未知列报错）。
if (process.argv.includes('--cloud') && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(process.env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/collection_items?on_conflict=id', {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify(items),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`四品类线索写入数据库失败 (${response.status})`);
  console.log('[云端] 已写入 collection_items');
}


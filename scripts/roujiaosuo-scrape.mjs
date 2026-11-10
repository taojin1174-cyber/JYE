import { writeFile } from 'node:fs/promises';

const BASE = 'https://www.roujiaosuo.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const KEYWORDS = ['清远鸡', '白条鹅', '清远麻鸡', '鸽子'];
const dayString = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const TODAY = dayString();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = s => String(s ?? '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();

async function get(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: AbortSignal.timeout(25000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } catch (e) {
    if (attempt < 2) { await sleep(700 * (attempt + 1)); return get(url, attempt + 1); }
    throw new Error(e.message + (e.cause?.code ? ' (' + e.cause.code + ')' : ''));
  }
}

function parseDateText(text) {
  const s = String(text || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replaceAll('/', '-');
  const before = new Date();
  const h = s.match(/(\d+)\s*小时前/), d = s.match(/(\d+)\s*天前/), m = s.match(/(\d+)\s*分钟前/);
  if (h) return dayString(new Date(before.getTime() - Number(h[1]) * 3600000));
  if (d) return dayString(new Date(before.getTime() - Number(d[1]) * 86400000));
  if (m) return dayString(before);
  if (/今天/.test(s)) return TODAY;
  if (/昨天/.test(s)) return dayString(new Date(before.getTime() - 86400000));
  return '';
}

function priceInfo(text) {
  const s = String(text || '').replace(/\s+/g, ' ');
  const m = s.match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*元\s*\/\s*(公斤|千克|斤|吨|只|羽|个)/)
    || s.match(/(\d+(?:\.\d+)?)\s*元\s*\/\s*(公斤|千克|斤|吨|只|羽|个)/);
  if (!m) return { raw: s.trim(), value: null, unit: '', perJin: null, note: '未标明清晰单价' };
  let low, high, unit;
  if (m[2] && /(公斤|千克|斤|吨|只|羽|个)/.test(m[2] || '')) { unit = m[2]; low = Number(m[1]); high = null; }
  else { unit = m[3] || m[2]; low = Number(m[1]); high = m[2] && !Number.isNaN(Number(m[2])) ? Number(m[2]) : null; }
  const mid = high == null ? low : (low + high) / 2;
  const factor = { '公斤': 0.5, '千克': 0.5, '斤': 1, '吨': 0.0005 }[unit];
  const perJin = factor == null ? null : Math.round(mid * factor * 10000) / 10000;
  return {
    raw: s.trim(), value: mid, unit, perJin,
    low: high == null ? null : low, high,
    note: factor == null ? '按' + unit + '计价，不折算为元/斤' : ''
  };
}

function specWeight(text) {
  const s = String(text || '');
  const patterns = [
    /(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*(kg|公斤|斤|g|克)\s*[\/每]\s*(只|羽|个)/i,
    /(\d+(?:\.\d+)?)\s*(kg|公斤|斤|g|克)\s*[\/每]\s*(只|羽|个)/i,
    /(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*斤重/,
  ];
  for (const p of patterns) { const m = s.match(p); if (m) return m[0]; }
  return '';
}

function parseList(html, keyword) {
  const out = [];
  const blocks = html.match(/<ul class="meat-list-item fl">([\s\S]*?)<\/ul>/gi) || [];
  for (const block of blocks) {
    const lis = [...block.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(m => clean(m[1]));
    if (lis.length < 7) continue;
    const href = block.match(/href="(https:\/\/www\.roujiaosuo\.com\/sell\/show\/\d+\/)"/)?.[1] || '';
    if (!href) continue;
    out.push({
      id: href.match(/show\/(\d+)\//)?.[1] || '',
      url: href, keyword,
      title: lis[0],
      supply_type: lis[1],
      origin: lis[2],
      price_text: lis[3],
      volume_text: lis[4],
      warehouse: lis[5],
      updated_text: lis[6],
      updated_on: parseDateText(lis[6]),
    });
  }
  const pages = Number((html.match(/共\d+条\/(\d+)页/) || [])[1] || 1);
  const total = Number((html.match(/共(\d+)条\//) || [])[1] || out.length);
  return { items: out, pages, total };
}

function parseDetail(html) {
  const text = clean(html);
  const sellerBlock = html.match(/<div class="list-info">([\s\S]*?)<\/div>/i)?.[1] || '';
  const sellerClean = clean(sellerBlock);
  const liText = [...sellerBlock.matchAll(/<li>([\s\S]*?)<\/li>/gi)].map(m => clean(m[1]));
  const field = (label) => liText.find(x => x.startsWith(label))?.slice(label.length).trim() || '';
  const price = priceInfo(html.match(/价格：<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
  const volume = clean(html.match(/数量：<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
  const sellerTel = clean(html.match(/id="contact_tel"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
  const contactFromTag = clean(html.match(/联系卖家：([\s\S]*?)<\/span>/i)?.[1] || '');
  const desc = html.match(/<meta name="description" content="([^"]*)"/i)?.[1] || '';
  const shopUrl = html.match(/href="(https:\/\/www\.roujiaosuo\.com\/com\/[a-zA-Z0-9]+)"/)?.[1] || '';
  const frozenHint = /冻|冷冻|速冻/.test(text) || /冻|冷冻|速冻/.test(desc);
  const freshHint = /鲜品|鲜活|活禽/.test(text);
  return {
    contact: field('联系人：') || contactFromTag,
    supplier_region: field('所在地区：'),
    joined_year: field('入驻时间：'),
    certified: field('认证状态：'),
    seller_item_count: field('商品信息：'),
    shop_url: shopUrl,
    phone_masked: sellerTel,
    price_detail: price.raw,
    price_per_jin: price.perJin,
    price_unit: price.unit,
    price_note: price.note,
    volume_detail: volume,
    warehouse_detail: clean(html.match(/仓库位置：([\s\S]*?)<\/span>/i)?.[1] || ''),
    origin_detail: clean(html.match(/产地：<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || ''),
    goods_status: clean(html.match(/货物状态：([\s\S]*?)<\/span>/i)?.[1] || ''),
    description: desc,
    spec_weight: specWeight(text + ' ' + desc),
    state_hint: frozenHint ? '冻品线索' : freshHint ? '鲜品线索' : '未标注',
  };
}

function classify(row) {
  const t = row.title || '';
  if (/麻鸡/.test(t)) return '清远麻鸡';
  if (/鸽/.test(t)) return '鸽子';
  if (/鹅/.test(t)) return '白条鹅';
  if (/清远鸡|清远/.test(t)) return '清远鸡';
  const k = row.keyword || '';
  if (k === '清远麻鸡') return '清远麻鸡';
  if (k === '鸽子') return '鸽子';
  if (k === '白条鹅') return '白条鹅';
  return '清远鸡';
}

async function main() {
  const all = new Map();
  const stats = [];
  for (const kw of KEYWORDS) {
    let pages = 1, total = 0;
    for (let page = 1; page <= pages; page++) {
      const url = BASE + '/sell/search.php?kw=' + encodeURIComponent(kw) + (page > 1 ? '&page=' + page : '');
      try {
        const html = await get(url);
        const parsed = parseList(html, kw);
        if (page === 1) { pages = parsed.pages; total = parsed.total; }
        for (const item of parsed.items) {
          if (!all.has(item.id)) all.set(item.id, { ...item, keywords: [kw] });
          else if (!all.get(item.id).keywords.includes(kw)) all.get(item.id).keywords.push(kw);
        }
        console.log(`[列表] ${kw} 第${page}/${pages}页 -> ${parsed.items.length} 条`);
      } catch (e) { console.error(`[列表] ${kw} 第${page}页失败: ${e.message}`); }
      await sleep(250);
    }
    stats.push({ keyword: kw, pages, total });
  }
  const rows = [...all.values()];
  console.log(`[汇总] 去重后 ${rows.length} 条，开始抓详情…`);

  let done = 0, failed = 0;
  for (let i = 0; i < rows.length; i += 3) {
    const batch = rows.slice(i, i + 3);
    await Promise.all(batch.map(async row => {
      try {
        const html = await get(row.url);
        Object.assign(row, parseDetail(html));
        row.detail_ok = true;
      } catch (e) { row.detail_ok = false; row.detail_error = e.message; failed++; }
      done++;
      if (done % 20 === 0) console.log(`[详情] ${done}/${rows.length}（失败 ${failed}）`);
    }));
    await sleep(220);
  }
  for (const row of rows) {
    row.category = classify(row);
    const p = priceInfo(row.detail_ok && row.price_detail ? row.price_detail : row.price_text);
    row.price_raw = p.raw; row.price_value = p.value; row.price_unit_final = p.unit;
    row.price_per_jin = p.perJin; row.price_low = p.low; row.price_high = p.high; row.price_note = p.note;
    row.spec_weight = row.spec_weight || specWeight(row.title + ' ' + row.description);
    row.fetched_at = new Date().toISOString();
  }
  await writeFile(new URL('../data/roujiaosuo-leads.json', import.meta.url), JSON.stringify({ fetched_at: new Date().toISOString(), today: TODAY, stats, rows }, null, 2) + '\n', 'utf8');
  console.log(`[完成] ${rows.length} 条，详情失败 ${failed} 条，已写入 data/roujiaosuo-leads.json`);
  for (const c of KEYWORDS) console.log(`  ${c}: ${rows.filter(r => r.category === c).length} 条`);
}

main().catch(e => { console.error('抓取失败:', e); process.exitCode = 1; });

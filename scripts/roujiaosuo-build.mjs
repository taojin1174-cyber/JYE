import { readFile, writeFile } from 'node:fs/promises';

const raw = JSON.parse(await readFile(new URL('../data/roujiaosuo-leads.json', import.meta.url), 'utf8'));
const CATS = ['清远鸡', '白条鹅', '清远麻鸡', '鸽子'];
const CAT_DESC = {
  '清远鸡': '清远鸡（冻品）',
  '白条鹅': '白条鹅（冻品）',
  '清远麻鸡': '清远麻鸡（冻品）',
  '鸽子': '鸽子（冻品）',
};

const dayString = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
function parseDateText(text) {
  const s = String(text || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replaceAll('/', '-');
  const now = Date.now();
  const h = s.match(/(\d+)\s*小时前/), d = s.match(/(\d+)\s*天前/), m = s.match(/(\d+)\s*分钟前/);
  if (h) return dayString(new Date(now - Number(h[1]) * 3600000));
  if (d) return dayString(new Date(now - Number(d[1]) * 86400000));
  if (m) return dayString(new Date(now));
  if (/今天/.test(s)) return raw.today;
  if (/昨天/.test(s)) return dayString(new Date(now - 86400000));
  return '';
}
function specClues(desc) {
  const d = String(desc || '');
  const usable = s => s && /\d/.test(s) && /(公斤|kg|KG|斤|克|只|规格)/i.test(s) ? s.slice(0, 110) : '';
  const m = d.match(/(?:提供冻品|全规格|规格)[：:]?\s*([^。；;]{4,90})/);
  if (m) { const s = usable(m[0].replace(/^全规格/, '规格：')); if (s) return s; }
  const kg = d.match(/(\d+(?:\.\d+)?)\s*公斤[：:][^。；;]{2,60}/);
  return kg ? usable(kg[0]) : '';
}

const rows = raw.rows.map((r, i) => {
  const title = r.title || '';
  const s = /冻|冷冻|速冻/.test(title) ? '冻品线索' : /鲜品|鲜活|活禽/.test(title) ? '鲜品线索' : '未标注';
  const clue = specClues(r.description);
  const specDisplay = r.spec_weight || (clue ? (clue.length > 42 ? clue.slice(0, 42) + '…' : clue) : '');
  return {
    idx: i + 1,
    category: r.category,
    updated_on: parseDateText(r.updated_text) || (/^\d{4}-\d{2}-\d{2}$/.test(r.updated_on || '') ? r.updated_on : ''),
    updated_text: r.updated_text || '',
    title,
    url: r.url,
    warehouse: r.warehouse_detail || r.warehouse || '',
    supplier_region: r.supplier_region || '',
    contact: r.contact || '',
    phone_masked: r.phone_masked || '',
    price_raw: r.price_raw || r.price_text || '',
    price_per_jin: r.price_per_jin,
    price_note: r.price_note || '',
    spec_weight: specDisplay,
    spec_full: clue || r.spec_weight || '',
    spec_kind: r.spec_weight ? '明确' : clue ? '原文线索' : '',
    description: r.description || '',
    volume_text: r.volume_detail || r.volume_text || '',
    state_hint: s,
    supply_type: r.supply_type || r.goods_status || '',
    origin: r.origin_detail || r.origin || '',
    certified: r.certified || '',
    joined_year: r.joined_year || '',
    shop_url: r.shop_url || '',
    detail_ok: r.detail_ok !== false,
    keywords: r.keywords || [],
  };
});

const median = arr => {
  const v = arr.filter(x => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = (v.length - 1) / 2;
  return Math.round(((v[Math.floor(m)] + v[Math.ceil(m)]) / 2) * 100) / 100;
};
const summary = {};
for (const c of CATS) {
  const list = rows.filter(r => r.category === c);
  const prices = list.map(r => r.price_per_jin).filter(x => typeof x === 'number');
  summary[c] = {
    count: list.length,
    median: median(prices),
    min: prices.length ? Math.min(...prices) : null,
    max: prices.length ? Math.max(...prices) : null,
    suppliers: new Set(list.map(r => r.contact).filter(Boolean)).size,
    withPhone: list.filter(r => r.phone_masked).length,
    detailOk: list.filter(r => r.detail_ok).length,
    recent: list.filter(r => r.updated_on >= '2026-10-01').length,
  };
}

const COLS = [
  { k: 'idx', t: '#', w: '48px', type: 'num', core: true },
  { k: 'updated_on', t: '更新日期', w: '96px', core: true },
  { k: 'title', t: '品名（原文）', w: '210px', type: 'link', core: true },
  { k: 'warehouse', t: '仓库地址', w: '128px', core: true },
  { k: 'supplier_region', t: '供应商地区', w: '150px' },
  { k: 'contact', t: '联系人', w: '92px', core: true },
  { k: 'phone_masked', t: '联系电话', w: '130px', core: true },
  { k: 'price_raw', t: '原文价', w: '130px', core: true },
  { k: 'price_per_jin', t: '元/斤', w: '92px', type: 'price', core: true },
  { k: 'spec_weight', t: '规格 / 单个重量', w: '140px', core: true },
  { k: 'volume_text', t: '货量（发布量）', w: '118px' },
  { k: 'state_hint', t: '鲜冻线索', w: '96px' },
  { k: 'supply_type', t: '供货类型', w: '88px' },
  { k: 'origin', t: '产地', w: '80px' },
  { k: 'certified', t: '认证', w: '88px' },
  { k: 'joined_year', t: '入驻', w: '76px' },
  { k: 'links', t: '链接', w: '96px', core: true },
];

const cutoff = dayString(new Date(Date.parse(raw.today + 'T12:00:00+08:00') - 30 * 86400000));
const payload = JSON.stringify({ rows, summary, cats: CATS, catDesc: CAT_DESC, cols: COLS, fetchedAt: raw.fetched_at, today: raw.today, cutoff, stats: raw.stats })
  .replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');

const html = `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>肉交所 · 四品类供货线索表</title>
<style>
:root{--bg:#f4f6f7;--card:#fff;--line:#e3e8ea;--line2:#eef1f2;--text:#1b2428;--muted:#6c7b80;--brand:#177454;--brand-soft:#e8f4ef;--price:#b3401f;--warn:#b26a00;--warn-bg:#fff6e6;--head:#f7f9f9;--shadow:0 1px 2px rgba(16,40,35,.05)}
[data-theme="dark"]{--bg:#14191c;--card:#1c2327;--line:#2b353a;--line2:#242d31;--text:#e6edef;--muted:#94a4aa;--brand:#4ec59b;--brand-soft:#18362c;--price:#ff9a72;--warn:#e7b25a;--warn-bg:#302718;--head:#20292d;--shadow:none}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1560px;margin:0 auto;padding:28px 26px 60px}
header h1{font-size:22px;font-weight:600;margin:0 0 6px;letter-spacing:.2px}
.sub{color:var(--muted);font-size:12.5px;margin-bottom:20px}
.sub b{color:var(--brand);font-weight:600}
.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;box-shadow:var(--shadow)}
.card .name{font-size:13px;font-weight:600;color:var(--brand);margin-bottom:8px}
.card .big{font-size:24px;font-weight:600;letter-spacing:.5px;font-variant-numeric:tabular-nums}
.card .big small{font-size:12px;font-weight:400;color:var(--muted);margin-left:4px}
.card .meta{color:var(--muted);font-size:12px;margin-top:6px;font-variant-numeric:tabular-nums}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:20px;box-shadow:var(--shadow)}
.bar input[type=search]{flex:1;min-width:220px;border:1px solid var(--line);background:var(--bg);color:var(--text);border-radius:6px;padding:7px 10px;font-size:13px;outline:none}
.bar input[type=search]:focus{border-color:var(--brand)}
button,.nav a{font:inherit;font-size:12.5px;border:1px solid var(--line);background:var(--card);color:var(--text);padding:7px 11px;border-radius:6px;cursor:pointer;text-decoration:none;white-space:nowrap}
button:hover,.nav a:hover{border-color:var(--brand);color:var(--brand)}
button.on{background:var(--brand-soft);border-color:var(--brand);color:var(--brand);font-weight:600}
.nav{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
.note{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--brand);border-radius:8px;padding:12px 16px;margin-bottom:22px;font-size:12.5px;color:var(--muted)}
.note b{color:var(--text);font-weight:600}
.note ul{margin:8px 0 0;padding-left:18px}.note li{margin:3px 0}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;margin-bottom:22px;overflow:hidden;box-shadow:var(--shadow)}
.sec-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding:14px 16px;border-bottom:1px solid var(--line)}
.sec-head h2{font-size:16px;font-weight:600;margin:0}
.sec-head .pill{font-size:12px;color:var(--brand);background:var(--brand-soft);padding:2px 8px;border-radius:20px}
.sec-head .st{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.scroll{overflow:auto;max-height:620px}
table{border-collapse:separate;border-spacing:0;width:100%;font-size:12.5px;white-space:nowrap}
th,td{padding:8px 10px;border-bottom:1px solid var(--line2);text-align:left;vertical-align:top}
th{position:sticky;top:0;z-index:2;background:var(--head);font-weight:600;color:var(--muted);cursor:pointer;user-select:none;border-bottom:1px solid var(--line)}
th:hover{color:var(--brand)}
th.num,td.num{text-align:right;font-variant-numeric:tabular-nums}
th.price,td.price{text-align:right;font-variant-numeric:tabular-nums}
tbody tr:nth-child(even){background:color-mix(in srgb,var(--card) 94%,var(--brand) 6%)}
tbody tr:hover{background:var(--brand-soft)}
td a{color:var(--brand);text-decoration:none}td a:hover{text-decoration:underline}
td.price{color:var(--price);font-weight:600;font-size:13px}
td.price.abnormal{background:var(--warn-bg);outline:1px solid var(--warn);border-radius:3px}
.muted{color:var(--muted)}
.tag{display:inline-block;font-size:11px;padding:1px 6px;border-radius:4px;background:var(--head);color:var(--muted);border:1px solid var(--line)}
.tag.frozen{background:var(--brand-soft);color:var(--brand);border-color:transparent}
.mask{font-family:ui-monospace,Consolas,monospace;letter-spacing:.3px}
.chk{width:14px;height:14px;accent-color:var(--brand);cursor:pointer}
.empty{padding:26px;text-align:center;color:var(--muted)}
footer{color:var(--muted);font-size:12px;text-align:center;padding:10px}
@media print{.bar,.nav,button{display:none!important}body{background:#fff}.scroll{max-height:none;overflow:visible}section{break-inside:avoid}th{position:static}}
@media(max-width:900px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
</head>
<body>
<div class="wrap">
<header>
  <a href="./index.html#settings/sources" style="display:inline-block;margin-bottom:8px;color:var(--brand);text-decoration:none;font-weight:600">← 返回行情跳动 · 来源中心审核</a>
  <h1>肉交所 · 四品类供货线索表</h1>
  <div class="sub">来源：肉交所公开供应信息 · 采集时间 <b id="fetched"></b> · 共 <b id="total"></b> 条 · 本表为<b>待核实线索</b>，未经审核，不进入供货均价；逐条录入请到「数据设置 → 来源中心 → 核实入库」</div>
</header>
<div class="cards" id="cards"></div>
<div class="bar">
  <input type="search" id="q" placeholder="筛选品名 / 地址 / 联系人 / 电话 / 价格…">
  <button id="core" class="on">精简列</button>
  <button id="abnormalOnly">仅看异常价</button>
  <button id="recentOnly">仅看近 30 天</button>
  <button id="csvAll">导出全部 CSV</button>
  <button id="theme">深色 / 浅色</button>
  <span class="nav" id="nav"></span>
</div>
<div class="note">
  <b>口径与限制（审核前必读）</b>
  <ul>
    <li>价格统一换算为 <b>元/斤</b>：元/公斤 ÷ 2、元/吨 ÷ 2000、元/斤 原值；按「元/只、元/羽」等计件价<b>不折算</b>，单独标注。异常价（偏离本品类中位数 ±50%）底色提示，不自动剔除。</li>
    <li><b>联系电话为平台脱敏号码</b>（如 182****9656），完整号码需登录肉交所查看；本表不绕过登录、不做推测。联系人为公开字段。</li>
    <li><b>「货量」是发布量，不是单个重量，也不是起订量</b>。只有原文明确写出「X kg/只」才填入规格列；从商品描述里找到的规格片段标「原文线索」并悬停查看全文；其余一律「待核实」，请打开原文核对后填入，不做推算。</li>
    <li>「鲜冻线索」按原文标题关键词推断，仅供筛选；「供应商地区」与「仓库地址」可能不同，产地以原文为准。分类按标题关键词归入 4 张表，与各关键词搜索条数略有出入（含「鹅」的条目统一进白条鹅表）。</li>
    <li>数据含历史发布信息（最早可追溯至数年前），请先看更新日期；本表只做线索汇总，审核通过后才录入系统。</li>
  </ul>
</div>
<main id="main"></main>
<footer>肉交所公开信息整理 · 仅供内部采购核实参考 · 生成于 <span id="gen"></span></footer>
</div>
<script id="payload" type="application/json">${payload}</script>
<script>
const D=JSON.parse(document.getElementById('payload').textContent);
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let core=true, abnormalOnly=false, recentOnly=false, q='', sortState={k:null,dir:null};
let checked={};try{checked=JSON.parse(localStorage.getItem('rjs-checked-v2')||'{}')}catch(e){}
const save=()=>{try{localStorage.setItem('rjs-checked-v2',JSON.stringify(checked))}catch(e){}};
const fmt=n=>typeof n==='number'&&Number.isFinite(n)?n.toFixed(2):'—';
$('#fetched').textContent=new Date(D.fetchedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
$('#total').textContent=D.rows.length;
$('#gen').textContent=new Date().toLocaleString('zh-CN',{hour12:false});
$('#cards').innerHTML=D.cats.map(c=>{const s=D.summary[c];return '<div class="card"><div class="name">'+esc(D.catDesc[c])+'</div><div class="big">'+s.count+'<small>条线索</small></div><div class="meta">中位价 '+fmt(s.median)+' 元/斤 · 区间 '+(s.min==null?'—':fmt(s.min)+'–'+fmt(s.max))+'</div><div class="meta">联系人 '+s.suppliers+' 位 · 近 30 天 '+s.recent+' 条 · 有价 '+D.rows.filter(r=>r.category===c&&typeof r.price_per_jin==='number').length+' 条</div></div>'}).join('');
$('#nav').innerHTML=D.cats.map(c=>'<a href="#sec-'+encodeURIComponent(c)+'">'+esc(D.catDesc[c])+'</a>').join('');
const shownCols=()=>D.cols.filter(c=>!core||c.core);
const cell=(r,c)=>{
  const v=r[c.k];
  if(c.k==='links')return '<a href="'+esc(r.url)+'" target="_blank" rel="noopener">原文</a>'+(r.shop_url?' · <a href="'+esc(r.shop_url)+'" target="_blank" rel="noopener">店铺</a>':'');
  if(c.k==='title')return '<a href="'+esc(r.url)+'" target="_blank" rel="noopener">'+esc(v||'—')+'</a>';
  if(c.k==='price_per_jin')return typeof v==='number'?fmt(v):'<span class="muted">不折算</span>';
  if(c.k==='spec_weight')return v?'<span title="'+esc(r.spec_full||v)+'">'+esc(v)+'</span> <span class="tag'+(r.spec_kind==='明确'?' frozen':'')+'">'+esc(r.spec_kind)+'</span>':'<span class="muted">待核实</span>';
  if(c.k==='phone_masked')return v?'<span class="mask">'+esc(v)+'</span> <span class="tag">登录可见</span>':'<span class="muted">—</span>';
  if(c.k==='state_hint')return '<span class="tag'+(v==='冻品线索'?' frozen':'')+'">'+esc(v||'未标注')+'</span>';
  if(c.k==='updated_on')return v?esc(v):'<span class="muted">'+esc(r.updated_text||'—')+'</span>';
  if(c.k==='idx')return v;
  return v==null||v===''?'<span class="muted">—</span>':esc(v);
};
function visible(r){
  if(abnormalOnly){const m=D.summary[r.category].median;if(!(typeof r.price_per_jin==='number'&&m&&(r.price_per_jin>m*1.5||r.price_per_jin<m*0.5)))return false}
  if(recentOnly&&(!r.updated_on||r.updated_on<D.cutoff))return false;
  if(q){const hay=[r.title,r.warehouse,r.supplier_region,r.contact,r.phone_masked,r.price_raw,r.spec_weight,r.state_hint].join(' ').toLowerCase();if(!hay.includes(q))return false}
  return true;
}
function render(){
  $('#main').innerHTML=D.cats.map(cat=>{
    const s=D.summary[cat],list=D.rows.filter(r=>r.category===cat&&visible(r));
    const cols=shownCols();
    const head='<tr>'+cols.map(c=>'<th class="'+(c.type==='num'?'num':c.type==='price'?'price':'')+'" data-k="'+c.k+'" data-dir="'+(sortState.k===c.k?sortState.dir:'')+'" style="min-width:'+c.w+'">'+esc(c.t)+'</th>').join('')+'<th style="min-width:64px">已核</th></tr>';
    const body=list.length?list.map(r=>'<tr data-id="'+r.idx+'">'+cols.map(c=>{
      const abnormal=c.k==='price_per_jin'&&typeof r.price_per_jin==='number'&&s.median&&(r.price_per_jin>s.median*1.5||r.price_per_jin<s.median*0.5);
      const cls=[c.type==='num'?'num':'',c.type==='price'?'price':'',abnormal?'abnormal':''].filter(Boolean).join(' ');
      return '<td class="'+cls+'">'+cell(r,c)+'</td>';
    }).join('')+'<td><input class="chk" type="checkbox" data-id="'+r.idx+'" '+(checked[r.idx]?'checked':'')+'></td></tr>').join(''):'<tr><td class="empty" colspan="'+(cols.length+1)+'">没有符合筛选条件的记录</td></tr>';
    return '<section id="sec-'+encodeURIComponent(cat)+'"><div class="sec-head"><h2>'+esc(D.catDesc[cat])+'</h2><span class="pill">'+list.length+' / '+s.count+' 条</span><span class="st">中位价 '+fmt(s.median)+' 元/斤 · 最低 '+fmt(s.min)+' · 最高 '+fmt(s.max)+' · 详情抓取成功 '+s.detailOk+' 条</span><button data-csv="'+esc(cat)+'">导出本表 CSV</button></div><div class="scroll"><table><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div></section>';
  }).join('');
  bind();
}
function bind(){
  document.querySelectorAll('th[data-k]').forEach(th=>th.onclick=()=>{
    const k=th.dataset.k;const dir=sortState.k===k&&sortState.dir==='asc'?'desc':'asc';
    sortState={k,dir};
    D.rows.sort((a,b)=>{let x=a[k],y=b[k];if(k==='idx'||k==='price_per_jin'){x=Number(x)||0;y=Number(y)||0;return dir==='asc'?x-y:y-x}return dir==='asc'?String(x??'').localeCompare(String(y??''),'zh'):String(y??'').localeCompare(String(x??''),'zh')});
    render();
  });
  document.querySelectorAll('.chk').forEach(cb=>cb.onchange=()=>{if(cb.checked)checked[cb.dataset.id]=1;else delete checked[cb.dataset.id];save()});
  document.querySelectorAll('button[data-csv]').forEach(b=>b.onclick=()=>csv(b.dataset.csv));
}
function csv(cat){
  const list=D.rows.filter(r=>(!cat||r.category===cat)&&visible(r));
  const cols=D.cols.filter(c=>c.k!=='links'&&c.k!=='idx');
  const head=['品类','序号'].concat(cols.map(c=>c.t)).concat(['原文链接','店铺链接','已核实']);
  const lines=[head].concat(list.map(r=>[r.category,r.idx].concat(cols.map(c=>{
    if(c.k==='price_per_jin')return typeof r.price_per_jin==='number'?r.price_per_jin:r.price_note||'不折算';
    if(c.k==='spec_weight')return r.spec_full||'待核实';
    return r[c.k]??'';
  })).concat([r.url,r.shop_url,checked[r.idx]?'是':'否'])));
  const text='\\uFEFF'+lines.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\\r\\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));a.download='肉交所供货线索_'+(cat||'全部')+'_'+D.today+'.csv';a.click();URL.revokeObjectURL(a.href);
}
$('#q').oninput=e=>{q=e.target.value.trim().toLowerCase();render()};
$('#core').onclick=e=>{core=!core;e.target.classList.toggle('on',core);e.target.textContent=core?'精简列':'完整列';render()};
$('#abnormalOnly').onclick=e=>{abnormalOnly=!abnormalOnly;e.target.classList.toggle('on',abnormalOnly);render()};
$('#recentOnly').onclick=e=>{recentOnly=!recentOnly;e.target.classList.toggle('on',recentOnly);render()};
$('#csvAll').onclick=()=>csv('');
$('#theme').onclick=()=>{const h=document.documentElement;h.dataset.theme=h.dataset.theme==='dark'?'light':'dark'};
D.rows.sort((a,b)=>String(b.updated_on||'').localeCompare(String(a.updated_on||''))||a.idx-b.idx);
render();
</script>
</body>
</html>`;

await writeFile(new URL('../leads.html', import.meta.url), html, 'utf8');

const csvCols = [
  ['品类', 'category'], ['序号', 'idx'], ['更新日期', 'updated_on'], ['更新时间原文', 'updated_text'],
  ['品名', 'title'], ['仓库地址', 'warehouse'], ['供应商地区', 'supplier_region'],
  ['联系人', 'contact'], ['联系电话(脱敏)', 'phone_masked'], ['原文价', 'price_raw'],
  ['元/斤', 'price_per_jin'], ['价格备注', 'price_note'], ['规格/单个重量', 'spec_weight'], ['规格原文(描述)', 'spec_full'], ['规格来源', 'spec_kind'],
  ['货量(发布量)', 'volume_text'], ['鲜冻线索', 'state_hint'], ['供货类型', 'supply_type'],
  ['产地', 'origin'], ['认证', 'certified'], ['入驻', 'joined_year'],
  ['原文链接', 'url'], ['店铺链接', 'shop_url'],
];
const csvText = '\uFEFF' + [csvCols.map(c => '"' + c[0] + '"').join(',')]
  .concat(rows.map(r => csvCols.map(c => '"' + String(r[c[1]] ?? '').replace(/"/g, '""') + '"').join(',')))
  .join('\r\n');
await writeFile(new URL('../data/roujiaosuo-leads.csv', import.meta.url), csvText, 'utf8');
console.log('已生成 leads.html 与 data/roujiaosuo-leads.csv；总条数', rows.length);
for (const c of CATS) console.log(' ', c, summary[c].count, '条，中位价', summary[c].median, '元/斤');

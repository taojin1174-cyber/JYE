import { dayString, shiftDay, provinces, bases, statuses, money, normalizePrice, latestQuotes, summarize, trend, validateQuote, csvCell, isValidQuote, matchesLeadCategory } from './core.js';
import { leadPrefill } from './lead-prefill.js';
import { buildQuickQuote } from './lead-quick.js';
import { filterExport } from './export-filter.js';
import { store } from './store.js';
import { sourceCatalog,sourceKinds } from './sources.js';
import { createSettingsAccess } from './settings-access.js';
import { accessGate } from './access-gate.js';

const icons = {
  plus:'<path d="M12 5v14M5 12h14"/>', down:'<path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/>',
  arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>', search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', chevron:'<path d="m9 6 6 6-6 6"/>',
  check:'<path d="m5 12 4 4 10-10"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>', layers:'<path d="m12 3 10 6-10 6L2 9l10-6ZM2 14l10 6 10-6"/>',
  shield:'<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-5"/>', refresh:'<path d="M20 11a8 8 0 0 0-14-5L3 9m0-6v6h6M4 13a8 8 0 0 0 14 5l3-3m0 6v-6h-6"/>',
};
const icon = (name,size=16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.layers}</svg>`;
const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const state={page:location.hash.slice(1)||'overview',days:7,basis:'factory',category:'',province:'',product:'',source:'',search:'',sort:'price',reviewStatus:'pending',chartProduct:'chicken-fresh',pageNumber:1,sourceKind:'',leadKind:'',leadCategory:''};
let data={products:[],quotes:[],leads:[]};
let busy=false;
let sessionStore;
try { sessionStore = sessionStorage; } catch {}
const settingsAccess = createSettingsAccess(sessionStore, location.pathname);
state.settingsView = 'general';
function readRoute() {
 const route = location.hash.slice(1) || 'overview';
 state.page = ['sources','settings/sources'].includes(route) ? 'settings' : route;
 if(state.page === 'settings') state.settingsView = ['sources','settings/sources'].includes(route) ? 'sources' : 'general';
}
readRoute();
const admin=()=>store.role==='admin';
const canWrite=()=>['admin','editor'].includes(store.role);
const product=id=>data.products.find(p=>p.id===id);
// 停用品类 / 已删除品类从所有核价入口一并移除，报价数据本身不删。
const excludedCats=()=>new Set([...(data.prefs?.disabledCategories||[]),...(data.prefs?.deletedCategories||[])]);
const visibleProducts=()=>data.products.filter(p=>!excludedCats().has(p.category));
const categories=()=>[...new Set([...['猪','鸡','鸭','鹅','羊'].filter(c=>!excludedCats().has(c)),...visibleProducts().map(p=>p.category)])];
const productOptions=current=>{const list=visibleProducts();const cur=product(current);if(cur&&!list.includes(cur))list.unshift(cur);return list;};
const quoteVisible=q=>!excludedCats().has(product(q.product_id)?.category);
const HANDLED_LEADS=new Set(['converted','dismissed','deleted']);
const options=(values,current,first)=>`${first!==undefined?`<option value="">${esc(first)}</option>`:''}${values.map(v=>{const [value,label]=Array.isArray(v)?v:[v,v];return `<option value="${esc(value)}" ${current===value?'selected':''}>${esc(label)}</option>`;}).join('')}`;
const productLabel=p=>p?`${p.name} / ${p.state} / ${p.spec}`:'产品已移除';
const productCell=p=>p?`<div class="product-name">${esc(p.name)}<span class="tag ${p.state==='鲜品'?'fresh':'frozen'}">${esc(p.state)}</span></div><div class="product-spec">${esc(p.spec)}</div>`:'未知产品';
const queryOptions=(id,extra={})=>({days:state.days,basis:state.basis,province:state.province,productId:id,...extra});
const stats=id=>summarize(latestQuotes(data.quotes,queryOptions(id)));
// 来源 / 网址 / 采集痕迹一律只在「数据设置」输入密码解锁后出现。
const unlocked=()=>settingsAccess.isUnlocked();
const ORIGIN_LINE=/原文|采集|平台|脱敏|来源名称|联系人|电话|\u8089\u4ea4\u6240|\u0072oujiaosuo|https?:\/\//i;
const safeNotes=notes=>{
 if(unlocked())return String(notes??'');
 const text=String(notes??'').split('\n').filter(line=>line.trim()&&!ORIGIN_LINE.test(line)).join('\n').trim();
 return text||'无';
};
const periodSelect=()=>`<select aria-label="参考周期" data-filter="days">${options([[1,'当日报价'],[7,'近 7 天'],[30,'近 30 天']],state.days)}</select>`;
const basisSelect=()=>`<select aria-label="计价口径" data-filter="basis">${options(Object.entries(bases),state.basis)}</select>`;
const provinceSelect=()=>`<select aria-label="地区" data-filter="province">${options(provinces,state.province,'全国地区')}</select>`;
const categoryTabs=()=>`<div class="segmented" aria-label="品类筛选">${['',...categories()].map(c=>`<button data-category="${esc(c)}" class="${state.category===c?'active':''}" aria-pressed="${state.category===c}">${c?esc(c):'全部'}</button>`).join('')}</div>`;
function changeValue(values) { Object.assign(state,values,{pageNumber:1}); render(); }

function header() {
 const pending=data.quotes.filter(q=>q.status==='pending').length;
 return `<header class="topbar"><a href="#overview" class="brand" aria-label="行情跳动首页"><img src="./favicon.svg" alt=""><div><strong>行情跳动</strong></div></a><nav class="nav" aria-label="主导航">${[['overview','行情总览'],['compare','采购比价'],['review','报价审核'],['settings','数据设置']].map(([id,label])=>`<button data-page="${id}" class="${state.page===id?'active':''}">${label}${id==='review'&&pending?`<span class="count">${pending}</span>`:''}</button>`).join('')}</nav><div class="top-actions">${unlocked()?'<a class="text-btn" href="./leads.html">线索表 ↗</a>':''}<span class="mode">${store.cloud?'团队工作台':'正式版'}</span><button class="avatar" data-action="account" aria-label="账户信息">${admin()?'管':store.role==='editor'?'编':'览'}</button></div></header>`;
}
function render() {
 if(!['overview','compare','review','settings'].includes(state.page)) state.page='overview';
 app.innerHTML=header()+`<main class="shell">${({overview:overview,compare:compare,review:review,settings:settings}[state.page])()}<footer class="footer"><span><i class="dot"></i>行情跳动 · 让每一笔采购有据可依</span><span>样本参考均价，以实际询价及成交条件为准 ${icon('shield',12)}</span></footer></main>`;
}
// 导航已标明页面名称，正文不再重复大标题；只保留右对齐的操作按钮。
function pageActions() {
 return `<div class="page-actions heading-actions"><button class="btn" data-action="export">${icon('down',14)}<span class="export-label">导出数据</span></button>${canWrite()?`<button class="btn primary" data-action="add">${icon('plus',15)}录入报价</button>`:''}</div>`;
}
function deltaFor(id) {
 const now=stats(id).average; const before=summarize(latestQuotes(data.quotes,queryOptions(id,{day:shiftDay(dayString(),-1)}))).average;
 if(now==null||before==null) return '<span class="delta">暂无日变化</span>';
 const delta=now-before; const pct=delta/before*100;
 return `<span class="delta ${Math.abs(pct)<.005?'':delta>0?'up':'down'}">${Math.abs(pct)<.005?'—':delta>0?'↗':'↘'} ${Math.abs(pct).toFixed(2)}% <span class="subtle">较昨日</span></span>`;
}
function overview() {
 const visible=visibleProducts().filter(p=>!state.category||p.category===state.category);
 const representatives=categories().map(c=>visibleProducts().find(p=>p.category===c)).filter(Boolean);
 const rows=visible.map(p=> {
   const s=stats(p.id); const points=trend(data.quotes,queryOptions(p.id));
   const latest=latestQuotes(data.quotes,queryOptions(p.id)).map(q=>q.quoted_on).sort().at(-1);
   return `<tr><td>${productCell(p)}</td><td class="number">${money(s.average)}</td><td class="number green">${money(s.min)}</td><td class="range">${s.count?`${money(s.min)} – ${money(s.max)}`:'—'}</td><td>${s.count}<span class="subtle"> 条 / ${s.provinceCount} 省</span>${s.count&&s.sparse?'<div class="subtle">样本较少</div>':''}</td><td>${spark(points.map(v=>v.average))}</td><td class="subtle">${latest?.slice(5)||'暂无'}</td><td><button class="row-action" data-compare="${esc(p.id)}">去比价 ${icon('arrow',13)}</button></td></tr>`;
 }).join('');
 return pageActions()+`<div class="filters"><span class="label">参考范围</span>${periodSelect()}${provinceSelect()}${basisSelect()}<span class="date-note right">${icon('clock',13)} 北京时间 ${dayString().replaceAll('-','.')} · 元 / kg</span></div><div class="cards">${representatives.map(p=>{
 const s=stats(p.id);return `<button class="price-card ${state.chartProduct===p.id?'selected':''}" data-chart="${esc(p.id)}"><div class="card-head"><span><span class="category-dot">${esc(p.category)}</span>${esc(p.name)}</span><span class="tag ${p.state==='鲜品'?'fresh':'frozen'}">${esc(p.state)}</span></div><div class="card-sub">${esc(p.spec)}</div><div class="card-price"><strong>${money(s.average)}</strong><span>元 / kg</span></div><div class="card-bottom">${deltaFor(p.id)}<span>${s.count} 个样本</span></div></button>`;
 }).join('')}</div><section class="panel"><div class="panel-head"><h2>产品参考均价 <small>独立规格，独立统计</small></h2>${categoryTabs()}</div>${data.quotes.some(q=>q.status==='approved')?'':`<div class="review-intro">${icon('info',14)} 还没有已入库的供货报价，产品均价暂为空。录入一条报价后，这里才会出现供货均价。</div>`}<div class="table-wrap"><table><thead><tr><th>产品 / 规格</th><th>样本均价</th><th>最低供货价</th><th>价格区间</th><th>有效样本 / 覆盖</th><th>7 日均价走势</th><th>最新报价</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="8" class="empty">暂无产品，请在数据与设置中添加</td></tr>'}</tbody></table></div><div class="table-foot"><span>${icon('info',12)} ${esc(bases[state.basis])} · 同供应商、同省、同规格保留最新有效报价；均价按供应商等权计算。</span><span>${state.province?'区域样本':'全国采样'} · 非官方全国统计均价</span></div></section><div class="bottom-grid">${chartPanel()}${recentPanel()}</div>`;
}
function spark(values) {
 const valid=values.filter(v=>v!=null); if(valid.length<2) return '<span class="subtle">暂无走势</span>';
 const min=Math.min(...valid)-.05, range=Math.max(...valid)-min+.05;
 let segments=[],current=[];
 values.forEach((v,i)=>{ if(v==null){if(current.length) segments.push(current); current=[];}else current.push(`${4+i*86/(values.length-1)},${23-(v-min)/range*19}`); });
 if(current.length) segments.push(current);
 return `<svg class="spark" viewBox="0 0 94 27" role="img" aria-label="最近七日样本均价走势"><title>${values.map(v=>money(v)).join('，')}</title>${segments.map(s=>`<polyline points="${s.join(' ')}" fill="none" stroke="#74a78b" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
}
function chartPanel() {
 if(!product(state.chartProduct)||excludedCats().has(product(state.chartProduct)?.category)) state.chartProduct=visibleProducts()[0]?.id;
 const p=product(state.chartProduct); const values=trend(data.quotes,queryOptions(p?.id),7);
 const valid=values.filter(x=>x.average!=null); const s=stats(p?.id);
 const low=valid.length?Math.min(...valid.map(x=>x.average))-.3:0, high=valid.length?Math.max(...valid.map(x=>x.average))+.3:1;
 const y=v=>130-(v-low)/(high-low)*105;
 let lines=[],segment=[];
 values.forEach((v,i)=>{if(v.average==null){if(segment.length)lines.push(segment);segment=[];} else segment.push(`${43+i*440/6},${y(v.average)}`);}); if(segment.length)lines.push(segment);
 const svg=valid.length?`<svg class="chart" viewBox="0 0 510 165" role="img" aria-label="${esc(productLabel(p))}近七日均价"><title>${values.map(v=>`${v.day}：${money(v.average)}元/kg`).join('；')}</title>${[0,1,2].map(i=>{const n=low+(high-low)*i/2;return `<line x1="43" y1="${y(n)}" x2="486" y2="${y(n)}" stroke="#edf1ee" stroke-dasharray="3 4"/><text x="0" y="${y(n)+4}">${money(n)}</text>`;}).join('')}${lines.map(l=>`<polyline points="${l.join(' ')}" fill="none" stroke="#368b65" stroke-width="2.2" stroke-linejoin="round"/>`).join('')}${values.map((v,i)=>`<text x="${43+i*440/6}" y="157" text-anchor="middle">${v.day.slice(5).replace('-','/')}</text>${v.average!=null?`<circle cx="${43+i*440/6}" cy="${y(v.average)}" r="3" fill="white" stroke="#368b65" stroke-width="1.8"><title>${v.day} ${money(v.average)}元/kg</title></circle>`:''}`).join('')}</svg>`:'<div class="chart-empty">暂无有效报价，录入后即可查看走势</div>';
 return `<section class="panel"><div class="panel-head"><h2>均价走势 <small>最近 7 日</small></h2><select aria-label="走势产品" data-filter="chartProduct">${options(visibleProducts().map(p=>[p.id,`${p.name} · ${p.state} · ${p.spec}`]),state.chartProduct)}</select></div><div class="chart-wrap"><div class="chart-summary"><strong>${money(s.average)}</strong><span class="subtle">元 / kg</span>${deltaFor(p?.id)}</div>${svg}</div><div class="chart-legend"><i class="dot"></i>${esc(productLabel(p))} · ${esc(bases[state.basis])}</div></section>`;
}
function recentPanel() {
 const recent=data.quotes.filter(q=>q.status==='approved'&&quoteVisible(q)).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)).slice(0,4);
 return `<section class="panel"><div class="panel-head"><h2>最近入库</h2><button class="text-btn" data-page="compare">全部报价 ${icon('arrow',12)}</button></div><div class="recent-list">${recent.map(q=>`<div class="recent-row"><div class="recent-icon">${icon('check',15)}</div><div class="recent-text"><strong>${esc(product(q.product_id)?.name)} <span class="subtle">/ ${esc(product(q.product_id)?.state)} · ${esc(q.province)}</span></strong><p>${esc(q.supplier)} · ${esc(q.quoted_on.slice(5))}</p></div><button class="recent-price" data-detail="${esc(q.id)}">¥ ${money(q.price)}<small>已入库</small></button></div>`).join('')||'<div class="empty">还没有入库报价</div>'}</div></section>`;
}
function comparisonRows() {
 return latestQuotes(data.quotes,{...queryOptions(state.product),category:state.category,products:visibleProducts(),source:state.source}).filter(q=>quoteVisible(q)&&(!state.search||[q.supplier,q.city,q.province,productLabel(product(q.product_id))].join(' ').toLowerCase().includes(state.search.toLowerCase()))).sort((a,b)=>state.sort==='date'?b.quoted_on.localeCompare(a.quoted_on):a.price-b.price);
}
function compare() {
 const rows=comparisonRows(); const p=product(state.product); const s=p?summarize(rows):null;
 const pageSize=20; const total=Math.max(1,Math.ceil(rows.length/pageSize)); state.pageNumber=Math.min(state.pageNumber,total);
 const pageRows=rows.slice((state.pageNumber-1)*pageSize,state.pageNumber*pageSize);
 return pageActions()+`<div class="filter-panel"><div class="filters">${categoryTabs()}<label class="search">${icon('search',15)}<input aria-label="搜索供应商或地区" placeholder="搜索供应商、地区…" value="${esc(state.search)}" id="search"></label></div><div class="filters"><select aria-label="产品规格" data-filter="product">${options(visibleProducts().filter(p=>!state.category||p.category===state.category).map(p=>[p.id,productLabel(p)]),state.product,'全部产品规格')}</select>${provinceSelect()}${periodSelect()}${basisSelect()}<button class="text-btn right" data-action="reset-filters">重置筛选</button></div></div>${s?`<div class="summary-strip">${[['样本均价',money(s.average),'元/kg'],['最低供货价',money(s.min),'元/kg'],['中位价格',money(s.median),'元/kg'],['有效供应商样本',s.count,'个'],['覆盖省份',s.provinceCount,'省']].map(([label,val,unit])=>`<div class="summary-item"><p>${label}</p><strong>${val}</strong><small>${unit}</small></div>`).join('')}</div>`:`<div class="review-intro">${icon('info',14)} 选择具体产品规格后显示均价和中位价。不同规格的价格分别比较。</div>`}<section class="panel"><div class="panel-head"><h2>${p?esc(p.name)+' · '+esc(p.state):'供货报价'} <small>${rows.length} 条最新有效报价${s?.sparse?' · 样本较少，请继续补充询价':''}</small></h2><select aria-label="排序方式" data-filter="sort">${options([['price','供货价：从低到高'],['date','报价日：从新到旧']],state.sort)}</select></div><div class="table-wrap"><table><thead><tr><th>产品 / 规格</th><th>供应商 / 地区</th><th>供货价 · 元/kg</th><th>参考含运价</th><th>采购条件</th><th>报价日 / 有效期</th><th></th></tr></thead><tbody>${pageRows.map(q=>`<tr><td>${productCell(product(q.product_id))}</td><td><div>${esc(q.supplier)}</div><div class="product-spec">${esc(q.province)} · ${esc(q.city||'未填城市')}</div></td><td class="number ${p&&q.price===s?.min?'green':''}">${money(q.price)}${p&&q.price===s?.min?'<span class="tag fresh">最低</span>':''}</td><td>${q.basis==='delivered'?money(q.price):q.freight!=null?money(Number(q.price)+Number(q.freight)):'<span class="subtle">运费待询</span>'}${q.basis==='untaxed'?'<div class="subtle">未含税</div>':''}</td><td>${esc(q.min_order||'起订量待询')}<div class="product-spec">${esc(bases[q.basis])}</div></td><td>${esc(q.quoted_on)}<div class="product-spec">有效至 ${esc(q.valid_until)}</div></td><td><button class="row-action" data-detail="${esc(q.id)}">详情 ${icon('chevron',12)}</button></td></tr>`).join('')||'<tr><td colspan="7" class="empty">没有符合条件的有效报价，试试调整筛选或录入报价。</td></tr>'}</tbody></table></div><div class="pagination"><span>${rows.length} 条 · 已去重，过期与未确认报价不参与</span><div><button class="btn small" data-pagination="-1" ${state.pageNumber<=1?'disabled':''}>上一页</button><span>${state.pageNumber} / ${total}</span><button class="btn small" data-pagination="1" ${state.pageNumber>=total?'disabled':''}>下一页</button></div></div></section>`;
}
function review() {
 const rows=data.quotes.filter(q=>q.status===state.reviewStatus).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
 const limited=rows.slice(0,100);
 return pageActions()+`<div class="review-intro">${icon('shield',15)} ${admin()?'待确认报价入库后才参与均价。价格过低或过高时，请先核实规格、日期、税费与起订量。':'你可以查看报价记录。编辑人员提交的报价，由管理员审核后入库。'}</div><div class="filters"><div class="segmented">${Object.entries(statuses).map(([id,label])=>`<button data-review-status="${id}" class="${state.reviewStatus===id?'active':''}">${label} ${data.quotes.filter(q=>q.status===id).length}</button>`).join('')}</div><button class="btn right" data-action="refresh">${icon('refresh',14)}刷新记录</button></div><section class="panel"><div class="table-wrap"><table><thead><tr><th>产品 / 规格</th><th>供应商 / 地区</th><th>供货价 · 元/kg</th><th>报价口径</th><th>报价日 / 有效期</th><th>处理</th></tr></thead><tbody>${limited.map(q=>`<tr><td>${productCell(product(q.product_id))}</td><td>${esc(q.supplier)}<div class="product-spec">${esc(q.province)} ${esc(q.city)}</div></td><td class="number">${money(q.price)}</td><td class="subtle">${esc(bases[q.basis])}</td><td>${esc(q.quoted_on)}<div class="product-spec">有效至 ${esc(q.valid_until)}${q.valid_until<dayString()?' · 已过期':''}</div></td><td><div class="review-actions"><button class="btn small" data-detail="${esc(q.id)}">核对</button>${admin()&&state.reviewStatus==='pending'?`<button class="btn primary small" data-review="approved" data-id="${esc(q.id)}">确认</button><button class="btn small danger" data-review="rejected" data-id="${esc(q.id)}">忽略</button>`:admin()&&state.reviewStatus!=='pending'?`<button class="text-btn" data-review="pending" data-id="${esc(q.id)}">退回待审</button>`:''}</div></td></tr>`).join('')||'<tr><td colspan="6" class="empty">这个列表里暂时没有报价</td></tr>'}</tbody></table></div><div class="table-foot"><span>显示最近 ${limited.length} / ${rows.length} 条 · 已忽略、未确认、过期报价均不参与当前均价。</span></div></section>`;
}
function sourcesPage() {
 // 入库 / 忽略 / 删除的线索不再占用待审列表，改由「已处理」按钮统一管理。
 const allLeads=data.leads||[];
 const activeLeads=allLeads.filter(l=>!HANDLED_LEADS.has(l.status));
 const match=l=>(!state.leadKind||l.kind===state.leadKind)&&matchesLeadCategory(l,state.leadCategory);
 const leads=activeLeads.filter(match).sort((a,b)=>(b.published_on||'').localeCompare(a.published_on||'')||Date.parse(b.fetched_at)-Date.parse(a.fetched_at));
 const handledCount=allLeads.filter(l=>HANDLED_LEADS.has(l.status)&&matchesLeadCategory(l,state.leadCategory)).length;
 const total=Math.max(1,Math.ceil(leads.length/20));state.pageNumber=Math.min(state.pageNumber,total);
 const rows=leads.slice((state.pageNumber-1)*20,state.pageNumber*20);
 const catalog=sourceCatalog.filter(s=>!state.sourceKind||s.kind===state.sourceKind);
 const latest=(data.leads||[]).map(l=>l.fetched_at).sort().at(-1);
 const failedSources=(store.discovery?.runs||[]).filter(r=>!r.ok).map(r=>sourceCatalog.find(s=>s.id===r.source_id)?.name||r.source_id);
 const collectionNotice=failedSources.length?`<div class="notice">${esc(failedSources.join('、'))}本次采集未成功，保留上次线索；其余来源正常更新。</div>`:'';
 return `<div class="review-intro">${icon('info',15)} 点「核实入库」核对后直接入库；系统补全的项会标注，可在报价详情里修改。</div>${store.discovery?.error?`<div class="notice">采集快照加载失败：${esc(store.discovery.error)}</div>`:''}${collectionNotice}<section class="panel"><div class="panel-head"><h2>自动采集线索 <small>${latest?'最近采集 '+esc(new Date(latest).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})):'尚未采集'}</small></h2>${admin()?`<button class="btn small" data-action="managed-leads">已处理 ${handledCount}</button>`:''}</div><div class="lead-tabs"><div class="segmented">${Object.entries({'':'全部类型',...sourceKinds}).map(([kind,name])=>`<button data-lead-kind="${kind}" class="${state.leadKind===kind?'active':''}">${name} ${activeLeads.filter(l=>(!kind||l.kind===kind)&&matchesLeadCategory(l,state.leadCategory)).length}</button>`).join('')}</div><select aria-label="线索品类" data-filter="leadCategory">${options(['猪','鸡','鸭','鹅','羊','牛'],state.leadCategory,'全部品类')}</select><span class="subtle">未核对的线索不参与供货均价</span></div><div class="table-wrap"><table><thead><tr><th>原文产品 / 标题</th><th>标价原文</th><th>地区 / 发布日期</th><th>来源</th><th>核对与处理</th></tr></thead><tbody>${rows.map(l=>`<tr><td class="lead-title"><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.title)}</a><div class="product-spec lead-note">${esc(l.details)}</div></td><td>${esc(l.price_text||'见原文')}</td><td>${esc(l.region_text||'原文范围')}<div class="product-spec">${esc(l.published_on||'日期待核实')}</div></td><td>${esc(l.source_name)}<div class="product-spec">${esc(sourceKinds[l.kind])}</div></td><td><div class="review-actions lead-actions"><a class="btn small" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" aria-label="查看原文：${esc(l.title)}">查看原文 ↗</a>${l.kind==='supply'&&canWrite()?`<div class="review-actions"><button class="btn small primary" data-lead="${esc(l.id)}">核实入库</button>${admin()?`<button class="text-btn" data-dismiss-lead="${esc(l.id)}">忽略</button>`:''}</div>`:'<span class="subtle">仅作外部参考</span>'}</div></td></tr>`).join('')||'<tr><td colspan="5" class="empty">当前筛选下暂无待核实线索，可切换品类，或点「已处理」查看已入库线索。</td></tr>'}</tbody></table></div><div class="pagination"><span>${leads.length} 条待核实线索 · 已入库的自动隐藏</span><div><button class="btn small" data-pagination="-1" ${state.pageNumber<=1?'disabled':''}>上一页</button><span>${state.pageNumber} / ${total}</span><button class="btn small" data-pagination="1" ${state.pageNumber>=total?'disabled':''}>下一页</button></div></div></section><section class="panel" style="margin-top:20px"><div class="panel-head"><h2>来源目录 <small>${sourceCatalog.length} 个候选来源</small></h2><select aria-label="来源分类" data-filter="sourceKind">${options(Object.entries(sourceKinds),state.sourceKind,'全部来源类型')}</select></div><div class="table-wrap"><table><thead><tr><th>来源</th><th>用途 / 覆盖</th><th>接入进度</th><th>口径与说明</th></tr></thead><tbody>${catalog.map(s=>`<tr><td><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)} ↗</a></td><td>${esc(sourceKinds[s.kind])}<div class="product-spec">${esc(s.scope)}</div></td><td class="subtle">${esc(s.status)}</td><td class="source-notes">${esc(s.note)}</td></tr>`).join('')}</tbody></table></div><div class="table-foot"><span>公开列表每天定时核对三次；付费、登录、验证码及不可访问来源需要单独接入。已核验表示页面可见，不表示报价已认证。</span></div></section>`;
}
// 已处理线索管理：修改报价 / 撤销入库 / 删除 / 恢复，操作后整页重新渲染。
function managedLeadsDialog() {
 if(!admin())return;
 const handled=(data.leads||[]).filter(l=>HANDLED_LEADS.has(l.status)).sort((a,b)=>(b.published_on||'').localeCompare(a.published_on||''));
 const rows=handled.map(l=>{
  const quote=data.quotes.find(q=>q.collection_item_id===l.id);
  const label=l.status==='converted'?'已入库':l.status==='deleted'?'已删除':'已忽略';
  const pill=l.status==='deleted'?'off':l.status==='converted'?'':'warn';
  return `<div class="manager-row"><span><strong>${esc(l.title)}</strong><div class="product-spec">${label}<span class="pill ${pill}">${esc(l.published_on||'日期待核实')}</span>${quote?` · ¥ ${money(quote.price)} / kg`:''}</div></span><div class="manager-actions">${quote?`<button class="btn small" data-edit="${esc(quote.id)}">修改报价</button><button class="text-btn" data-undo-lead="${esc(l.id)}">撤销入库</button>`:''}${l.status==='converted'?'':`<button class="btn small" data-restore-lead="${esc(l.id)}">恢复待审</button>`}${l.status==='deleted'?'':`<button class="text-btn" data-delete-lead="${esc(l.id)}">删除</button>`}</div></div>`;
 }).join('')||'<div class="empty" style="padding:34px 10px">还没有已处理的线索</div>';
 showDialog(dialogHead('已处理线索',`${handled.length} 条 · 已入库后自动从待审列表隐藏`)+`<div class="form-body"><p class="form-error" role="alert"></p><div class="manager-list">${rows}</div><p class="subtle" style="margin:14px 0 0">「删除」只把线索移出队列、报价保留，可随时恢复；「撤销入库」会删除该线索生成的报价并放回待审。</p></div><div class="dialog-foot"><button class="btn" data-action="close">关闭</button></div>`);
}
function settings() {
 if(!settingsAccess.isUnlocked()) {
  return `<section class="settings-unlock panel"><div class="settings-unlock-icon">${icon('shield',22)}</div><h2>输入设置密码</h2><p>解锁后可查看基础设置和来源中心。</p><form id="settings-unlock-form"><p class="form-error" role="alert"></p><div class="field"><label for="settings-password">入口密码</label><input id="settings-password" name="password" type="password" autocomplete="off" required maxlength="256" placeholder="请输入密码"></div><button class="btn primary" type="submit">解锁数据设置</button></form><small>仅在当前标签页保持解锁，可随时手动锁定。</small></section>`;
 }
 return pageActions() + `<div class="settings-tabs"><div class="segmented" aria-label="数据设置栏目"><button data-settings-view="general" class="${state.settingsView==='general'?'active':''}" aria-pressed="${state.settingsView==='general'}">基础设置</button><button data-settings-view="sources" class="${state.settingsView==='sources'?'active':''}" aria-pressed="${state.settingsView==='sources'}">来源中心</button></div><button class="btn small" data-action="lock-settings">${icon('shield',13)}锁定</button></div>` + (state.settingsView==='sources' ? sourcesPage() : settingsBody());
}
function settingsBody() {
 return `<div class="filter-panel"><div class="filters"><label for="settings-category">核价品类</label><select id="settings-category" aria-label="核价品类" data-filter="leadCategory">${options(categories(),state.leadCategory,'全部品类')}</select>${admin()?'<button class="btn small" data-action="manage-categories">管理品类</button>':''}</div></div><div class="settings-grid"><section class="panel"><div class="panel-head"><h2>产品库 <small>${visibleProducts().length} 个规格</small></h2>${admin()?'<button class="text-btn" data-action="add-product">+ 添加产品</button>':''}</div><div class="settings-body">${visibleProducts().map(p=>`<div class="settings-row"><span><span class="category-dot">${esc(p.category)}</span>${esc(p.name)} <small>${esc(p.state)}</small></span><small>${esc(p.spec)}</small></div>`).join('')}</div></section><section class="panel"><div class="panel-head"><h2>数据来源</h2><span class="mode">人工确认后入库</span></div><div class="settings-body"><h3>人工询价</h3><p>电话、微信或线下询价，记录供应商、报价日、有效期及采购条件。编辑人员提交后由管理员确认。</p><h3>引擎采集</h3><p>当前接入四类冻品供货线索（清远鸡、白条鹅、清远麻鸡、鸽子），在来源中心逐条核对后转成报价。行情价与供货价分开处理，不混算。</p><div class="settings-row"><span>公开网页适配器</span><strong>${(store.discovery?.runs||[]).length||7} 个</strong></div><p style="margin-top:12px">另支持 JSON / CSV 授权接口。市场行情、官方监测与供货价分别处理；付费或登录内容仍待单独接入。</p><a href="#settings/sources">查看来源中心 →</a><h3>采集配置</h3><p>在仓库 <code>collector/sources.json</code> 配置接口及字段映射，通过 GitHub Actions 运行。</p></div></section><section class="panel"><div class="panel-head"><h2>统计口径</h2>${icon('info',15)}</div><div class="settings-body"><ul><li>按产品规格、鲜冻状态、含税及运输口径独立统计，统一换算为元 / kg。</li><li>周期内，同供应商、同省、同规格、同口径取最新有效报价，按供应商等权算术平均，同时显示中位价与最低价。</li><li>只纳入已确认、未过期的报价。低于 5 个样本或覆盖少于 3 省，标记“样本较少”。</li><li>全国地区表示采样范围，不代表全国全部市场。品类卡片显示一个明确的代表规格，不把不同产品混成一个均价。</li><li>走势按历史当日有效样本回算；后续补录或更改审核状态可能改变历史曲线。</li><li>参考含运价为报价加填写的每公斤运费；未税报价仍需另核税费。最低供货价仍需核实品质、起订量和到货条件。</li></ul></div></section><section class="panel"><div class="panel-head"><h2>团队与访问</h2>${icon('shield',15)}</div><div class="settings-body"><div class="settings-row"><span>当前模式</span><strong>${store.cloud?'共享数据库':'正式版'}</strong></div><div class="settings-row"><span>当前角色</span><strong>${({admin:'管理员',editor:'编辑人员',viewer:'只读成员'})[store.role]}</strong></div><div class="settings-row"><span>数据保存位置</span><strong>${store.cloud?'共享数据库':'此设备（未上传）'}</strong></div>${!store.cloud?'<p style="margin-top:12px">换设备或手机查看时，先在这台设备「导出完整备份」，再到另一台「导入备份」；自动同步需连接共享数据库。</p>':''}<div class="heading-actions"><button class="btn" data-action="backup">${icon('down',14)}导出完整备份</button><button class="btn" data-action="import-backup">导入备份</button><input type="file" id="import-backup-file" accept="application/json,.json" hidden>${store.cloud?`${admin()?'<button class="btn" data-action="members">管理成员</button>':''}<button class="btn" data-action="logout">退出登录</button>`:''}</div></div></section></div>`;
}
function showDialog(html) { dialog.innerHTML=html; if(!dialog.open) dialog.showModal(); }
const dialogHead=(title,sub='')=>`<div class="dialog-head"><div><h2 id="dialog-title">${title}</h2>${sub?`<p>${sub}</p>`:''}</div><button class="close" data-action="close" aria-label="关闭">${icon('close',20)}</button></div>`;
const field=(label,html,full=false)=>`<div class="field ${full?'full':''}"><label>${label}</label>${html}</div>`;
// 核实入库：先看一眼匹配结果，确认即直接写库；要改才打开完整表单。
function quickConvertDialog(lead) {
 if(!canWrite()||!lead)return;
 const q=buildQuickQuote(lead,data.products);
 const extra=[q.contact?`联系人 ${esc(q.contact)}`:'',q.phone?`电话 ${esc(q.phone)}（平台脱敏）`:'',q.specClue&&q.specClue!=='待核实'?`规格线索 ${esc(q.specClue.slice(0,42))}`:''].filter(Boolean).join(' · ');
 const stale=q.staleDays!=null&&q.staleDays>30?`<div class="review-intro" style="margin:0 0 14px">${icon('info',14)} 原文发布于 ${esc(q.originalDate)}（${q.staleDays} 天前），价格可能已失效，请重点复核。</div>`:'';
 const blocked=q.ok?'':`<div class="review-intro" style="margin:0 0 14px">${icon('info',14)} ${q.reasons.map(esc).join('；')}，请点「修改后再录」补齐。</div>`;
 showDialog(dialogHead('确认入库',esc(lead.title))+`<div class="form-body"><p class="form-error" role="alert"></p>${stale}${blocked}<div class="settings-body" style="padding:0;line-height:1.6">${q.rows.map(r=>`<div class="settings-row"><span>${esc(r.label)}<small class="product-spec" style="display:block">${esc(r.note)}</small></span><strong>${esc(r.value)}</strong></div>`).join('')}${extra?`<p class="subtle" style="margin:14px 0 0">${extra}</p>`:''}<p class="subtle" style="margin:14px 0 0">系统补全项已写入备注，入库后可在「报价审核 → 详情 → 编辑报价」修改。<a href="${esc(lead.url)}" target="_blank" rel="noopener noreferrer">查看采集原文 ↗</a></p></div></div><div class="dialog-foot"><button class="btn" data-action="close">取消</button><button class="btn" data-quick-edit="${esc(lead.id)}">修改后再录</button>${q.ok?`<button class="btn primary" data-quick-confirm="${esc(lead.id)}">确认入库</button>`:''}</div>`);
}
function quoteForm(existing,lead) {
 if(!canWrite()) return;
 let collectedProduct;
 const q=existing||{product_id:state.product||data.products[0]?.id,price:'',province:'',city:'',supplier:'',basis:state.basis,source:'manual',source_name:'电话询价',source_url:'',quoted_on:dayString(),valid_until:shiftDay(dayString(),2),min_order:'',freight:'',notes:''};
 if(lead) {
  if(lead.kind!=='supply')return;
  const prefill=leadPrefill(lead);
  collectedProduct=prefill.product;
  const matched=data.products.find(p=>collectedProduct.name&&collectedProduct.state&&collectedProduct.spec&&['category','name','state','spec'].every(k=>p[k]===collectedProduct[k]));
  Object.assign(q,prefill.quote,{product_id:matched?.id||(admin()?'__new__':'')});
 }
 showDialog(dialogHead(existing?'编辑报价':'录入报价','统一以元 / kg 入库，鲜冻、规格和价格口径分别比较。')+`${lead?`<div class="lead-origin"><span>已带入待核实信息，可修改；请核对并补齐规格、状态及供货条件。</span>${unlocked()?`<a class="btn small" href="${esc(lead.url)}" target="_blank" rel="noopener noreferrer">查看详情 ↗</a>`:''}</div>`:''}<form id="quote-form" data-id="${esc(existing?.id||'')}" data-lead-id="${esc(lead?.id||'')}"><div class="form-body"><p class="form-error" role="alert"></p><div class="form-grid">${field('产品 / 规格 <span>*</span>',`<select name="product_id" aria-label="产品规格" required>${options(productOptions(q.product_id).map(p=>[p.id,productLabel(p)]),q.product_id,'请选择具体产品规格')}${admin()?'<option value="__new__">手工填写新产品 / 规格</option>':''}</select>${admin()?'<button class="text-btn" type="button" id="custom-product-button">+ 手工新增产品 / 规格</button>':''}`,true)}${admin()?`<div class="full custom-product-fields" id="custom-product-fields" hidden>${field('品类 <span>*</span>',`<input name="custom_category" aria-label="自定义品类" list="custom-categories" maxlength="20" placeholder="例如：鹅" disabled><datalist id="custom-categories">${categories().map(c=>`<option value="${esc(c)}">`).join('')}</datalist>`)}${field('产品名称 <span>*</span>','<input name="custom_name" aria-label="自定义产品名称" maxlength="60" placeholder="例如：狮头鹅、鹅掌" disabled>')}${field('鲜冻 / 状态 <span>*</span>',`<select name="custom_state" aria-label="自定义产品状态" disabled>${options(['鲜品','冻品','活体','冷鲜'],'','请选择鲜冻状态')}</select>`)}${field('规格 <span>*</span>','<input name="custom_spec" aria-label="自定义规格" maxlength="160" placeholder="部位、产地、等级、重量、包装等" disabled>')}</div>`:''}${field('供货价格 <span>*</span>',`<div class="price-input"><input name="price" aria-label="供货价格" type="number" step="0.0001" min="0.0001" value="${esc(q.price)}" required placeholder="请输入价格"><select name="unit" aria-label="计价单位">${options([['kg','元 / kg'],['jin','元 / 斤'],['ton','元 / 吨']],'kg')}</select></div>`)}${field('价格口径 <span>*</span>',`<select name="basis" aria-label="价格口径" required>${options(Object.entries(bases),q.basis,'核实后选择价格口径')}</select>`)}${field('供应商 / 市场 <span>*</span>',`<input name="supplier" aria-label="供应商" value="${esc(q.supplier)}" required maxlength="120" placeholder="尽量统一供应商名称">`)}${field('报价省份 <span>*</span>',`<select name="province" aria-label="报价省份" required>${options(provinces,q.province,'请选择省份')}</select>`)}${field('城市',`<input name="city" aria-label="城市" maxlength="60" value="${esc(q.city)}" placeholder="例如：潍坊">`)}${field('起订量',`<input name="min_order" aria-label="起订量" maxlength="100" value="${esc(q.min_order)}" placeholder="例如：500 kg">`)}${field('报价日期 <span>*</span>',`<input name="quoted_on" aria-label="报价日期" type="date" value="${q.quoted_on}" max="${dayString()}" required>`)}${field('报价有效至 <span>*</span>',`<input name="valid_until" aria-label="有效期" type="date" value="${q.valid_until}" required>`)}${field('每公斤运费',`<input name="freight" aria-label="每公斤运费" type="number" step="0.01" min="0" value="${esc(q.freight??'')}" placeholder="元 / kg，未知留空"><small>到货价已含运时无需填写。</small>`)}${unlocked()?`${field('来源方式',`<select name="source" aria-label="来源方式">${options([['manual','人工询价'],['engine','引擎采集 / 手动补录']],q.source)}</select>`)}${field('来源名称',`<input name="source_name" aria-label="来源名称" maxlength="120" value="${esc(q.source_name)}" placeholder="电话、微信或行情网站名称">`)}${field('原始链接',`<input name="source_url" aria-label="原始链接" type="url" value="${esc(q.source_url)}" placeholder="链接（可选）">`)}`:`<input type="hidden" name="source" value="${esc(q.source)}"><input type="hidden" name="source_name" value="${esc(q.source_name)}"><input type="hidden" name="source_url" value="${esc(q.source_url)}">`}${field('备注 / 询价联系人',`<textarea name="notes" aria-label="备注" maxlength="2000" placeholder="品质、账期、联系人、特殊条件等">${esc(q.notes)}</textarea>`,true)}${admin()?field('入库方式',`<select name="status" aria-label="入库方式">${options([['approved','确认无误，直接入库'],['pending','先存入待确认']],existing?.status==='rejected'?'pending':q.status||'approved')}</select><small>引擎来源的新报价默认待确认；审核后再入库。</small>`,true):'<div class="subtle full">提交后进入待确认列表，管理员确认后参与统计。</div>'}</div></div><div class="dialog-foot"><button type="button" class="btn" data-action="close">取消</button><button type="submit" class="btn primary">${existing?'保存修改':admin()?'保存报价':'提交审核'}</button></div></form>`);
 const productSelect=dialog.querySelector('[name=product_id]');
 const customFields=dialog.querySelector('#custom-product-fields');
 if(customFields){
  productSelect.addEventListener('change',()=>{const enabled=productSelect.value==='__new__';customFields.hidden=!enabled;for(const input of customFields.querySelectorAll('input,select')){input.disabled=!enabled;input.required=enabled;}});
  if(collectedProduct){
   for(const [key,value] of Object.entries(collectedProduct)){const input=customFields.querySelector('[name="custom_'+key+'"]');if(input)input.value=value;}
   productSelect.value=q.product_id;
   productSelect.dispatchEvent(new Event('change'));
  }
  dialog.querySelector('#custom-product-button').addEventListener('click',()=>{productSelect.value='__new__';productSelect.dispatchEvent(new Event('change'));customFields.querySelector('input').focus();});
 }
 dialog.querySelector('[name=source]').addEventListener('change',e=>{const status=dialog.querySelector('[name=status]');if(status&&e.target.value==='engine')status.value='pending';});
}
function quoteDetail(id) {
 const q=data.quotes.find(q=>q.id===id); if(!q)return;
 const p=product(q.product_id);
 showDialog(dialogHead('报价详情',productLabel(p))+`<div class="form-body"><div class="form-grid">${[['供应商',q.supplier],['地区',`${q.province} ${q.city}`],['供货价格',`¥ ${money(q.price)} / kg`],['价格口径',bases[q.basis]],['报价日期',q.quoted_on],['有效期',q.valid_until],['起订量',q.min_order||'未填写'],['每公斤运费',q.freight!=null?`¥ ${money(q.freight)}`:'待询'],...(unlocked()?[['来源',`${q.source==='engine'?'引擎采集':'人工询价'} · ${q.source_name||'未填写'}`]]:[]),['状态',`${statuses[q.status]}${q.valid_until<dayString()?' · 已过期':''}`]].map(([l,v])=>field(l,`<div>${esc(v)}</div>`)).join('')}${unlocked()?field('原始来源',q.source_url?`<a target="_blank" rel="noopener noreferrer" href="${esc(/^https?:\/\//i.test(q.source_url)?q.source_url:'#')}">${esc(q.source_url)}</a>`:'<span class="muted">未提供链接</span>',true):''}${field('备注',`<div style="white-space:pre-wrap;line-height:1.8">${esc(safeNotes(q.notes))}</div>`,true)}${q.reviewed_at?field('最近审核时间',`<span class="subtle">${esc(new Date(q.reviewed_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))}</span>`,true):''}</div></div><div class="dialog-foot">${admin()?`<button class="btn" data-edit="${esc(q.id)}">编辑报价</button>${q.status==='pending'?`<button class="btn danger" data-review="rejected" data-id="${esc(q.id)}">忽略</button><button class="btn primary" data-review="approved" data-id="${esc(q.id)}">确认入库</button>`:''}`:''}<button class="btn" data-action="close">关闭</button></div>`);
}
// 核价品类管理：改名 / 停用 / 删除（可恢复），停用后全站核价入口一并移除。
function categoryDialog() {
 if(!admin())return;
 const prefs=data.prefs||{}, disabled=new Set(prefs.disabledCategories||[]), deleted=new Set(prefs.deletedCategories||[]);
 const active=categories().filter(c=>!disabled.has(c));
 const row=(c,mode)=>{
  const count=data.products.filter(p=>p.category===c).length;
  const label=mode==='active'?'使用中':mode==='disabled'?'已停用':'已删除';
  const buttons=mode==='active'
   ?`<button class="text-btn" data-cat-rename="${esc(c)}">改名</button><button class="text-btn" data-cat-disable="${esc(c)}">停用</button><button class="text-btn" data-cat-delete="${esc(c)}">删除</button>`
   :`<button class="btn small" data-cat-restore="${esc(c)}">恢复</button>`;
  return `<div class="manager-row"><span><strong>${esc(c)} <span class="pill ${mode==='active'?'':'off'}">${label}</span></strong><div class="product-spec">${count} 个规格</div></span><div class="manager-actions">${buttons}</div></div>`;
 };
 const groups=`<div class="manager-list">${active.map(c=>row(c,'active')).join('')||'<div class="empty" style="padding:26px 10px">暂无核价品类</div>'}</div>`
  +([...disabled].length?`<div class="manager-group"><h3>已停用</h3>${[...disabled].map(c=>row(c,'disabled')).join('')}</div>`:'')
  +([...deleted].length?`<div class="manager-group"><h3>已删除</h3>${[...deleted].map(c=>row(c,'deleted')).join('')}</div>`:'');
 showDialog(dialogHead('管理核价品类')+`<div class="form-body"><p class="form-error" role="alert"></p>${groups}<p class="subtle" style="margin:14px 0 0">停用 / 删除只影响核价与筛选显示，报价数据保留；删除会移除该品类下没有报价的产品规格。</p></div><div class="dialog-foot"><button class="btn" data-action="close">关闭</button></div>`);
}
function categoryRenameDialog(from) {
 showDialog(dialogHead('修改品类名称',esc(from))+`<form id="category-rename-form" data-from="${esc(from)}"><div class="form-body"><p class="form-error" role="alert"></p>${field('新品类名称',`<input name="name" aria-label="新品类名称" required maxlength="20" value="${esc(from)}">`)}</div><div class="dialog-foot"><button type="button" class="btn" data-action="close">取消</button><button type="submit" class="btn primary">保存</button></div></form>`);
}
function categoryDeleteDialog(from) {
 showDialog(dialogHead('删除品类',esc(from))+`<div class="form-body"><p class="form-error" role="alert"></p><p>将移除「${esc(from)}」及该品类下没有报价的产品规格。已有报价时会拒绝删除，请改用「停用」。</p></div><div class="dialog-foot"><button class="btn" data-action="close">取消</button><button class="btn danger" data-cat-delete-confirm="${esc(from)}">确认删除</button></div>`);
}
function productForm() {
 if(!admin())return;
 showDialog(dialogHead('添加产品规格','新物种也可以直接填写；规格尽量明确，便于以后比价。')+`<form id="product-form"><div class="form-body"><p class="form-error" role="alert"></p><div class="form-grid">${field('品类 <span>*</span>',`<input name="category" aria-label="品类" list="categories" required maxlength="20" placeholder="例如：鸡、牛、兔"><datalist id="categories">${categories().map(c=>`<option value="${esc(c)}">`).join('')}</datalist>`)}${field('产品名称 <span>*</span>','<input name="name" aria-label="产品名称" required maxlength="60" placeholder="例如：鸡胸肉">')}${field('产品状态 <span>*</span>',`<select name="state" aria-label="产品状态">${options(['鲜品','冻品','活体','冷鲜'],'鲜品')}</select>`)}${field('规格 <span>*</span>','<input name="spec" aria-label="规格" required maxlength="160" placeholder="部位、等级、重量范围等">')}</div></div><div class="dialog-foot"><button type="button" class="btn" data-action="close">取消</button><button type="submit" class="btn primary">添加产品</button></div></form>`);
}
function download(text,name,type='text/csv;charset=utf-8') {
 const url=URL.createObjectURL(new Blob([text],{type})); const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportForm() {
 if(!settingsAccess.isUnlocked())return;
 const initialType=state.settingsView==='sources'?'leads':'quotes';
 showDialog(dialogHead('筛选导出','按所选条件导出 CSV，可用 Excel 打开。日期按报价日或原文发布日期筛选。')+`<form id="export-form"><div class="form-body"><p class="form-error" role="alert"></p><div class="form-grid">${field('数据类型',`<select name="type" aria-label="导出数据类型">${options([['quotes','供货报价'],['leads','自动采集线索']],initialType)}</select>`)}${field('品类',`<select name="category" aria-label="导出品类">${options([...new Set([...categories(),'牛',...(data.leads||[]).map(l=>l.category).filter(Boolean)])],state.leadCategory,'全部品类')}</select>`)}<div class="full" id="export-quote-filters"><div class="form-grid">${field('产品 / 规格','<select name="product" aria-label="导出产品规格"></select>')}${field('省份',`<select name="province" aria-label="导出省份">${options(provinces,'','全部省份')}</select>`)}${field('审核状态',`<select name="status" aria-label="导出审核状态">${options(Object.entries(statuses),'','全部状态')}</select>`)}${field('报价来源',`<select name="source" aria-label="导出报价来源">${options([['manual','人工询价'],['engine','引擎采集']],'','全部来源')}</select>`)}</div></div>${field('开始日期','<input name="from" aria-label="导出开始日期" type="date">')}${field('结束日期','<input name="to" aria-label="导出结束日期" type="date">')}<p class="subtle full" id="export-count" role="status"></p></div></div><div class="dialog-foot"><button class="btn" type="button" data-action="close">取消</button><button class="btn primary" type="submit">导出 CSV</button></div></form>`);
 const form=dialog.querySelector('#export-form');
 const update=(resetProduct=false)=>{
  const fields=Object.fromEntries(new FormData(form));
  const quoteFields=form.querySelector('#export-quote-filters');
  quoteFields.hidden=fields.type==='leads';
  for(const input of quoteFields.querySelectorAll('select'))input.disabled=fields.type==='leads';
  const select=form.elements.product;
  const previous=resetProduct?'':select.value;
  select.innerHTML=options(visibleProducts().filter(p=>!fields.category||p.category===fields.category).map(p=>[p.id,productLabel(p)]),previous,'全部产品规格');
  const current=Object.fromEntries(new FormData(form));
  const count=form.querySelector('#export-count');
  try{const n=filterExport(data,current).length;count.textContent=`符合条件：${n} 条${current.type==='leads'?'；设置日期时不含日期待核实的线索':'；包含所选状态的历史报价，不做均价去重'}`;
   form.querySelector('[type=submit]').disabled=!n;form.querySelector('.form-error').textContent='';
  }catch(error){count.textContent='';form.querySelector('.form-error').textContent=error.message;form.querySelector('[type=submit]').disabled=true;}
 };
 form.addEventListener('change',event=>update(event.target.name==='category'));
 update();
}
function exportSelected(fields) {
 if(!settingsAccess.isUnlocked())throw new Error('请先解锁数据设置');
 const records=filterExport(data,fields);
 if(!records.length)throw new Error('当前筛选没有可导出的记录');
 let header,rows;
 if(fields.type==='leads'){
  header=['品类','来源','类型','标题','原始标价','地区','原文日期','链接','处理状态'];
  const labels={new:'待核对',converted:'已转为报价',dismissed:'已忽略'};
  rows=records.map(l=>[l.category,l.source_name,sourceKinds[l.kind],l.title,l.price_text,l.region_text,l.published_on,l.url,labels[l.status]||l.status]);
 }else{
  header=['品类','产品','状态','规格','供应商','省份','城市','供货价（元/kg）','报价口径','运费（元/kg）','起订量','报价日期','有效至','来源方式','来源名称','原始链接','审核状态','备注'];
  rows=records.map(q=>{const p=product(q.product_id);return [p?.category,p?.name,p?.state,p?.spec,q.supplier,q.province,q.city,q.price,bases[q.basis],q.freight,q.min_order,q.quoted_on,q.valid_until,q.source==='engine'?'引擎采集':'人工询价',q.source_name,q.source_url,statuses[q.status],q.notes];});
 }
 download('\uFEFF'+[header,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n'),`行情跳动-${fields.type==='leads'?'采集线索':'供货报价'}-${fields.category||'全部品类'}-${dayString()}.csv`);
 dialog.close();toast(`已导出 ${records.length} 条记录`);
}
function exportData() {
 let rows,header;
 if(state.page==='settings' && state.settingsView==='sources') {
  header=['来源','类型','标题','原始标价','地区','原文日期','链接','处理状态'];
  rows=(data.leads||[]).filter(l=>!HANDLED_LEADS.has(l.status)&&(!state.leadKind||l.kind===state.leadKind)&&matchesLeadCategory(l,state.leadCategory)).map(l=>[l.source_name,sourceKinds[l.kind],l.title,l.price_text,l.region_text,l.published_on,l.url,l.status]);
 } else if(state.page==='overview') {
  header=['品类','产品','状态','规格','地区范围','报价口径','参考周期（天）','均价（元/kg）','最低价','最高价','中位价','样本数','省份数','统计日'];
  rows=visibleProducts().filter(p=>!state.category||p.category===state.category).map(p=>{const s=stats(p.id);return [p.category,p.name,p.state,p.spec,state.province||'全国采样',bases[state.basis],state.days,s.average?.toFixed(4),s.min,s.max,s.median,s.count,s.provinceCount,dayString()];});
 } else {
  const showOrigin=unlocked();
  const base=['品类','产品','状态','规格','供应商','省份','城市','供货价（元/kg）','报价口径','运费（元/kg）','起订量','报价日期','有效至'];
  header=showOrigin?[...base,'来源','原始链接','审核状态','备注']:[...base,'审核状态','备注'];
  const quotes=state.page==='review'?data.quotes.filter(q=>q.status===state.reviewStatus):state.page==='settings'?data.quotes:comparisonRows();
  rows=quotes.map(q=>{const p=product(q.product_id);const core=[p?.category,p?.name,p?.state,p?.spec,q.supplier,q.province,q.city,q.price,bases[q.basis],q.freight,q.min_order,q.quoted_on,q.valid_until];return showOrigin?[...core,q.source_name,q.source_url,statuses[q.status],q.notes]:[...core,statuses[q.status],safeNotes(q.notes)];});
 }
 download('\uFEFF'+[header,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n'),`行情跳动-${state.page}-${dayString()}.csv`);
 toast('已导出当前筛选范围的数据');
}
let toastTimer;
function toast(message) {const el=document.querySelector('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),4500);}
async function execute(fn,button) {
 if(busy)return; busy=true;if(button)button.disabled=true;
 try{await fn();}catch(error){const err=dialog.open?dialog.querySelector('.form-error'):document.querySelector('#access-form .form-error, #login-form .form-error, #settings-unlock-form .form-error');if(err)err.textContent=error.message;else toast(error.message);}finally{busy=false;if(button)button.disabled=false;}
}
document.addEventListener('click',event=>{
 const el=event.target.closest('button,a'); if(!el)return;
 if(el.dataset.page) {location.hash=el.dataset.page;return;}
 if(el.dataset.settingsView) {state.pageNumber=1;location.hash=el.dataset.settingsView==='sources'?'settings/sources':'settings';return;}
 if(el.dataset.category!==undefined){changeValue({category:el.dataset.category,product:''});return;}
 if(el.dataset.chart){changeValue({chartProduct:el.dataset.chart});return;}
 if(el.dataset.compare){state.product=el.dataset.compare;state.category=product(state.product)?.category||'';state.search='';state.source='';state.pageNumber=1;state.page='compare';location.hash='compare';render();return;}
 if(el.dataset.lead){quickConvertDialog(data.leads.find(l=>l.id===el.dataset.lead));return;}
 if(el.dataset.quickEdit){quoteForm(null,data.leads.find(l=>l.id===el.dataset.quickEdit));return;}
 if(el.dataset.quickConfirm){execute(async()=>{
  const lead=data.leads.find(l=>l.id===el.dataset.quickConfirm);
  if(!lead)throw new Error('线索不存在');
  const q=buildQuickQuote(lead,data.products);
  if(!q.ok)throw new Error(q.reasons.join('；'));
  const quote={...q.quote,id:crypto.randomUUID()};
  validateQuote(quote,[...data.products,q.product]);
  if(!data.products.some(p=>p.id===q.product.id)){
   if(!admin())throw new Error('首次入库该品类需要管理员添加产品规格');
   data=await store.addProduct(q.product);
  }
  await store.saveQuote(quote);data=await store.reload();dialog.close();render();
  toast(quote.status==='approved'?'已确认入库；参考均价已更新':'已保存到待确认列表');
 },el);return;}
 if(el.dataset.dismissLead){execute(async()=>{if(!admin())throw new Error('需要管理员权限');data=await store.dismissLead(el.dataset.dismissLead);render();toast('已忽略该线索');},el);return;}
 if(el.dataset.undoLead){execute(async()=>{if(!admin())throw new Error('需要管理员权限');data=await store.undoLeadQuote(el.dataset.undoLead);render();managedLeadsDialog();toast('已撤销入库，线索回到待审列表');},el);return;}
 if(el.dataset.deleteLead){execute(async()=>{if(!admin())throw new Error('需要管理员权限');data=await store.deleteLead(el.dataset.deleteLead);render();managedLeadsDialog();toast('线索已移出队列，可在「已处理」恢复');},el);return;}
 if(el.dataset.restoreLead){execute(async()=>{if(!admin())throw new Error('需要管理员权限');data=await store.setLeadStatus(el.dataset.restoreLead,'pending');render();managedLeadsDialog();toast('已恢复为待审线索');},el);return;}
 if(el.dataset.catRename){categoryRenameDialog(el.dataset.catRename);return;}
 if(el.dataset.catDelete){categoryDeleteDialog(el.dataset.catDelete);return;}
 if(el.dataset.catDisable){execute(async()=>{if(!admin())throw new Error('需要管理员权限');data=await store.toggleCategory(el.dataset.catDisable,true);render();categoryDialog();toast('品类已停用，可在管理里恢复');},el);return;}
 if(el.dataset.catRestore){execute(async()=>{if(!admin())throw new Error('需要管理员权限');data=await store.restoreCategory(el.dataset.catRestore);render();categoryDialog();toast('品类已恢复');},el);return;}
 if(el.dataset.catDeleteConfirm){execute(async()=>{if(!admin())throw new Error('需要管理员权限');data=await store.deleteCategory(el.dataset.catDeleteConfirm);render();categoryDialog();toast('品类已删除，可在管理里恢复');},el);return;}
 if(el.dataset.leadKind!==undefined){changeValue({leadKind:el.dataset.leadKind});return;}
 if(el.dataset.detail){quoteDetail(el.dataset.detail);return;}
 if(el.dataset.edit){quoteForm(data.quotes.find(q=>q.id===el.dataset.edit));return;}
 if(el.dataset.reviewStatus){changeValue({reviewStatus:el.dataset.reviewStatus});return;}
 if(el.dataset.pagination){state.pageNumber+=Number(el.dataset.pagination);render();return;}
 if(el.dataset.review){execute(async()=>{if(!admin())throw new Error('需要管理员权限');await store.review(el.dataset.id,el.dataset.review);data=await store.reload();dialog.close();render();toast(el.dataset.review==='approved'?'已确认入库；有效报价将参与均价':el.dataset.review==='pending'?'已退回待确认':'已忽略，报价不参与均价');},el);return;}
 const action=el.dataset.action;
 if(action==='close')dialog.close();
 if(action==='lock-settings'){settingsAccess.lock();render();toast('数据设置已锁定');}
 if(action==='add')quoteForm();
 if(action==='add-product')productForm();
 if(action==='managed-leads')managedLeadsDialog();
 if(action==='manage-categories')categoryDialog();
 if(action==='import-backup')document.querySelector('#import-backup-file')?.click();
 if(action==='export'){if(state.page==='settings')exportForm();else exportData();}
 if(action==='backup')download(store.backup(),`行情跳动-完整备份-${dayString()}.json`,'application/json');
 if(action==='account')accountDialog();
 if(action==='lock-access')execute(async()=>{settingsAccess.lock();accessGate.lock();if(store.cloud)await store.logout();dialog.close();accessPage();toast('已退出访问，需重新输入密码');},el);
 if(action==='reset-filters')changeValue({category:'',product:'',province:'',source:'',search:'',basis:'factory',days:7,sort:'price'});
 if(action==='refresh')execute(async()=>{data=await store.reload();render();toast('记录已刷新');},el);
 if(action==='logout')execute(async()=>{settingsAccess.lock();await store.logout();loginPage();},el);
 if(action==='members')execute(showMembers,el);
});
document.addEventListener('change',event=>{
 if(event.target.id==='import-backup-file'){
  const file=event.target.files?.[0];if(!file)return;
  execute(async()=>{
   const text=await file.text();
   const tip=store.cloud?'导入会把本机备份合并进共享数据库，不会覆盖云端已有记录。确定继续？':'导入将覆盖此设备当前的产品、报价与设置，确定继续？';
   if(globalThis.confirm&&!globalThis.confirm(tip))return;
   data=await store.importBackup(text);render();toast(store.lastImportMessage||'备份已导入，数据已更新');
  });
  event.target.value='';return;
 }
 const filter=event.target.dataset.filter;
 if(filter==='leadCategory'){state.leadKind='';state.page='settings';state.settingsView='sources';location.hash='settings/sources';}
 if(filter)changeValue({[filter]:filter==='days'?Number(event.target.value):event.target.value});
});
let searchTimer;
document.addEventListener('input',event=>{if(event.target.id==='search'){const value=event.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.search=value;state.pageNumber=1;render();const input=document.querySelector('#search');input.focus();input.setSelectionRange(value.length,value.length);},250);}});
document.addEventListener('submit',event=>{
 const form=event.target;event.preventDefault(); const fields=Object.fromEntries(new FormData(form));
 execute(async()=>{
  if(form.id==='access-form') {
   const password = fields.password;
   fields.password = '';
   form.reset();
   if(!await accessGate.unlock(password)) {form.querySelector('input').focus();throw new Error('密码不正确，请重新输入');}
   await boot();
  }
  if(form.id==='settings-unlock-form') {
   const password = fields.password;
   fields.password = '';
   form.reset();
   if(!await settingsAccess.unlock(password)) {form.querySelector('input').focus();throw new Error('密码不正确，请重新输入');}
   render();
  }
  if(form.id==='export-form')exportSelected(fields);
  if(form.id==='quote-form') {
   const old=data.quotes.find(q=>q.id===form.dataset.id);
   let customProduct;
   if(fields.product_id==='__new__'){
    if(!admin())throw new Error('新增产品需要管理员授权');
    const draft={category:(fields.custom_category||'').trim(),name:(fields.custom_name||'').trim(),state:fields.custom_state,spec:(fields.custom_spec||'').trim()};
    if(!draft.category||!draft.name||!draft.state||!draft.spec)throw new Error('请完整填写自定义品类、产品名称、状态和规格');
    customProduct=data.products.find(p=>Object.keys(draft).every(k=>p[k]===draft[k]))||{id:crypto.randomUUID(),...draft};
    fields.product_id=customProduct.id;
   }
   for(const key of Object.keys(fields))if(key.startsWith('custom_'))delete fields[key];
   if(old&&!admin())throw new Error('只有管理员可以编辑已提交的报价');
   const quote={...old,...fields,id:old?.id||crypto.randomUUID(),price:normalizePrice(fields.price,fields.unit),freight:fields.freight===''?null:Number(fields.freight),supplier:fields.supplier.trim(),status:admin()?fields.status:'pending',created_at:old?.created_at||new Date().toISOString()};
   delete quote.unit;
   if(form.dataset.leadId)quote.collection_item_id=form.dataset.leadId;
   validateQuote(quote,customProduct?[...data.products,customProduct]:data.products);
   if(customProduct&&!data.products.some(p=>p.id===customProduct.id))data=await store.addProduct(customProduct);
   await store.saveQuote(quote);data=await store.reload();dialog.close();render();toast(quote.status==='approved'?'报价已入库，参考均价已更新':'已保存到待确认列表');
  }
  if(form.id==='category-rename-form') {
   if(!admin())throw new Error('需要管理员权限');
   data=await store.renameCategory(form.dataset.from,fields.name);
   render();categoryDialog();toast('品类名称已修改');
  }
  if(form.id==='product-form') {
   if(!admin())throw new Error('需要管理员权限');
   const p={id:crypto.randomUUID(),...Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.trim()]))};
   if(!p.category||!p.name||!p.state||!p.spec)throw new Error('请完整填写产品信息');
   if(data.products.some(x=>['category','name','state','spec'].every(k=>x[k]===p[k])))throw new Error('相同规格已存在');
   data=await store.addProduct(p);dialog.close();render();toast('产品规格已添加');
  }
  if(form.id==='login-form') {const result=await store.login(fields.password);if(result){data=result;render();}}
  if(form.id==='members-form') {
   for(const [id,role]of Object.entries(fields))if(form.querySelector(`[name="${CSS.escape(id)}"]`).dataset.original!==role)await store.changeRole(id,role);
   dialog.close();toast('成员角色已保存');
  }
 },form.querySelector('[type=submit]'));
});
async function showMembers() {
 const members=await store.members();
 showDialog(dialogHead('团队成员','新增成员请先在 Supabase Authentication 中邀请，再加入 members 表授权。')+`<form id="members-form"><div class="form-body"><p class="form-error" role="alert"></p>${members.map(m=>`<div class="settings-row"><span>${esc(m.display_name||m.email||m.id)}${m.id===store.user?.id?'（你）':''}</span>${m.id===store.user?.id?'<span class="muted">管理员</span>':`<select name="${esc(m.id)}" aria-label="${esc(m.display_name||m.email)}的角色" data-original="${esc(m.role)}">${options([['viewer','只读成员'],['editor','编辑人员'],['admin','管理员']],m.role)}</select>`}</div>`).join('')}</div><div class="dialog-foot"><button class="btn" type="button" data-action="close">取消</button><button class="btn primary" type="submit">保存权限</button></div></form>`);
}
function loginPage(error='') {app.innerHTML=`<main class="login"><img src="./favicon.svg" width="40" height="40" alt="行情跳动"><h1>登录行情跳动</h1><p>请输入访问密码进入采购工作台。</p><form id="login-form"><p class="form-error" role="alert">${esc(error)}</p><div class="field"><label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus></div><button class="btn primary" type="submit">登录</button></form></main>`;}
function accountDialog() {
 const who = store.cloud ? (store.user?.email || '团队账号') : '正式版';
 const roleName = ({admin:'管理员',editor:'编辑人员',viewer:'只读成员'})[store.role] || '';
 showDialog(dialogHead('账户',`${esc(who)}${roleName?` · ${roleName}`:''}`)+`<div class="form-body"><div class="settings-row"><span>数据保存位置</span><strong>${store.cloud?'共享数据库':'此浏览器（未上传）'}</strong></div><div class="settings-row"><span>访问保护</span><strong>已启用访问密码</strong></div><p class="subtle" style="margin:14px 0 0">退出访问后，本设备需重新输入密码才能看到内容；已录入的报价不受影响。</p></div><div class="dialog-foot"><button class="btn" data-action="close">关闭</button><button class="btn danger" data-action="lock-access">退出访问</button></div>`);
}
// 全站访问门：未解锁前不加载任何数据，报价与线索不进入内存和页面。
function accessPage(error='') {
 app.innerHTML=`<main class="login access"><img src="./favicon.svg" width="40" height="40" alt="行情跳动"><h1>行情跳动</h1><p>内部采购参考站，请输入访问密码。</p><form id="access-form"><p class="form-error" role="alert">${esc(error)}</p><div class="field"><label for="access-password">访问密码</label><input id="access-password" name="password" type="password" autocomplete="current-password" required maxlength="256" placeholder="请输入访问密码" autofocus></div><button class="btn primary" type="submit">进入</button></form><small class="access-tip">仅在本设备记住访问状态，清除浏览器数据后需重新输入。</small></main>`;
 document.querySelector('#access-password')?.focus();
}
async function boot() {
 try {const result=await store.init();if(result){data=result;render();}else loginPage();}
 catch(error) {
  if(store.cloud)loginPage(error.message);
  else app.innerHTML=`<div class="error-panel"><h1>暂时无法读取数据</h1><p>${esc(error.message)}</p><button class="btn" onclick="location.reload()">重新打开</button></div>`;
 }
}
window.addEventListener('hashchange',()=>{readRoute();if(store.role)render();});
if(accessGate.isUnlocked())await boot();else accessPage();

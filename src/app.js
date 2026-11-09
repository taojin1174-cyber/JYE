import { dayString, shiftDay, provinces, bases, statuses, money, normalizePrice, latestQuotes, summarize, trend, validateQuote, csvCell, isValidQuote } from './core.js';
import { store } from './store.js';
import { sourceCatalog,sourceKinds } from './sources.js';
import { createSettingsAccess } from './settings-access.js';

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
const state={page:location.hash.slice(1)||'overview',days:7,basis:'factory',category:'',province:'',product:'',source:'',search:'',sort:'price',reviewStatus:'pending',chartProduct:'chicken-fresh',pageNumber:1,sourceKind:'',leadKind:'supply',leadCategory:''};
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
const categories=()=>[...new Set(['猪','鸡','鸭','鹅','羊',...data.products.map(p=>p.category)])];
const options=(values,current,first)=>`${first!==undefined?`<option value="">${esc(first)}</option>`:''}${values.map(v=>{const [value,label]=Array.isArray(v)?v:[v,v];return `<option value="${esc(value)}" ${current===value?'selected':''}>${esc(label)}</option>`;}).join('')}`;
const productLabel=p=>p?`${p.name} / ${p.state} / ${p.spec}`:'产品已移除';
const productCell=p=>p?`<div class="product-name">${esc(p.name)}<span class="tag ${p.state==='鲜品'?'fresh':'frozen'}">${esc(p.state)}</span></div><div class="product-spec">${esc(p.spec)}</div>`:'未知产品';
const queryOptions=(id,extra={})=>({days:state.days,basis:state.basis,province:state.province,productId:id,...extra});
const stats=id=>summarize(latestQuotes(data.quotes,queryOptions(id)));
const sourcePill=q=>`<span class="source-pill ${q.source==='engine'?'engine':''}"><i></i>${q.source==='engine'?'引擎采集':'人工询价'}</span>`;
const periodSelect=()=>`<select aria-label="参考周期" data-filter="days">${options([[1,'当日报价'],[7,'近 7 天'],[30,'近 30 天']],state.days)}</select>`;
const basisSelect=()=>`<select aria-label="计价口径" data-filter="basis">${options(Object.entries(bases),state.basis)}</select>`;
const provinceSelect=()=>`<select aria-label="地区" data-filter="province">${options(provinces,state.province,'全国地区')}</select>`;
const categoryTabs=()=>`<div class="segmented" aria-label="品类筛选">${['',...categories()].map(c=>`<button data-category="${esc(c)}" class="${state.category===c?'active':''}" aria-pressed="${state.category===c}">${c?esc(c):'全部'}</button>`).join('')}</div>`;
function changeValue(values) { Object.assign(state,values,{pageNumber:1}); render(); }

function header() {
 const pending=data.quotes.filter(q=>q.status==='pending').length;
 return `<header class="topbar"><a href="#overview" class="brand" aria-label="行情跳动首页"><img src="./favicon.svg" alt=""><div><strong>行情跳动</strong><small>禽畜采购参考</small></div></a><nav class="nav" aria-label="主导航">${[['overview','行情总览'],['compare','采购比价'],['review','报价审核'],['settings','数据设置']].map(([id,label])=>`<button data-page="${id}" class="${state.page===id?'active':''}">${label}${id==='review'&&pending?`<span class="count">${pending}</span>`:''}</button>`).join('')}</nav><div class="top-actions"><span class="mode">${store.cloud?'团队工作台':'试运行 · 本机记录'}</span><button class="avatar" data-action="account" aria-label="账户信息">${admin()?'管':store.role==='editor'?'编':'览'}</button></div></header>`;
}
function render() {
 if(!['overview','compare','review','settings'].includes(state.page)) state.page='overview';
 app.innerHTML=header()+`<main class="shell">${!store.cloud?`<div class="notice">${icon('info',14)}<span>人工报价仅保存在当前浏览器；员工登录与跨设备共享暂未启用。真实采集线索须核实后入库。</span><a href="#settings">如何接入共享库 ${icon('arrow',12)}</a></div>`:''}${({overview:overview,compare:compare,review:review,settings:settings}[state.page])()}<footer class="footer"><span><i class="dot"></i>行情跳动 · 让每一笔采购有据可依</span><span>样本参考均价，以实际询价及成交条件为准 ${icon('shield',12)}</span></footer></main>`;
}
function heading(title,subtitle,eyebrow) {
 return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions"><button class="btn" data-action="export">${icon('down',14)}<span class="export-label">导出数据</span></button>${canWrite()?`<button class="btn primary" data-action="add">${icon('plus',15)}录入报价</button>`:''}</div></div>`;
}
function deltaFor(id) {
 const now=stats(id).average; const before=summarize(latestQuotes(data.quotes,queryOptions(id,{day:shiftDay(dayString(),-1)}))).average;
 if(now==null||before==null) return '<span class="delta">暂无日变化</span>';
 const delta=now-before; const pct=delta/before*100;
 return `<span class="delta ${Math.abs(pct)<.005?'':delta>0?'up':'down'}">${Math.abs(pct)<.005?'—':delta>0?'↗':'↘'} ${Math.abs(pct).toFixed(2)}% <span class="subtle">较昨日</span></span>`;
}
function overview() {
 const visible=data.products.filter(p=>!state.category||p.category===state.category);
 const representatives=categories().map(c=>data.products.find(p=>p.category===c)).filter(Boolean);
 const rows=visible.map(p=> {
   const s=stats(p.id); const points=trend(data.quotes,queryOptions(p.id));
   const latest=latestQuotes(data.quotes,queryOptions(p.id)).map(q=>q.quoted_on).sort().at(-1);
   return `<tr><td>${productCell(p)}</td><td class="number">${money(s.average)}</td><td class="number green">${money(s.min)}</td><td class="range">${s.count?`${money(s.min)} – ${money(s.max)}`:'—'}</td><td>${s.count}<span class="subtle"> 条 / ${s.provinceCount} 省</span>${s.count&&s.sparse?'<div class="subtle">样本较少</div>':''}</td><td>${spark(points.map(v=>v.average))}</td><td class="subtle">${latest?.slice(5)||'暂无'}</td><td><button class="row-action" data-compare="${esc(p.id)}">去比价 ${icon('arrow',13)}</button></td></tr>`;
 }).join('');
 return heading('行情总览','同规格看均价，按供应商找低价。','MARKET OVERVIEW')+`<div class="filters"><span class="label">参考范围</span>${periodSelect()}${provinceSelect()}${basisSelect()}<span class="date-note right">${icon('clock',13)} 北京时间 ${dayString().replaceAll('-','.')} · 元 / kg</span></div><div class="cards">${representatives.map(p=>{
 const s=stats(p.id);return `<button class="price-card ${state.chartProduct===p.id?'selected':''}" data-chart="${esc(p.id)}"><div class="card-head"><span><span class="category-dot">${esc(p.category)}</span>${esc(p.name)}</span><span class="tag ${p.state==='鲜品'?'fresh':'frozen'}">${esc(p.state)}</span></div><div class="card-sub">${esc(p.spec)}</div><div class="card-price"><strong>${money(s.average)}</strong><span>元 / kg</span></div><div class="card-bottom">${deltaFor(p.id)}<span>${s.count} 个样本</span></div></button>`;
 }).join('')}</div><section class="panel"><div class="panel-head"><h2>产品参考均价 <small>独立规格，独立统计</small></h2>${categoryTabs()}</div><div class="table-wrap"><table><thead><tr><th>产品 / 规格</th><th>样本均价</th><th>最低供货价</th><th>价格区间</th><th>有效样本 / 覆盖</th><th>7 日均价走势</th><th>最新报价</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="8" class="empty">暂无产品，请在数据与设置中添加</td></tr>'}</tbody></table></div><div class="table-foot"><span>${icon('info',12)} ${esc(bases[state.basis])} · 同供应商、同省、同规格保留最新有效报价；均价按供应商等权计算。</span><span>${state.province?'区域样本':'全国采样'} · 非官方全国统计均价</span></div></section><div class="bottom-grid">${chartPanel()}${recentPanel()}</div>`;
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
 if(!product(state.chartProduct)) state.chartProduct=data.products[0]?.id;
 const p=product(state.chartProduct); const values=trend(data.quotes,queryOptions(p?.id),7);
 const valid=values.filter(x=>x.average!=null); const s=stats(p?.id);
 const low=valid.length?Math.min(...valid.map(x=>x.average))-.3:0, high=valid.length?Math.max(...valid.map(x=>x.average))+.3:1;
 const y=v=>130-(v-low)/(high-low)*105;
 let lines=[],segment=[];
 values.forEach((v,i)=>{if(v.average==null){if(segment.length)lines.push(segment);segment=[];} else segment.push(`${43+i*440/6},${y(v.average)}`);}); if(segment.length)lines.push(segment);
 const svg=valid.length?`<svg class="chart" viewBox="0 0 510 165" role="img" aria-label="${esc(productLabel(p))}近七日均价"><title>${values.map(v=>`${v.day}：${money(v.average)}元/kg`).join('；')}</title>${[0,1,2].map(i=>{const n=low+(high-low)*i/2;return `<line x1="43" y1="${y(n)}" x2="486" y2="${y(n)}" stroke="#edf1ee" stroke-dasharray="3 4"/><text x="0" y="${y(n)+4}">${money(n)}</text>`;}).join('')}${lines.map(l=>`<polyline points="${l.join(' ')}" fill="none" stroke="#368b65" stroke-width="2.2" stroke-linejoin="round"/>`).join('')}${values.map((v,i)=>`<text x="${43+i*440/6}" y="157" text-anchor="middle">${v.day.slice(5).replace('-','/')}</text>${v.average!=null?`<circle cx="${43+i*440/6}" cy="${y(v.average)}" r="3" fill="white" stroke="#368b65" stroke-width="1.8"><title>${v.day} ${money(v.average)}元/kg</title></circle>`:''}`).join('')}</svg>`:'<div class="chart-empty">暂无有效报价，录入后即可查看走势</div>';
 return `<section class="panel"><div class="panel-head"><h2>均价走势 <small>最近 7 日</small></h2><select aria-label="走势产品" data-filter="chartProduct">${options(data.products.map(p=>[p.id,`${p.name} · ${p.state} · ${p.spec}`]),state.chartProduct)}</select></div><div class="chart-wrap"><div class="chart-summary"><strong>${money(s.average)}</strong><span class="subtle">元 / kg</span>${deltaFor(p?.id)}</div>${svg}</div><div class="chart-legend"><i class="dot"></i>${esc(productLabel(p))} · ${esc(bases[state.basis])}</div></section>`;
}
function recentPanel() {
 const recent=data.quotes.filter(q=>q.status==='approved').sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)).slice(0,4);
 return `<section class="panel"><div class="panel-head"><h2>最近入库</h2><button class="text-btn" data-page="compare">全部报价 ${icon('arrow',12)}</button></div><div class="recent-list">${recent.map(q=>`<div class="recent-row"><div class="recent-icon">${icon(q.source==='engine'?'layers':'check',15)}</div><div class="recent-text"><strong>${esc(product(q.product_id)?.name)} <span class="subtle">/ ${esc(product(q.product_id)?.state)} · ${esc(q.province)}</span></strong><p>${esc(q.supplier)} · ${esc(q.quoted_on.slice(5))}</p></div><button class="recent-price" data-detail="${esc(q.id)}">¥ ${money(q.price)}<small>${q.source==='engine'?'引擎采集':'人工询价'}</small></button></div>`).join('')||'<div class="empty">还没有入库报价</div>'}</div></section>`;
}
function comparisonRows() {
 return latestQuotes(data.quotes,{...queryOptions(state.product),category:state.category,products:data.products,source:state.source}).filter(q=>!state.search||[q.supplier,q.city,q.province,productLabel(product(q.product_id))].join(' ').toLowerCase().includes(state.search.toLowerCase())).sort((a,b)=>state.sort==='date'?b.quoted_on.localeCompare(a.quoted_on):a.price-b.price);
}
function compare() {
 const rows=comparisonRows(); const p=product(state.product); const s=p?summarize(rows):null;
 const pageSize=20; const total=Math.max(1,Math.ceil(rows.length/pageSize)); state.pageNumber=Math.min(state.pageNumber,total);
 const pageRows=rows.slice((state.pageNumber-1)*pageSize,state.pageNumber*pageSize);
 return heading('采购比价','先选同一规格，再比较供货价与采购条件。','PURCHASE COMPARISON')+`<div class="filter-panel"><div class="filters">${categoryTabs()}<label class="search">${icon('search',15)}<input aria-label="搜索供应商或地区" placeholder="搜索供应商、地区…" value="${esc(state.search)}" id="search"></label></div><div class="filters"><select aria-label="产品规格" data-filter="product">${options(data.products.filter(p=>!state.category||p.category===state.category).map(p=>[p.id,productLabel(p)]),state.product,'全部产品规格')}</select>${provinceSelect()}${periodSelect()}${basisSelect()}<select aria-label="报价来源" data-filter="source">${options([['manual','人工询价'],['engine','引擎采集']],state.source,'全部来源')}</select><button class="text-btn right" data-action="reset-filters">重置筛选</button></div></div>${s?`<div class="summary-strip">${[['样本均价',money(s.average),'元/kg'],['最低供货价',money(s.min),'元/kg'],['中位价格',money(s.median),'元/kg'],['有效供应商样本',s.count,'个'],['覆盖省份',s.provinceCount,'省']].map(([label,val,unit])=>`<div class="summary-item"><p>${label}</p><strong>${val}</strong><small>${unit}</small></div>`).join('')}</div>`:`<div class="review-intro">${icon('info',14)} 选择具体产品规格后显示均价和中位价。不同规格的价格分别比较。</div>`}<section class="panel"><div class="panel-head"><h2>${p?esc(p.name)+' · '+esc(p.state):'供货报价'} <small>${rows.length} 条最新有效报价${s?.sparse?' · 样本较少，请继续补充询价':''}</small></h2><select aria-label="排序方式" data-filter="sort">${options([['price','供货价：从低到高'],['date','报价日：从新到旧']],state.sort)}</select></div><div class="table-wrap"><table><thead><tr><th>产品 / 规格</th><th>供应商 / 地区</th><th>供货价 · 元/kg</th><th>参考含运价</th><th>采购条件</th><th>报价日 / 有效期</th><th>报价来源</th><th></th></tr></thead><tbody>${pageRows.map(q=>`<tr><td>${productCell(product(q.product_id))}</td><td><div>${esc(q.supplier)}</div><div class="product-spec">${esc(q.province)} · ${esc(q.city||'未填城市')}</div></td><td class="number ${p&&q.price===s?.min?'green':''}">${money(q.price)}${p&&q.price===s?.min?'<span class="tag fresh">最低</span>':''}</td><td>${q.basis==='delivered'?money(q.price):q.freight!=null?money(Number(q.price)+Number(q.freight)):'<span class="subtle">运费待询</span>'}${q.basis==='untaxed'?'<div class="subtle">未含税</div>':''}</td><td>${esc(q.min_order||'起订量待询')}<div class="product-spec">${esc(bases[q.basis])}</div></td><td>${esc(q.quoted_on)}<div class="product-spec">有效至 ${esc(q.valid_until)}</div></td><td>${sourcePill(q)}<div class="product-spec">${esc(q.source_name||'未填')}</div></td><td><button class="row-action" data-detail="${esc(q.id)}">详情 ${icon('chevron',12)}</button></td></tr>`).join('')||'<tr><td colspan="8" class="empty">没有符合条件的有效报价，试试调整筛选或录入报价。</td></tr>'}</tbody></table></div><div class="pagination"><span>${rows.length} 条 · 已去重，过期与未确认报价不参与</span><div><button class="btn small" data-pagination="-1" ${state.pageNumber<=1?'disabled':''}>上一页</button><span>${state.pageNumber} / ${total}</span><button class="btn small" data-pagination="1" ${state.pageNumber>=total?'disabled':''}>下一页</button></div></div></section>`;
}
function review() {
 const rows=data.quotes.filter(q=>q.status===state.reviewStatus).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
 const limited=rows.slice(0,100);
 return heading('报价审核','核对来源和规格后入库，让每个参考价都可追溯。','QUOTE REVIEW')+`<div class="review-intro">${icon('shield',15)} ${admin()?'采集报价先进入待确认列表；确认入库后才参与均价。价格过低或过高时，请先核实规格、日期、税费与起订量。':'你可以查看报价记录。编辑人员提交的报价，由管理员审核后入库。'}</div><div class="filters"><div class="segmented">${Object.entries(statuses).map(([id,label])=>`<button data-review-status="${id}" class="${state.reviewStatus===id?'active':''}">${label} ${data.quotes.filter(q=>q.status===id).length}</button>`).join('')}</div><button class="btn right" data-action="refresh">${icon('refresh',14)}刷新记录</button></div><section class="panel"><div class="table-wrap"><table><thead><tr><th>产品 / 规格</th><th>供应商 / 地区</th><th>供货价 · 元/kg</th><th>报价口径</th><th>报价日 / 有效期</th><th>来源</th><th>处理</th></tr></thead><tbody>${limited.map(q=>`<tr><td>${productCell(product(q.product_id))}</td><td>${esc(q.supplier)}<div class="product-spec">${esc(q.province)} ${esc(q.city)}</div></td><td class="number">${money(q.price)}</td><td class="subtle">${esc(bases[q.basis])}</td><td>${esc(q.quoted_on)}<div class="product-spec">有效至 ${esc(q.valid_until)}${q.valid_until<dayString()?' · 已过期':''}</div></td><td>${sourcePill(q)}<div class="product-spec">${esc(q.source_name)}</div></td><td><div class="review-actions"><button class="btn small" data-detail="${esc(q.id)}">核对</button>${admin()&&state.reviewStatus==='pending'?`<button class="btn primary small" data-review="approved" data-id="${esc(q.id)}">确认</button><button class="btn small danger" data-review="rejected" data-id="${esc(q.id)}">忽略</button>`:admin()&&state.reviewStatus!=='pending'?`<button class="text-btn" data-review="pending" data-id="${esc(q.id)}">退回待审</button>`:''}</div></td></tr>`).join('')||'<tr><td colspan="7" class="empty">这个列表里暂时没有报价</td></tr>'}</tbody></table></div><div class="table-foot"><span>显示最近 ${limited.length} / ${rows.length} 条 · 已忽略、未确认、过期报价均不参与当前均价。</span><span>每笔报价保留原始来源</span></div></section>`;
}
function sourcesPage() {
 const leads=(data.leads||[]).filter(l=>(!state.leadKind||l.kind===state.leadKind)&&(!state.leadCategory||l.category===state.leadCategory)).sort((a,b)=>(b.published_on||'').localeCompare(a.published_on||'')||Date.parse(b.fetched_at)-Date.parse(a.fetched_at));
 const total=Math.max(1,Math.ceil(leads.length/20));state.pageNumber=Math.min(state.pageNumber,total);
 const rows=leads.slice((state.pageNumber-1)*20,state.pageNumber*20);
 const catalog=sourceCatalog.filter(s=>!state.sourceKind||s.kind===state.sourceKind);
 const latest=(data.leads||[]).map(l=>l.fetched_at).sort().at(-1);
 const failedSources=(store.discovery?.runs||[]).filter(r=>!r.ok).map(r=>sourceCatalog.find(s=>s.id===r.source_id)?.name||r.source_id);
 const collectionNotice=failedSources.length?`<div class="notice">${esc(failedSources.join('、'))}本次采集未成功，保留上次线索；其余来源正常更新。</div>`:'';
 return `<div class="review-intro">${icon('info',15)} 先点击“查看原文”打开对应网站，核对产品、标价和日期，再点击“核实入库”。市场均价和宏观监测仅供参考；供货线索需补齐规格、供应商、税运条件及有效期后，才进入报价库。</div>${store.discovery?.error?`<div class="notice">采集快照加载失败：${esc(store.discovery.error)}</div>`:''}${collectionNotice}<section class="panel"><div class="panel-head"><h2>自动采集线索 <small>${latest?'最近采集 '+esc(new Date(latest).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})):'尚未采集'}</small></h2></div><div class="lead-tabs"><div class="segmented">${Object.entries(sourceKinds).map(([kind,name])=>`<button data-lead-kind="${kind}" class="${state.leadKind===kind?'active':''}">${name} ${(data.leads||[]).filter(l=>l.kind===kind).length}</button>`).join('')}</div><select aria-label="线索品类" data-filter="leadCategory">${options(['猪','鸡','鸭','鹅','羊','牛'],state.leadCategory,'全部品类')}</select><span class="subtle">未核对的线索不参与供货均价</span></div><div class="table-wrap"><table><thead><tr><th>原文产品 / 标题</th><th>标价原文</th><th>地区 / 发布日期</th><th>来源</th><th>核对与处理</th></tr></thead><tbody>${rows.map(l=>`<tr><td class="lead-title"><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.title)}</a><div class="product-spec lead-note">${esc(l.details)}</div></td><td>${esc(l.price_text||'见原文')}</td><td>${esc(l.region_text||'原文范围')}<div class="product-spec">${esc(l.published_on||'日期待核实')}</div></td><td>${esc(l.source_name)}<div class="product-spec">${esc(sourceKinds[l.kind])}</div></td><td><div class="review-actions lead-actions"><a class="btn small" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" aria-label="查看原文：${esc(l.title)}">查看原文 ↗</a>${l.status==='converted'?'<span class="source-pill">已转为报价</span>':l.status==='dismissed'?'<span class="subtle">已忽略</span>':l.kind==='supply'&&canWrite()?`<div class="review-actions"><button class="btn small primary" data-lead="${esc(l.id)}">核实入库</button>${admin()?`<button class="text-btn" data-dismiss-lead="${esc(l.id)}">忽略</button>`:''}</div>`:'<span class="subtle">仅作外部参考</span>'}</div></td></tr>`).join('')||'<tr><td colspan="5" class="empty">暂无线索。连接数据库后可运行 GitHub 定时采集，也可先查看下方来源目录。</td></tr>'}</tbody></table></div><div class="pagination"><span>${leads.length} 条公开线索 · 标价需向供货商复核</span><div><button class="btn small" data-pagination="-1" ${state.pageNumber<=1?'disabled':''}>上一页</button><span>${state.pageNumber} / ${total}</span><button class="btn small" data-pagination="1" ${state.pageNumber>=total?'disabled':''}>下一页</button></div></div></section><section class="panel" style="margin-top:20px"><div class="panel-head"><h2>来源目录 <small>${sourceCatalog.length} 个候选来源</small></h2><select aria-label="来源分类" data-filter="sourceKind">${options(Object.entries(sourceKinds),state.sourceKind,'全部来源类型')}</select></div><div class="table-wrap"><table><thead><tr><th>来源</th><th>用途 / 覆盖</th><th>接入进度</th><th>口径与说明</th></tr></thead><tbody>${catalog.map(s=>`<tr><td><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)} ↗</a></td><td>${esc(sourceKinds[s.kind])}<div class="product-spec">${esc(s.scope)}</div></td><td class="subtle">${esc(s.status)}</td><td class="source-notes">${esc(s.note)}</td></tr>`).join('')}</tbody></table></div><div class="table-foot"><span>公开列表每天定时核对三次；付费、登录、验证码及不可访问来源需要单独接入。已核验表示页面可见，不表示报价已认证。</span></div></section>`;
}
function settings() {
 if(!settingsAccess.isUnlocked()) {
  return '<div class="page-heading"><div><p class="eyebrow">DATA & SETTINGS</p><h1>数据设置</h1><p>管理产品规格、数据来源和团队工作方式。</p></div></div>' + `<section class="settings-unlock panel"><div class="settings-unlock-icon">${icon('shield',22)}</div><h2>输入设置密码</h2><p>解锁后可查看基础设置和来源中心。</p><form id="settings-unlock-form"><p class="form-error" role="alert"></p><div class="field"><label for="settings-password">入口密码</label><input id="settings-password" name="password" type="password" autocomplete="off" required maxlength="256" placeholder="请输入密码"></div><button class="btn primary" type="submit">解锁数据设置</button></form><small>仅在当前标签页保持解锁，可随时手动锁定。</small></section>`;
 }
 return heading('数据设置','管理产品规格、数据来源和团队工作方式。','DATA & SETTINGS') + `<div class="settings-tabs"><div class="segmented" aria-label="数据设置栏目"><button data-settings-view="general" class="${state.settingsView==='general'?'active':''}" aria-pressed="${state.settingsView==='general'}">基础设置</button><button data-settings-view="sources" class="${state.settingsView==='sources'?'active':''}" aria-pressed="${state.settingsView==='sources'}">来源中心</button></div><button class="btn small" data-action="lock-settings">${icon('shield',13)}锁定</button></div>` + (state.settingsView==='sources' ? sourcesPage() : settingsBody());
}
function settingsBody() {
 return `<div class="settings-grid"><section class="panel"><div class="panel-head"><h2>产品库 <small>${data.products.length} 个规格</small></h2>${admin()?'<button class="text-btn" data-action="add-product">+ 添加产品</button>':''}</div><div class="settings-body">${data.products.map(p=>`<div class="settings-row"><span><span class="category-dot">${esc(p.category)}</span>${esc(p.name)} <small>${esc(p.state)}</small></span><small>${esc(p.spec)}</small></div>`).join('')}</div></section><section class="panel"><div class="panel-head"><h2>数据来源</h2><span class="mode">人工确认后入库</span></div><div class="settings-body"><h3>人工询价</h3><p>电话、微信或线下询价，记录供应商、报价日、有效期及采购条件。编辑人员提交后由管理员确认。</p><h3>引擎采集</h3><p>已适配肉交所公开供货列表、禽网行情目录、全国畜牧总站价格目录。真实线索在来源中心核对，供货线索补齐条件后转成报价。</p><div class="settings-row"><span>公开网页适配器</span><strong>3 个</strong></div><p style="margin-top:12px">另支持 JSON / CSV 授权接口。市场行情、官方监测与供货价分别处理；付费或登录内容仍待单独接入。</p><a href="#settings/sources">查看来源中心 →</a><h3>采集配置</h3><p>在仓库 <code>collector/sources.json</code> 配置接口及字段映射，通过 GitHub Actions 运行。</p></div></section><section class="panel"><div class="panel-head"><h2>统计口径</h2>${icon('info',15)}</div><div class="settings-body"><ul><li>按产品规格、鲜冻状态、含税及运输口径独立统计，统一换算为元 / kg。</li><li>周期内，同供应商、同省、同规格、同口径取最新有效报价，按供应商等权算术平均，同时显示中位价与最低价。</li><li>只纳入已确认、未过期的报价。低于 5 个样本或覆盖少于 3 省，标记“样本较少”。</li><li>全国地区表示采样范围，不代表全国全部市场。品类卡片显示一个明确的代表规格，不把不同产品混成一个均价。</li><li>走势按历史当日有效样本回算；后续补录或更改审核状态可能改变历史曲线。</li><li>参考含运价为报价加填写的每公斤运费；未税报价仍需另核税费。最低供货价仍需核实品质、起订量和到货条件。</li></ul></div></section><section class="panel"><div class="panel-head"><h2>${store.cloud?'团队与访问':'保存与团队协作'}</h2>${icon('shield',15)}</div><div class="settings-body"><div class="settings-row"><span>当前模式</span><strong>${store.cloud?'共享数据库':'本机报价记录'}</strong></div><div class="settings-row"><span>当前角色</span><strong>${({admin:'管理员',editor:'编辑人员',viewer:'只读成员'})[store.role]}</strong></div><p style="margin-top:15px">${store.cloud?'管理员可审核报价、添加规格和调整成员角色。新成员账号由数据库管理员邀请后授权。':'接入 Supabase 后可多设备共享：管理员审核与管理；编辑人员提交报价；只读成员查看。权限由数据库验证。'}</p><div class="heading-actions"><button class="btn" data-action="backup">${icon('down',14)}导出完整备份</button>${store.cloud?`${admin()?'<button class="btn" data-action="members">管理成员</button>':''}<button class="btn" data-action="logout">退出登录</button>`:''}</div><p style="margin-top:18px">完整部署和授权步骤见项目 <code>README.md</code>。不要把供应商信息或数据库私钥提交进 GitHub 仓库。</p></div></section></div>`;
}
function showDialog(html) { dialog.innerHTML=html; if(!dialog.open) dialog.showModal(); }
const dialogHead=(title,sub='')=>`<div class="dialog-head"><div><h2 id="dialog-title">${title}</h2>${sub?`<p>${sub}</p>`:''}</div><button class="close" data-action="close" aria-label="关闭">${icon('close',20)}</button></div>`;
const field=(label,html,full=false)=>`<div class="field ${full?'full':''}"><label>${label}</label>${html}</div>`;
function quoteForm(existing,lead) {
 if(!canWrite()) return;
 const q=existing||{product_id:state.product||data.products[0]?.id,price:'',province:'',city:'',supplier:'',basis:state.basis,source:'manual',source_name:'电话询价',source_url:'',quoted_on:dayString(),valid_until:shiftDay(dayString(),2),min_order:'',freight:'',notes:''};
 if(lead) {
  if(lead.kind!=='supply')return;
  const m=lead.price_text.match(/^(\d+(?:\.\d+)?)\s*元\s*\/\s*(公斤|千克|斤|吨)$/);
  Object.assign(q,{product_id:'',basis:'',supplier:'',province:provinces.find(p=>lead.region_text.startsWith(p))||'',city:'',price:m?normalizePrice(m[1],({'公斤':'kg','千克':'kg','斤':'jin','吨':'ton'})[m[2]]):'',source:'engine',source_name:lead.source_name,source_url:lead.url,quoted_on:lead.published_on||'',valid_until:lead.published_on||'',status:'pending',notes:`原文产品：${lead.title}；标价：${lead.price_text}；仓库地区：${lead.region_text}。${lead.details}`});
 }
 showDialog(dialogHead(existing?'编辑报价':'录入报价','统一以元 / kg 入库，鲜冻、规格和价格口径分别比较。')+`${lead?`<div class="lead-origin"><span>核对原网站的产品、标价和日期</span><a class="btn small" href="${esc(lead.url)}" target="_blank" rel="noopener noreferrer">查看采集原文 ↗</a></div>`:''}<form id="quote-form" data-id="${esc(existing?.id||'')}" data-lead-id="${esc(lead?.id||'')}"><div class="form-body"><p class="form-error" role="alert"></p><div class="form-grid">${field('产品 / 规格 <span>*</span>',`<select name="product_id" aria-label="产品规格" required>${options(data.products.map(p=>[p.id,productLabel(p)]),q.product_id,'请选择具体产品规格')}</select>`,true)}${field('供货价格 <span>*</span>',`<div class="price-input"><input name="price" aria-label="供货价格" type="number" step="0.0001" min="0.0001" value="${esc(q.price)}" required placeholder="请输入价格"><select name="unit" aria-label="计价单位">${options([['kg','元 / kg'],['jin','元 / 斤'],['ton','元 / 吨']],'kg')}</select></div>`)}${field('价格口径 <span>*</span>',`<select name="basis" aria-label="价格口径" required>${options(Object.entries(bases),q.basis,'核实后选择价格口径')}</select>`)}${field('供应商 / 市场 <span>*</span>',`<input name="supplier" aria-label="供应商" value="${esc(q.supplier)}" required maxlength="120" placeholder="尽量统一供应商名称">`)}${field('报价省份 <span>*</span>',`<select name="province" aria-label="报价省份" required>${options(provinces,q.province,'请选择省份')}</select>`)}${field('城市',`<input name="city" aria-label="城市" maxlength="60" value="${esc(q.city)}" placeholder="例如：潍坊">`)}${field('起订量',`<input name="min_order" aria-label="起订量" maxlength="100" value="${esc(q.min_order)}" placeholder="例如：500 kg">`)}${field('报价日期 <span>*</span>',`<input name="quoted_on" aria-label="报价日期" type="date" value="${q.quoted_on}" max="${dayString()}" required>`)}${field('报价有效至 <span>*</span>',`<input name="valid_until" aria-label="有效期" type="date" value="${q.valid_until}" required>`)}${field('每公斤运费',`<input name="freight" aria-label="每公斤运费" type="number" step="0.01" min="0" value="${esc(q.freight??'')}" placeholder="元 / kg，未知留空"><small>到货价已含运时无需填写。</small>`)}${field('来源方式',`<select name="source" aria-label="来源方式">${options([['manual','人工询价'],['engine','引擎采集 / 手动补录']],q.source)}</select>`)}${field('来源名称',`<input name="source_name" aria-label="来源名称" maxlength="120" value="${esc(q.source_name)}" placeholder="电话、微信或行情网站名称">`)}${field('原始链接',`<input name="source_url" aria-label="原始链接" type="url" value="${esc(q.source_url)}" placeholder="https://…">`)}${field('备注 / 询价联系人',`<textarea name="notes" aria-label="备注" maxlength="2000" placeholder="品质、账期、联系人、特殊条件等">${esc(q.notes)}</textarea>`,true)}${admin()?field('入库方式',`<select name="status" aria-label="入库方式">${options([['approved','确认无误，直接入库'],['pending','先存入待确认']],existing?.status==='rejected'?'pending':q.status||'approved')}</select><small>引擎来源的新报价默认待确认；审核后再入库。</small>`,true):'<div class="subtle full">提交后进入待确认列表，管理员确认后参与统计。</div>'}</div></div><div class="dialog-foot"><button type="button" class="btn" data-action="close">取消</button><button type="submit" class="btn primary">${existing?'保存修改':admin()?'保存报价':'提交审核'}</button></div></form>`);
 dialog.querySelector('[name=source]').addEventListener('change',e=>{const status=dialog.querySelector('[name=status]');if(status&&e.target.value==='engine')status.value='pending';});
}
function quoteDetail(id) {
 const q=data.quotes.find(q=>q.id===id); if(!q)return;
 const p=product(q.product_id);
 showDialog(dialogHead('报价详情',productLabel(p))+`<div class="form-body"><div class="form-grid">${[['供应商',q.supplier],['地区',`${q.province} ${q.city}`],['供货价格',`¥ ${money(q.price)} / kg`],['价格口径',bases[q.basis]],['报价日期',q.quoted_on],['有效期',q.valid_until],['起订量',q.min_order||'未填写'],['每公斤运费',q.freight!=null?`¥ ${money(q.freight)}`:'待询'],['来源',`${q.source==='engine'?'引擎采集':'人工询价'} · ${q.source_name||'未填写'}`],['状态',`${statuses[q.status]}${q.valid_until<dayString()?' · 已过期':''}`]].map(([l,v])=>field(l,`<div>${esc(v)}</div>`)).join('')}${field('原始来源',q.source_url?`<a target="_blank" rel="noopener noreferrer" href="${esc(/^https?:\/\//i.test(q.source_url)?q.source_url:'#')}">${esc(q.source_url)}</a>`:'<span class="muted">未提供链接</span>',true)}${field('备注',`<div style="white-space:pre-wrap;line-height:1.8">${esc(q.notes||'无')}</div>`,true)}${q.reviewed_at?field('最近审核时间',`<span class="subtle">${esc(new Date(q.reviewed_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))}</span>`,true):''}</div></div><div class="dialog-foot">${admin()?`<button class="btn" data-edit="${esc(q.id)}">编辑报价</button>${q.status==='pending'?`<button class="btn danger" data-review="rejected" data-id="${esc(q.id)}">忽略</button><button class="btn primary" data-review="approved" data-id="${esc(q.id)}">确认入库</button>`:''}`:''}<button class="btn" data-action="close">关闭</button></div>`);
}
function productForm() {
 if(!admin())return;
 showDialog(dialogHead('添加产品规格','新物种也可以直接填写；规格尽量明确，便于以后比价。')+`<form id="product-form"><div class="form-body"><p class="form-error" role="alert"></p><div class="form-grid">${field('品类 <span>*</span>',`<input name="category" aria-label="品类" list="categories" required maxlength="20" placeholder="例如：鸡、牛、兔"><datalist id="categories">${categories().map(c=>`<option value="${esc(c)}">`).join('')}</datalist>`)}${field('产品名称 <span>*</span>','<input name="name" aria-label="产品名称" required maxlength="60" placeholder="例如：鸡胸肉">')}${field('产品状态 <span>*</span>',`<select name="state" aria-label="产品状态">${options(['鲜品','冻品','活体','冷鲜'],'鲜品')}</select>`)}${field('规格 <span>*</span>','<input name="spec" aria-label="规格" required maxlength="160" placeholder="部位、等级、重量范围等">')}</div></div><div class="dialog-foot"><button type="button" class="btn" data-action="close">取消</button><button type="submit" class="btn primary">添加产品</button></div></form>`);
}
function download(text,name,type='text/csv;charset=utf-8') {
 const url=URL.createObjectURL(new Blob([text],{type})); const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportData() {
 let rows,header;
 if(state.page==='settings' && state.settingsView==='sources') {
  header=['来源','类型','标题','原始标价','地区','原文日期','链接','处理状态'];
  rows=(data.leads||[]).filter(l=>(!state.leadKind||l.kind===state.leadKind)&&(!state.leadCategory||l.category===state.leadCategory)).map(l=>[l.source_name,sourceKinds[l.kind],l.title,l.price_text,l.region_text,l.published_on,l.url,l.status]);
 } else if(state.page==='overview') {
  header=['品类','产品','状态','规格','地区范围','报价口径','参考周期（天）','均价（元/kg）','最低价','最高价','中位价','样本数','省份数','统计日'];
  rows=data.products.filter(p=>!state.category||p.category===state.category).map(p=>{const s=stats(p.id);return [p.category,p.name,p.state,p.spec,state.province||'全国采样',bases[state.basis],state.days,s.average?.toFixed(4),s.min,s.max,s.median,s.count,s.provinceCount,dayString()];});
 } else {
  header=['品类','产品','状态','规格','供应商','省份','城市','供货价（元/kg）','报价口径','运费（元/kg）','起订量','报价日期','有效至','来源','原始链接','审核状态','备注'];
  const quotes=state.page==='review'?data.quotes.filter(q=>q.status===state.reviewStatus):state.page==='settings'?data.quotes:comparisonRows();
  rows=quotes.map(q=>{const p=product(q.product_id);return [p?.category,p?.name,p?.state,p?.spec,q.supplier,q.province,q.city,q.price,bases[q.basis],q.freight,q.min_order,q.quoted_on,q.valid_until,q.source_name,q.source_url,statuses[q.status],q.notes];});
 }
 download('\uFEFF'+[header,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n'),`行情跳动-${!store.cloud?'本机记录-':''}${state.page}-${dayString()}.csv`);
 toast('已导出当前筛选范围的数据');
}
let toastTimer;
function toast(message) {const el=document.querySelector('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),4500);}
async function execute(fn,button) {
 if(busy)return; busy=true;if(button)button.disabled=true;
 try{await fn();}catch(error){const err=dialog.open?dialog.querySelector('.form-error'):document.querySelector('#login-form .form-error, #settings-unlock-form .form-error');if(err)err.textContent=error.message;else toast(error.message);}finally{busy=false;if(button)button.disabled=false;}
}
document.addEventListener('click',event=>{
 const el=event.target.closest('button,a'); if(!el)return;
 if(el.dataset.page) {location.hash=el.dataset.page;return;}
 if(el.dataset.settingsView) {state.pageNumber=1;location.hash=el.dataset.settingsView==='sources'?'settings/sources':'settings';return;}
 if(el.dataset.category!==undefined){changeValue({category:el.dataset.category,product:''});return;}
 if(el.dataset.chart){changeValue({chartProduct:el.dataset.chart});return;}
 if(el.dataset.compare){state.product=el.dataset.compare;state.category=product(state.product)?.category||'';state.search='';state.source='';state.pageNumber=1;state.page='compare';location.hash='compare';render();return;}
 if(el.dataset.lead){quoteForm(null,data.leads.find(l=>l.id===el.dataset.lead));return;}
 if(el.dataset.dismissLead){execute(async()=>{if(!admin())throw new Error('需要管理员权限');data=await store.dismissLead(el.dataset.dismissLead);render();toast('已忽略该线索');},el);return;}
 if(el.dataset.leadKind){changeValue({leadKind:el.dataset.leadKind});return;}
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
 if(action==='export')exportData();
 if(action==='backup')download(store.backup(),`行情跳动-完整备份-${dayString()}.json`,'application/json');
 if(action==='account')toast(`${store.cloud?(store.user?.email||'团队账号'):'本机记录模式'} · ${({admin:'管理员',editor:'编辑人员',viewer:'只读成员'})[store.role]}`);
 if(action==='reset-filters')changeValue({category:'',product:'',province:'',source:'',search:'',basis:'factory',days:7,sort:'price'});
 if(action==='refresh')execute(async()=>{data=await store.reload();render();toast('记录已刷新');},el);
 if(action==='logout')execute(async()=>{settingsAccess.lock();await store.logout();loginPage();},el);
 if(action==='members')execute(showMembers,el);
});
document.addEventListener('change',event=>{
 const filter=event.target.dataset.filter;
 if(filter)changeValue({[filter]:filter==='days'?Number(event.target.value):event.target.value});
});
let searchTimer;
document.addEventListener('input',event=>{if(event.target.id==='search'){const value=event.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.search=value;state.pageNumber=1;render();const input=document.querySelector('#search');input.focus();input.setSelectionRange(value.length,value.length);},250);}});
document.addEventListener('submit',event=>{
 const form=event.target;event.preventDefault(); const fields=Object.fromEntries(new FormData(form));
 execute(async()=>{
  if(form.id==='settings-unlock-form') {
   const password = fields.password;
   fields.password = '';
   form.reset();
   if(!await settingsAccess.unlock(password)) {form.querySelector('input').focus();throw new Error('密码不正确，请重新输入');}
   render();
  }
  if(form.id==='quote-form') {
   const old=data.quotes.find(q=>q.id===form.dataset.id);
   if(old&&!admin())throw new Error('只有管理员可以编辑已提交的报价');
   const quote={...old,...fields,id:old?.id||crypto.randomUUID(),price:normalizePrice(fields.price,fields.unit),freight:fields.freight===''?null:Number(fields.freight),supplier:fields.supplier.trim(),status:admin()?fields.status:'pending',created_at:old?.created_at||new Date().toISOString()};
   delete quote.unit;
   if(form.dataset.leadId)quote.collection_item_id=form.dataset.leadId;
   validateQuote(quote,data.products);
   await store.saveQuote(quote);data=await store.reload();dialog.close();render();toast(quote.status==='approved'?'报价已入库，参考均价已更新':'已保存到待确认列表');
  }
  if(form.id==='product-form') {
   if(!admin())throw new Error('需要管理员权限');
   const p={id:crypto.randomUUID(),...Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.trim()]))};
   if(!p.category||!p.name||!p.state||!p.spec)throw new Error('请完整填写产品信息');
   if(data.products.some(x=>['category','name','state','spec'].every(k=>x[k]===p[k])))throw new Error('相同规格已存在');
   data=await store.addProduct(p);dialog.close();render();toast('产品规格已添加');
  }
  if(form.id==='login-form') {const result=await store.login(fields.email,fields.password);if(result){data=result;render();}}
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
function loginPage(error='') {app.innerHTML=`<main class="login"><img src="./favicon.svg" width="40" height="40" alt="行情跳动"><h1>登录行情跳动</h1><p>使用管理员授权的账号访问团队采购工作台。</p><form id="login-form"><p class="form-error" role="alert">${esc(error)}</p><div class="field"><label for="email">邮箱</label><input id="email" name="email" type="email" autocomplete="username" required></div><div class="field" style="margin-top:16px"><label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" required></div><button class="btn primary" type="submit">登录</button></form></main>`;}
window.addEventListener('hashchange',()=>{readRoute();if(store.role)render();});
try {const result=await store.init();if(result){data=result;render();}else loginPage();}
catch(error) {
 if(store.cloud)loginPage(error.message);
 else app.innerHTML=`<div class="error-panel"><h1>暂时无法读取数据</h1><p>${esc(error.message)}</p><button class="btn" onclick="location.reload()">重新打开</button></div>`;
}

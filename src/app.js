import { dayString, shiftDay, addMonths, monthsBetween, provinces, bases, statuses, money, normalizePrice, normalizeFreight, latestQuotes, summarize, trend, validateQuote, csvCell, isValidQuote, matchesLeadCategory, leadPriceKg, hasComparableSpec } from './core.js';
import { leadPrefill } from './lead-prefill.js';
import { buildQuickQuote } from './lead-quick.js';
import { filterExport } from './export-filter.js';
import { store, probeCloud } from './store.js';
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
  sortNew:'<path d="M12 4v15m-5-5 5 5 5-5"/>', sortOld:'<path d="M12 20V5m-5 5 5-5 5 5"/>',
};
const icon = (name,size=16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.layers}</svg>`;
const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const state={page:location.hash.slice(1)||'overview',days:7,basis:'factory',category:'',province:'',product:'',source:'',search:'',sort:'price',sortDir:'asc',reviewStatus:'pending',pageNumber:1,sourceKind:'',leadKind:'',leadCategory:'',leadUse:'convertible',leadSource:'',leadSort:'date_desc',leadRange:30};
let data={products:[],quotes:[],leads:[]};
let busy=false;
let sessionStore;
try { sessionStore = sessionStorage; } catch {}
const settingsAccess = createSettingsAccess(sessionStore, location.pathname);
state.settingsView = 'sources';
function readRoute() {
 const route = location.hash.slice(1) || 'overview';
 // 报价审核已并入数据设置（2026-11-18）；采购比价已并入行情总览（2026-11-28）。
 // 旧的 #review / #compare 链接自动落到新位置，不留在导航里。
 state.page = ['sources','settings','settings/sources','settings/general','settings/review','review'].includes(route) ? 'settings' : route === 'compare' ? 'overview' : route;
 if(state.page === 'settings') state.settingsView = route === 'settings/general' ? 'general' : (route === 'settings/review' || route === 'review') ? 'review' : 'sources';
}
readRoute();
const admin=()=>store.role==='admin';
const canWrite=()=>['admin','editor'].includes(store.role);
const product=id=>data.products.find(p=>p.id===id);
// 停用品类 / 已删除品类从所有核价入口一并移除，报价数据本身不删。
const excludedCats=()=>new Set([...(data.prefs?.disabledCategories||[]),...(data.prefs?.deletedCategories||[])]);
const visibleProducts=()=>data.products.filter(p=>!excludedCats().has(p.category));
const categories=()=>[...new Set([...['猪','鸡','鸭','鹅','羊'].filter(c=>!excludedCats().has(c)),...visibleProducts().map(p=>p.category)])];
// 总览默认只看主力三类。2026-11-18 用户要求：产品参考均价默认只显示鹅、鸡、鸭，其余品类收起。
const CORE_CATS=['鹅','鸡','鸭'];
const leadCategories=()=>[...new Set([...categories(),'牛',...(data.leads||[]).map(l=>l.category).filter(Boolean)])].filter(c=>!excludedCats().has(c));
const productOptions=current=>{const list=visibleProducts();const cur=product(current);if(cur&&!list.includes(cur))list.unshift(cur);return list;};
const quoteVisible=q=>!excludedCats().has(product(q.product_id)?.category);
const HANDLED_LEADS=new Set(['converted','dismissed','deleted']);
// 处理方式筛选：只有供货线索能「核实入库」，行情 / 周报只能作参考。与来源类型是两个维度，可叠加。
// 2026-11-28 起默认只看「可核实入库」——打开数据中心就是为了核价，不该先被行情资讯冲满屏。
// 但用户主动切到某个不能核价的类型（行情均价 / 行业资讯）时，再套这条默认只会得到空表，
// 此时按「全部处理方式」处理，避免两个筛选互相抵消。传入 kind 是为了让类型按钮上的数字
// 按「点下去真能看到几条」来算，否则会出现按钮显示 0、点开却有一堆的情况。
const leadUseOk=(l,kind=state.leadKind)=>!state.leadUse||(kind&&kind!=='supply')||(state.leadUse==='convertible'?l.kind==='supply':l.kind!=='supply');
const matchesLeadUse=l=>leadUseOk(l);
const options=(values,current,first)=>`${first!==undefined?`<option value="">${esc(first)}</option>`:''}${values.map(v=>{const [value,label]=Array.isArray(v)?v:[v,v];return `<option value="${esc(value)}" ${current===value?'selected':''}>${esc(label)}</option>`;}).join('')}`;
const productLabel=p=>p?`${p.name} / ${p.state} / ${p.spec}`:'产品已移除';
// 规格本身就写着「待核实」时不再补一行同样的说明，避免同一个意思出现两次。
const productCell=p=>p?`<div class="product-name">${esc(p.name)}<span class="tag ${p.state==='鲜品'?'fresh':'frozen'}">${esc(p.state)}</span></div><div class="product-spec">${esc(p.spec)}</div>${hasComparableSpec(p)?'':`<div class="product-spec">${/待核实/.test(p.spec||'')?'不计入均价':'规格待核实，暂不统计'}</div>`}`:'未知产品';
const queryOptions=(id,extra={})=>({days:state.days,basis:state.basis,province:state.province,productId:id,products:data.products,...extra});
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
// 品类筛选：常用（鹅 / 鸡 / 鸭）为默认，全部放在其次，其余每个品类各一个标签，
// 避免把蛋品、豆制品等低频品类平铺在默认视图里。
function changeValue(values) { Object.assign(state,values,{pageNumber:1}); render(); }

// 主导航只留两页（2026-11-28）：采购比价并入行情总览，报价审核收进「数据设置」。
function header() {
 const pending=data.quotes.filter(q=>q.status==='pending').length;
 return `<header class="topbar"><a href="#overview" class="brand" aria-label="行情跳动首页"><img src="./favicon.svg" alt=""><div><strong>行情跳动</strong></div></a><nav class="nav" aria-label="主导航">${[['overview','行情总览'],['settings','数据设置']].map(([id,label])=>`<button data-page="${id}" class="${state.page===id?'active':''}">${label}${id==='settings'&&pending?`<span class="count">${pending}</span>`:''}</button>`).join('')}</nav><div class="top-actions"><span class="mode">${store.cloud?'团队工作台':'正式版'}</span><button class="avatar" data-action="account" aria-label="账户信息">${admin()?'管':store.role==='editor'?'编':'览'}</button></div></header>`;
}
function render() {
 if(!['overview','settings'].includes(state.page)) state.page='overview';
 app.innerHTML=header()+`<main class="shell">${({overview:overview,settings:settings}[state.page])()}<footer class="footer"><span><i class="dot"></i>行情跳动 · 让每一笔采购有据可依</span><span>样本参考均价，以实际询价及成交条件为准 ${icon('shield',12)}</span></footer></main>`;
}
// 导航已标明页面名称，正文不再重复大标题；操作按钮与左侧筛选同排，右端对齐。
function pageActionButtons() {
 return `<button class="btn" data-action="export" aria-label="导出数据">${icon('down',14)}<span class="export-label">导出数据</span></button>${canWrite()?`<button class="btn primary" data-action="add">${icon('plus',15)}录入报价</button>`:''}`;
}
function deltaFor(id) {
 const now=stats(id).average; const before=summarize(latestQuotes(data.quotes,queryOptions(id,{day:shiftDay(dayString(),-1)}))).average;
 if(now==null||before==null) return '<span class="delta">暂无日变化</span>';
 const delta=now-before; const pct=delta/before*100;
 return `<span class="delta ${Math.abs(pct)<.005?'':delta>0?'up':'down'}">${Math.abs(pct)<.005?'—':delta>0?'↗':'↘'} ${Math.abs(pct).toFixed(2)}% <span class="subtle">较昨日</span></span>`;
}
// 卡片底部的有效期提示：均价变成「—」时能看出是断供还是过期，不用猜。
function validNote(id) {
 const live=latestQuotes(data.quotes,{...queryOptions(id),days:3650});
 const until=live.map(q=>q.valid_until).sort().at(-1);
 if(!until) return '<div class="card-valid expired">暂无已入库的有效报价</div>';
 const remain=Math.round((Date.parse(until)-Date.parse(dayString()))/86400000);
 if(stats(id).count===0)
  return `<div class="card-valid expired">当前范围无报价 · 有效至 ${until.slice(5)}</div>`;
 return `<div class="card-valid${remain<=7?' soon':''}">有效至 ${until.slice(5)} · 剩 ${remain} 天</div>`;
}
// 2026-11-28 用户要求：删掉「产品参考均价」汇总表，把「采购比价」并入行情总览。
// 一页完成「看品类价 → 挑规格 → 比供货价」；筛选只留一份，不再两页各一套控件。
function marketToolbar() {
 const list = visibleProducts().filter(p => !state.category || p.category === state.category);
 return `<div class="filter-panel market-toolbar"><div class="filters market-filters"><select aria-label="品类" data-filter="category">${options(categories(),state.category,'全部品类')}</select><select aria-label="产品规格" data-filter="product">${options(list.map(p=>[p.id,productLabel(p)]),state.product,'全部产品规格')}</select>${provinceSelect()}${periodSelect()}${basisSelect()}<label class="search">${icon('search',15)}<input aria-label="搜索供应商或地区" placeholder="搜索供应商、地区…" value="${esc(state.search)}" id="search"></label><div class="page-bar-actions"><button class="text-btn" data-action="reset-filters">重置</button>${pageActionButtons()}</div></div></div>`;
}
// 品类卡片既是概览也是入口：点一下就把品类 / 规格、走势和下面的报价表一起切过去，
// 原来表格里的「去比价」按钮和两页之间的跳转都不再需要。
function categoryCards() {
 const CARD_HIDDEN = new Set(['猪']);
 const cardCats = state.category === '*' ? categories() : state.category ? [state.category] : CORE_CATS;
 const representatives = cardCats.filter(c => !CARD_HIDDEN.has(c)).map(c => {
  const list = visibleProducts().filter(p => p.category === c);
  if (!list.length) return null;
  return list.map(p => ({ p, count: stats(p.id).count })).sort((a, b) => b.count - a.count || (a.p.id < b.p.id ? -1 : 1))[0].p;
 }).filter(Boolean);
 if (!representatives.length) return '';
 return `<div class="cards">${representatives.map(p => {
  const s = stats(p.id);
  return `<button class="price-card ${state.product === p.id ? 'selected' : ''}" data-pick="${esc(p.id)}" aria-pressed="${state.product === p.id}" title="只看这个规格：走势和下方报价表一起切换"><div class="card-head"><span><span class="category-dot">${esc(p.category)}</span>${esc(p.name)}</span><span class="tag ${p.state==='鲜品'?'fresh':'frozen'}">${esc(p.state)}</span></div><div class="card-sub">${esc(p.spec)}</div><div class="card-price"><strong>${money(s.average)}</strong>${s.average==null?'':'<span>元 / kg</span>'}</div><div class="card-bottom">${deltaFor(p.id)}<span>${s.count} 条已入库</span></div>${validNote(p.id)}</button>`;
 }).join('')}</div>`;
}
// 统计条只在选中了具体规格时出现：不同规格不能合成一个均价，没选规格就不给汇总数字。
function summaryStrip(s) {
 return `<div class="summary-strip">${[['样本均价',money(s.average),'元/kg'],['最低供货价',money(s.min),'元/kg'],['中位价格',money(s.median),'元/kg'],['有效供应商样本',s.count,'个'],['覆盖省份',s.provinceCount,'省']].map(([label,val,unit])=>`<div class="summary-item"><p>${label}</p><strong>${val}</strong><small>${unit}</small></div>`).join('')}</div>`;
}
function quotePanel(rows, p, s) {
 const pageSize = 20; const total = Math.max(1, Math.ceil(rows.length / pageSize));
 state.pageNumber = Math.min(state.pageNumber, total);
 const pageRows = rows.slice((state.pageNumber - 1) * pageSize, state.pageNumber * pageSize);
 return `<section class="panel market-results"><div class="panel-head"><h2>供货报价 <span class="compare-count">${rows.length} 条${s?.sparse?' · 样本较少':''}</span></h2><select aria-label="排序方式" data-filter="sort">${options([['price','供货价：'+(state.sortDir==='desc'?'从高到低':'从低到高')],['date','报价日：从新到旧']],state.sort)}</select></div><div class="table-wrap"><table><thead><tr><th>产品 / 规格</th><th>供应商 / 地区</th><th aria-sort="${state.sort!=='price'?'none':state.sortDir==='asc'?'ascending':'descending'}"><button class="th-sort" type="button" data-sort-price title="按供货价${state.sort==='price'&&state.sortDir==='asc'?'从低到高排序，点击改为从高到低':'从高到低排序，点击改为从低到高'}">供货价 · 元/kg${icon(state.sort==='price'&&state.sortDir==='desc'?'sortNew':'sortOld',12)}</button></th><th>联系方式</th><th>采购条件</th><th>报价日 / 有效期</th><th></th></tr></thead><tbody>${pageRows.map(q=>`<tr><td>${productCell(product(q.product_id))}</td><td><div>${esc(q.supplier)}</div><div class="product-spec">${esc(q.province)} · ${esc(q.city||'未填城市')}</div></td><td class="number ${p&&q.price===s?.min?'green':''}">${money(q.price)}<small class="compare-mobile-unit"> 元/kg</small>${p&&q.price===s?.min?'<span class="tag fresh">最低</span>':''}</td><td><small class="compare-mobile-unit">联系方式 </small>${quoteContact(q)}</td><td>${esc(q.min_order||'起订量待询')}<div class="product-spec">${esc(bases[q.basis])}</div></td><td>${esc(q.quoted_on)}<div class="product-spec">有效至 ${esc(q.valid_until)}</div></td><td><button class="row-action" data-detail="${esc(q.id)}">详情 ${icon('chevron',12)}</button></td></tr>`).join('')||'<tr><td colspan="7" class="empty">没有符合条件的有效报价，试试调整筛选或录入报价。</td></tr>'}</tbody></table></div><div class="pagination"><span>北京时间 ${dayString().replaceAll('-','.')} · ${esc(bases[state.basis])} · 已去重，过期与未确认报价不参与</span><div><button class="btn small" data-pagination="-1" ${state.pageNumber<=1?'disabled':''}>上一页</button><span>${state.pageNumber} / ${total}</span><button class="btn small" data-pagination="1" ${state.pageNumber>=total?'disabled':''}>下一页</button></div></div></section>`;
}
function overview() {
 const rows = comparisonRows();
 const p = product(state.product);
 const s = p && hasComparableSpec(p) ? summarize(rows) : null;
 // 卡片与走势并排：报价表是采购最常看的，不能被上面两块挤到第二屏。
 return `${marketToolbar()}<div class="market-top">${categoryCards()}${chartPanel()}</div>${s ? summaryStrip(s) : ''}${quotePanel(rows, p, s)}`;
}
// 每个产品在「最近 7 日」窗口内真正可用的样本数。口径必须和图形一致，
// 不能复用 stats()——stats 跟随顶部「参考周期」筛选，可能是 1 天或 30 天。
function weekSamples() {
 return visibleProducts().map(p => ({ id: p.id, name: p.name, count: latestQuotes(data.quotes, {...queryOptions(p.id), days: 7}).length }));
}
// 空图不再只说一句「暂无有效报价」：讲清为什么空（没入库 / 超出 7 天 / 规格待核实），
// 并列出真有样本的产品供一键切换。
function chartEmpty(p, visible) {
 const others = visible.filter(x => x.id !== p?.id && x.count > 0).slice(0, 3);
 const today = dayString(), start = shiftDay(today, -6);
 const inWindow = data.quotes.filter(q => q.status === 'approved' && !q.deleted_at && Number(q.price) > 0 && q.quoted_on >= start && q.valid_until >= today);
 const blocked = inWindow.filter(q => !hasComparableSpec(product(q.product_id)));
 const approved = data.quotes.filter(q => q.status === 'approved' && !q.deleted_at);
 const lastDay = approved.map(q => q.quoted_on).sort().at(-1);
 const gap = lastDay ? Math.round((Date.parse(today) - Date.parse(lastDay)) / 86400000) : null;
 let why;
 if (inWindow.length && blocked.length === inWindow.length) {
  why = `最近 7 天入库的 ${blocked.length} 条报价规格为「待核实」，补齐规格后才会计入走势`;
 } else if (lastDay) {
  why = `最近一次入库是 ${lastDay.slice(5).replace('-', '/')}${gap === 0 ? '（今天）' : `（${gap} 天前）`}${gap >= 7 ? '，已超出 7 天窗口' : ''}`;
 } else {
  why = '还没有任何已入库报价';
 }
 return `<div class="chart-empty"><p><strong>${esc(p ? productLabel(p) : '当前产品')}</strong> 最近 7 天没有可用样本</p><p class="subtle">走势只统计「已核实入库、在有效期内、且规格可比」的报价；${esc(why)}。</p>${others.length ? `<div class="chart-pick"><span class="subtle">这 7 天有样本：</span>${others.map(x => `<button data-pick="${esc(x.id)}">${esc(x.name)} · ${x.count} 条</button>`).join('')}</div>` : ''}</div>`;
}
function chartPanel() {
 const visible = weekSamples();
 // 走势跟着筛选行的「产品规格」走。不再单独放一个产品下拉——同一页两个选择器会互相打架，
 // 而且合并后报价表也用同一个 state.product。没选规格时自动落在最近 7 天真有样本的产品上。
 const auto = visible.find(x => x.count > 0) || visible[0];
 let p = product(state.product);
 if (!p || excludedCats().has(p.category)) p = product(auto?.id);
 const values=trend(data.quotes,queryOptions(p?.id),7);
 const valid=values.filter(x=>x.average!=null); const s=stats(p?.id);
 const low=valid.length?Math.min(...valid.map(x=>x.average))-.3:0, high=valid.length?Math.max(...valid.map(x=>x.average))+.3:1;
 const y=v=>130-(v-low)/(high-low)*105;
 let lines=[],segment=[];
 values.forEach((v,i)=>{if(v.average==null){if(segment.length)lines.push(segment);segment=[];} else segment.push(`${43+i*440/6},${y(v.average)}`);}); if(segment.length)lines.push(segment);
 const svg=valid.length?`<svg class="chart" viewBox="0 0 510 165" role="img" aria-label="${esc(productLabel(p))}近七日均价"><title>${values.map(v=>`${v.day}：${money(v.average)}元/kg`).join('；')}</title>${[0,1,2].map(i=>{const n=low+(high-low)*i/2;return `<line x1="43" y1="${y(n)}" x2="486" y2="${y(n)}" stroke="#edf1ee" stroke-dasharray="3 4"/><text x="0" y="${y(n)+4}">${money(n)}</text>`;}).join('')}${lines.map(l=>`<polyline points="${l.join(' ')}" fill="none" stroke="#368b65" stroke-width="2.2" stroke-linejoin="round"/>`).join('')}${values.map((v,i)=>`<text x="${43+i*440/6}" y="157" text-anchor="middle">${v.day.slice(5).replace('-','/')}</text>${v.average!=null?`<circle cx="${43+i*440/6}" cy="${y(v.average)}" r="3" fill="white" stroke="#368b65" stroke-width="1.8"><title>${v.day} ${money(v.average)}元/kg</title></circle>`:''}`).join('')}</svg>`:chartEmpty(p,visible);
 return `<section class="panel chart-panel"><div class="panel-head"><h2>均价走势 <small>${p?`${esc(p.name)} · ${esc(p.state)} · `:''}最近 7 日</small></h2><div class="heading-actions">${p?`<button class="text-btn" data-comparable="${esc(p.id)}">可比均价 ${icon('arrow',12)}</button>`:''}</div></div><div class="chart-wrap"><div class="chart-summary"><strong>${money(s.average)}</strong><span class="subtle">元 / kg</span>${deltaFor(p?.id)}</div>${svg}</div><div class="chart-legend"><i class="dot"></i>${esc(bases[state.basis])}${state.province?` · ${esc(state.province)}`:' · 全国采样'} · ${state.days===1?'当日':'近 '+state.days+' 天'}样本</div></section>`;
}
// 可比均价：解决「不同重量没法比」的问题 —— 只在同一规格内部比较，绝不跨规格混算。
// 口径固定为「截至某日、最近 7 天」的样本均价，只把截止日往前推，做到同口径同比。
function comparableAverages(productId) {
 const today = dayString();
 const windows = [['当前', today], ['7 日前', shiftDay(today,-7)], ['30 日前', shiftDay(today,-30)], ['90 日前', shiftDay(today,-90)]];
 return windows.map(([label, day]) => {
  const s = summarize(latestQuotes(data.quotes, {...queryOptions(productId), day}));
  return { label, day, value: s.average, count: s.count };
 });
}
function comparableDialog(productId) {
 const base = product(productId);
 if (!base) return;
 const category = base.category;
 const list = visibleProducts().filter(p => p.category === category);
 const rows = list.map(p => {
  const values = comparableAverages(p.id);
  const now = values[0].value, past = values[2].value;
  const change = (now != null && past != null && Number(past) !== 0) ? (now - past) / past * 100 : null;
  return `<tr><td>${esc(p.name)}${p.state?`<span class="tag ${p.state==='鲜品'?'fresh':'frozen'}">${esc(p.state)}</span>`:''}<div class="product-spec">${esc(p.spec||'未填规格')}</div></td>${values.map(v=>`<td class="number">${v.value==null?'<span class="subtle">—</span>':money(v.value)}</td>`).join('')}<td><span class="delta ${change==null||Math.abs(change)<.005?'':change>0?'up':'down'}">${change==null?'—':`${change>0?'↗':'↘'} ${Math.abs(change).toFixed(1)}%`}</span></td><td class="subtle">${values[0].count} 条</td></tr>`;
 }).join('');
 const multi = list.length > 1;
 showDialog(dialogHead(`${esc(category)} · 可比均价`, multi ? `该品类 ${list.length} 个规格，逐行独立比较，不同重量不混算` : '当前只有 1 个规格，可直接与历史同口径比较') + `<div class="form-body comparable-body">${multi?`<div class="comparable-note">${icon('info',13)} 同一行内纵向可比；不同规格的重量、部位、出肉率不同，横向数字不能直接相减。</div>`:''}<div class="table-wrap"><table><thead><tr><th>规格</th><th>当前</th><th>7 日前</th><th>30 日前</th><th>90 日前</th><th>较 30 日前</th><th>样本</th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="empty">该品类下暂无规格</td></tr>'}</tbody></table></div><div class="table-foot"><span>${icon('info',12)} 每列均为「截至该日、最近 7 天」的样本均价，元 / kg · ${esc(bases[state.basis])}${state.province?` · ${esc(state.province)}`:' · 全国采样'}</span><span>规格之间不合并均价</span></div></div><div class="dialog-foot"><button class="btn" data-action="close">关闭</button></div>`);
}
// 最近入库已从行情总览移到「数据设置 → 基础设置」，默认收起，需要时展开，总览页保持清爽。
function recentRows(limit = 4) {
 const recent=data.quotes.filter(q=>q.status==='approved'&&quoteVisible(q)&&isValidQuote(q)).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)).slice(0,limit);
 return `<div class="recent-list">${recent.map(q=>`<div class="recent-row"><div class="recent-icon">${icon('check',15)}</div><div class="recent-text"><strong>${esc(product(q.product_id)?.name)} <span class="subtle">/ ${esc(product(q.product_id)?.state)} · ${esc(q.province)}</span></strong><p>${esc(q.supplier)} · ${esc(q.quoted_on.slice(5))}</p></div><button class="recent-price" data-detail="${esc(q.id)}">¥ ${money(q.price)}<small>已入库</small></button></div>`).join('')||'<div class="empty">还没有入库报价</div>'}</div>`;
}
function comparisonRows() {
 return latestQuotes(data.quotes,{...queryOptions(state.product),category:state.category,products:visibleProducts(),source:state.source,includeUnconfirmedSpecs:true}).filter(q=>quoteVisible(q)&&(!state.search||[q.supplier,q.city,q.province,productLabel(product(q.product_id))].join(' ').toLowerCase().includes(state.search.toLowerCase()))).sort((a,b)=>state.sort==='date'?(state.sortDir==='asc'?a.quoted_on.localeCompare(b.quoted_on):b.quoted_on.localeCompare(a.quoted_on)):(state.sortDir==='desc'?b.price-a.price:a.price-b.price));
}
const mobileLine=/^联系手机：((?:\+86)?1[3-9]\d{9})[ \t]*$/m;
const quoteMobile=notes=>String(notes??'').match(mobileLine)?.[1]||'';
const withoutQuoteMobile=notes=>String(notes??'').replace(mobileLine,'').trim();
function quoteContact(q) {
 const phone=quoteMobile(q.notes);
 return phone?'<a class="quote-phone" href="tel:'+phone+'">'+phone+'</a>':'<span class="subtle">未填写</span>';
}
function review() {
 const rows=data.quotes.filter(q=>q.status===state.reviewStatus).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
 const limited=rows.slice(0,100);
 return `${admin()?'':`<div class="review-intro">${icon('shield',15)} 你可以查看报价记录。编辑人员提交的报价，由管理员审核后入库。</div>`}<div class="filters"><div class="segmented">${Object.entries(statuses).map(([id,label])=>`<button data-review-status="${id}" class="${state.reviewStatus===id?'active':''}">${label} ${data.quotes.filter(q=>q.status===id).length}</button>`).join('')}</div><div class="page-bar-actions"><button class="btn small" data-action="refresh">${icon('refresh',14)}刷新记录</button></div></div><section class="panel"><div class="table-wrap"><table><thead><tr><th>产品 / 规格</th><th>供应商 / 地区</th><th>供货价 · 元/kg</th><th>报价口径</th><th>报价日 / 有效期</th><th>处理</th></tr></thead><tbody>${limited.map(q=>`<tr><td>${productCell(product(q.product_id))}</td><td>${esc(q.supplier)}<div class="product-spec">${esc(q.province)} ${esc(q.city)}</div></td><td class="number">${money(q.price)}</td><td class="subtle">${esc(bases[q.basis])}</td><td>${esc(q.quoted_on)}<div class="product-spec">有效至 ${esc(q.valid_until)}${q.valid_until<dayString()?' · 已过期':''}</div></td><td><div class="review-actions"><button class="btn small" data-detail="${esc(q.id)}">核对</button>${admin()&&state.reviewStatus==='pending'?`<button class="btn primary small" data-review="approved" data-id="${esc(q.id)}">确认</button><button class="btn small danger" data-review="rejected" data-id="${esc(q.id)}">忽略</button>`:admin()&&state.reviewStatus!=='pending'?`<button class="text-btn" data-review="pending" data-id="${esc(q.id)}">退回待审</button>`:''}</div></td></tr>`).join('')||'<tr><td colspan="6" class="empty">这个列表里暂时没有报价</td></tr>'}</tbody></table></div><div class="table-foot"><span>显示最近 ${limited.length} / ${rows.length} 条 · 已忽略、未确认、过期报价均不参与当前均价。</span></div></section>`;
}
function sourcesPage() {
 // 已入库的线索不消失，沉到列表末尾并标注，方便接着核下一条；忽略 / 删除仍由「已处理」统一管理。
 const allLeads=data.leads||[];
 // 发布时间范围：采集会抓到多年前的行情文章，默认只看近 30 天，更早的折叠起来（不算删除）。
 const leadRange=Number(state.leadRange)||0;
 const cutoff=leadRange>0?shiftDay(dayString(),-(leadRange-1)):'';
 const inRange=l=>!cutoff||!l.published_on||l.published_on>=cutoff;
 const olderCount=cutoff?allLeads.filter(l=>l.published_on&&l.published_on<cutoff&&matchesLeadCategory(l,state.leadCategory)&&matchesLeadUse(l)).length:0;
 const activeLeads=allLeads.filter(l=>!HANDLED_LEADS.has(l.status));
 // 2026-11-28：供货来源增到三个后，单一来源就占了九成待审线索，其余来源被挤到几十页之外，
 // 看上去像「只能从一家核价」。按站点给一个下拉，直接切到某个来源，不再靠翻页找。
 const srcKey=l=>(l.source_id||l.source_name||'?').split('_')[0];
 const srcName=k=>sourceCatalog.find(s=>s.id===k)?.name||allLeads.find(l=>srcKey(l)===k)?.source_name||k;
 const srcTally=new Map();
 allLeads.filter(l=>!HANDLED_LEADS.has(l.status)).forEach(l=>{const k=srcKey(l);srcTally.set(k,(srcTally.get(k)||0)+1);});
 const srcOptions=[...srcTally].sort((a,b)=>b[1]-a[1]).map(([k,n])=>[k,`${srcName(k)}（${n}）`]);
 const match=l=>(!state.leadKind||l.kind===state.leadKind)&&(!state.leadSource||srcKey(l)===state.leadSource)&&matchesLeadCategory(l,state.leadCategory)&&matchesLeadUse(l)&&inRange(l);
 // 表头可点排序：标题（拼音）、标价（折算元/kg）、地区、发布日期。
 // 取值缺失的行（日期待核实、区间无单价、按只计价）始终沉在末尾，不随升降序翻转。
 const leadField=(state.leadSort||'date_desc').split('_')[0];
 const leadAsc=(state.leadSort||'date_desc').endsWith('_asc');
 const dir=leadAsc?1:-1;
 const fetchedDesc=(a,b)=>(Date.parse(b.fetched_at||0)||0)-(Date.parse(a.fetched_at||0)||0);
 const leadValue=l=>{
  if(leadField==='title') return l.title||null;
  if(leadField==='price') return leadPriceKg(l.price_text);
  if(leadField==='region') return l.region_text||null;
  return l.published_on||null;
 };
 const byLead=(a,b)=>{
  const x=leadValue(a),y=leadValue(b);
  if(x==null&&y==null)return fetchedDesc(a,b);
  if(x==null)return 1;
  if(y==null)return -1;
  const r=typeof x==='number'?x-y:String(x).localeCompare(String(y),'zh-Hans-CN')||0;
  return r*dir||fetchedDesc(a,b);
 };
 const pendingLeads=activeLeads.filter(match).sort(byLead);
 const doneLeads=allLeads.filter(l=>l.status==='converted'&&match(l)).sort(byLead);
 const leads=[...pendingLeads,...doneLeads];
 const handledCount=allLeads.filter(l=>HANDLED_LEADS.has(l.status)&&matchesLeadCategory(l,state.leadCategory)).length;
 const total=Math.max(1,Math.ceil(leads.length/20));state.pageNumber=Math.min(state.pageNumber,total);
 const rows=leads.slice((state.pageNumber-1)*20,state.pageNumber*20);
 const catalog=sourceCatalog.filter(s=>!state.sourceKind||s.kind===state.sourceKind);
 const latest=(data.leads||[]).map(l=>l.fetched_at).sort().at(-1);
 const failedSources=(store.discovery?.runs||[]).filter(r=>!r.ok).map(r=>sourceCatalog.find(s=>s.id===r.source_id)?.name||r.source_id);
 const collectionNotice=failedSources.length?`<div class="notice">${esc(failedSources.join('、'))}本次采集未成功，保留上次线索；其余来源正常更新。</div>`:'';
 return `${store.discovery?.error?`<div class="notice">采集快照加载失败：${esc(store.discovery.error)}</div>`:''}${collectionNotice}<section class="panel"><div class="panel-head lead-head"><div class="lead-filters"><select aria-label="线索来源" data-filter="leadSource" title="按采集网站筛选">${options(srcOptions,state.leadSource,`全部来源${activeLeads.length?'（'+activeLeads.length+'）':''}`)}</select><select aria-label="线索品类" data-filter="leadCategory">${options(leadCategories(),state.leadCategory,'全部品类')}</select><select aria-label="处理方式" data-filter="leadUse" title="按能否核实入库筛选">${options([['convertible','可核实入库'],['reference','仅作参考']],state.leadUse,'全部处理方式')}</select><select aria-label="发布时间" data-filter="leadRange" title="按原文发布日期筛选">${options([[7,'近 7 天'],[30,'近 30 天'],[90,'近 90 天'],[365,'近一年'],[0,'全部时间']],leadRange)}</select>${admin()?`<button class="btn small" data-action="managed-leads">已处理 ${handledCount}</button>`:''}</div><h2>自动采集线索 <small>${latest?'最近采集 '+esc(new Date(latest).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})):'尚未采集'}</small></h2><div class="segmented">${Object.entries({'':'全部类型',...sourceKinds}).map(([kind,name])=>`<button data-lead-kind="${kind}" class="${state.leadKind===kind?'active':''}">${name} ${activeLeads.filter(l=>inRange(l)&&(!kind||l.kind===kind)&&leadUseOk(l,kind)&&matchesLeadCategory(l,state.leadCategory)).length}</button>`).join('')}</div></div><div class="table-wrap"><table><thead><tr><th${leadField==='title'?` aria-sort="${leadAsc?'ascending':'descending'}"`:''}><button class="th-sort" type="button" data-lead-sort="title" title="按标题拼音排序${leadField==='title'?(leadAsc?'，当前从 A 到 Z，点击改为倒序':'，当前倒序，点击改为从 A 到 Z'):''}">原文产品 / 标题${icon(leadField==='title'&&!leadAsc?'sortNew':'sortOld',12)}</button></th><th${leadField==='price'?` aria-sort="${leadAsc?'ascending':'descending'}"`:''}><button class="th-sort" type="button" data-lead-sort="price" title="按标价排序，按斤 / 吨已折算为元/kg，按只计价的排在最后${leadField==='price'?(leadAsc?'，当前从低到高，点击改为从高到低':'，当前从高到低，点击改为从低到高'):''}">标价原文${icon(leadField==='price'&&!leadAsc?'sortNew':'sortOld',12)}</button></th><th${leadField==='date'||leadField==='region'?` aria-sort="${leadAsc?'ascending':'descending'}"`:''}><button class="th-sort" type="button" data-lead-sort="date" title="按发布日期从新到旧；再点改为从旧到新；第三次按地区拼音排序">地区 / 发布日期${icon((leadField==='date'||leadField==='region')&&!leadAsc?'sortNew':'sortOld',12)}</button></th><th>来源</th><th>核对与处理</th></tr></thead><tbody>${rows.map(l=>`<tr class="${l.status==='converted'?'lead-done':''}"><td class="lead-title"><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.title)}</a>${l.details?`<details class="lead-more"><summary>详情</summary><div class="lead-note">${esc(l.details)}</div></details>`:''}</td><td>${esc(l.price_text||'见原文')}</td><td>${esc(l.region_text||'原文范围')}<div class="product-spec">${esc(l.published_on||'日期待核实')}</div></td><td>${esc(l.source_name)}<div class="product-spec">${esc(sourceKinds[l.kind])}</div></td><td><div class="review-actions lead-actions"><a class="btn small" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" aria-label="查看原文：${esc(l.title)}">查看原文 ↗</a>${l.status==='converted'?'<span class="pill">已入库</span>':l.kind==='supply'&&canWrite()?`<div class="review-actions"><button class="btn small primary" data-lead="${esc(l.id)}">核实入库</button>${admin()?`<button class="text-btn" data-dismiss-lead="${esc(l.id)}">忽略</button>`:''}</div>`:'<span class="subtle">仅作外部参考</span>'}</div></td></tr>`).join('')||'<tr><td colspan="5" class="empty">当前筛选下暂无线索'+[cutoff?'这段时间没有新线索，可以把发布时间改成「全部时间」':'',state.leadUse==='convertible'&&!state.leadKind?'当前只看「可核实入库」，想看行情与资讯请把处理方式改成「全部处理方式」':''].filter(Boolean).join('；')+'。</td></tr>'}</tbody></table></div><div class="pagination"><span>${pendingLeads.length} 条待核实${doneLeads.length?` · 已入库 ${doneLeads.length} 条排在最后`:''}${olderCount?` · 折叠 ${olderCount} 条旧线索`:''}</span><div><button class="btn small" data-pagination="-1" ${state.pageNumber<=1?'disabled':''}>上一页</button><span>${state.pageNumber} / ${total}</span><button class="btn small" data-pagination="1" ${state.pageNumber>=total?'disabled':''}>下一页</button></div></div></section><section class="panel" style="margin-top:20px"><div class="panel-head"><h2>来源目录 <small>${sourceCatalog.length} 个候选来源</small></h2><select aria-label="来源分类" data-filter="sourceKind">${options(Object.entries(sourceKinds),state.sourceKind,'全部来源类型')}</select></div><div class="table-wrap"><table><thead><tr><th>来源</th><th>用途 / 覆盖</th><th>接入进度</th><th>口径与说明</th></tr></thead><tbody>${catalog.map(s=>`<tr><td><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)} ↗</a></td><td>${esc(sourceKinds[s.kind])}<div class="product-spec">${esc(s.scope)}</div></td><td class="subtle">${esc(s.status)}</td><td class="source-notes">${esc(s.note)}</td></tr>`).join('')}</tbody></table></div><div class="table-foot"><span>公开列表每天定时核对三次；付费、登录、验证码及不可访问来源需要单独接入。已核验表示页面可见，不表示报价已认证。</span></div></section>`;
}
// 已处理线索管理：修改报价 / 撤销入库 / 删除 / 恢复，操作后整页重新渲染。
function managedLeadsDialog() {
 if(!admin())return;
 const handled=(data.leads||[]).filter(l=>HANDLED_LEADS.has(l.status)).sort((a,b)=>(b.published_on||'').localeCompare(a.published_on||''));
 const rows=handled.map(l=>{
  const quote=data.quotes.find(q=>q.collection_item_id===l.id);
  const label=l.status==='converted'?'已入库':l.status==='deleted'?'已删除':'已忽略';
  const pill=l.status==='deleted'?'off':l.status==='converted'?'':'warn';
  return `<div class="manager-row"><span><strong>${esc(l.title)}</strong><div class="product-spec">${label}<span class="pill ${pill}">${esc(l.published_on||'日期待核实')}</span>${quote?` · ¥ ${money(quote.price)} / kg`:''}${l.url?` · <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">原文 ↗</a>`:''}</div></span><div class="manager-actions">${quote?`<button class="btn small" data-edit="${esc(quote.id)}">修改报价</button><button class="text-btn" data-undo-lead="${esc(l.id)}">撤销入库</button>`:''}${l.status==='converted'?'':`<button class="btn small" data-restore-lead="${esc(l.id)}">恢复待审</button>`}${l.status==='deleted'?'':`<button class="text-btn" data-delete-lead="${esc(l.id)}">删除</button>`}</div></div>`;
 }).join('')||'<div class="empty" style="padding:34px 10px">还没有已处理的线索</div>';
 showDialog(dialogHead('已处理线索',`${handled.length} 条 · 已入库后自动从待审列表隐藏`)+`<div class="form-body"><p class="form-error" role="alert"></p><div class="manager-list">${rows}</div><p class="subtle" style="margin:14px 0 0">「删除」只把线索移出队列、报价保留，可随时恢复；「撤销入库」会删除该线索生成的报价并放回待审。</p></div><div class="dialog-foot"><button class="btn" data-action="close">关闭</button></div>`);
}
function settings() {
 if(!settingsAccess.isUnlocked()) {
  return `<section class="settings-unlock panel"><div class="settings-unlock-icon">${icon('shield',22)}</div><h2>输入设置密码</h2><p>解锁后可查看数据中心和基础设置。</p><form id="settings-unlock-form"><p class="form-error" role="alert"></p><div class="field"><label for="settings-password">入口密码</label><input id="settings-password" name="password" type="password" autocomplete="off" required maxlength="256" placeholder="请输入密码"></div><button class="btn primary" type="submit">解锁数据设置</button></form><small>仅在当前标签页保持解锁，可随时手动锁定。</small></section>`;
 }
 const pending=data.quotes.filter(q=>q.status==='pending').length;
 const tab=(id,label,extra='')=>`<button data-settings-view="${id}" class="${state.settingsView===id?'active':''}" aria-pressed="${state.settingsView===id}">${label}${extra}</button>`;
 return `<div class="settings-tabs"><div class="segmented" aria-label="数据设置栏目">${tab('sources','数据中心')}${tab('review','报价审核',pending?`<span class="count">${pending}</span>`:'')}${tab('general','基础设置')}</div><div class="tabs-actions"><button class="btn small" data-action="export" aria-label="导出数据">${icon('down',13)}<span class="export-label">导出数据</span></button>${canWrite()?`<button class="btn primary small" data-action="add">${icon('plus',13)}录入报价</button>`:''}</div></div>` + (state.settingsView==='review' ? review() : state.settingsView==='sources' ? sourcesPage() : settingsBody());
}
function settingsBody() {
 const recentCount=data.quotes.filter(q=>q.status==='approved'&&quoteVisible(q)&&isValidQuote(q)).length;
 return `<div class="filter-panel"><div class="filters"><label for="settings-category">核价品类</label><select id="settings-category" aria-label="核价品类" data-filter="leadCategory">${options(categories(),state.leadCategory,'全部品类')}</select>${admin()?'<button class="btn small" data-action="manage-categories">管理品类</button>':''}</div></div><div class="settings-grid"><details class="panel fold"><summary class="panel-head fold-sum"><span class="fold-icon">${icon('layers',15)}</span><span class="fold-title"><h2>产品库</h2><small>${visibleProducts().length} 个规格</small></span></summary><div class="settings-body">${admin()?`<div class="fold-actions"><button class="text-btn" data-action="add-product">+ 添加产品</button></div>`:''}${visibleProducts().map(p=>`<div class="settings-row"><span><span class="category-dot">${esc(p.category)}</span>${esc(p.name)} <small>${esc(p.state)}</small></span><span class="row-right"><small>${esc(p.spec)}</small>${admin()?`<button class="text-btn danger" data-delete-product="${esc(p.id)}" aria-label="删除 ${esc(p.name)}">删除</button>`:''}</span></div>`).join('')}</div></details><details class="panel fold"><summary class="panel-head fold-sum"><span class="fold-icon">${icon('search',15)}</span><span class="fold-title"><h2>数据来源</h2><small>人工确认后入库</small></span></summary><div class="settings-body"><h3>人工询价</h3><p>电话、微信或线下询价，记录供应商、报价日、有效期及采购条件。编辑人员提交后由管理员确认。</p><h3>引擎采集</h3><p>当前接入四类冻品供货线索（清远鸡、白条鹅、清远麻鸡、鸽子），另有毛鸡毛鸭毛鹅行情表、白条鸡批发市场价、各省生猪出栏日均价与畜牧周报，在来源中心逐条核对后转成报价。行情价与供货价分开处理，不混算。</p><div class="settings-row"><span>公开网页适配器</span><strong>${(store.discovery?.runs||[]).length||7} 个</strong></div><p style="margin-top:12px">另支持 JSON / CSV 授权接口。市场行情、官方监测与供货价分别处理；付费或登录内容仍待单独接入。</p><a href="#settings">前往数据中心 →</a><h3>采集配置</h3><p>在仓库 <code>collector/sources.json</code> 配置接口及字段映射，通过 GitHub Actions 运行。</p></div></details><details class="panel fold"><summary class="panel-head fold-sum"><span class="fold-icon">${icon('info',15)}</span><span class="fold-title"><h2>统计口径</h2><small>样本 · 周期 · 去重规则</small></span></summary><div class="settings-body"><ul><li>按产品规格、鲜冻状态、含税及运输口径独立统计，统一换算为元 / kg。</li><li>周期内，同供应商、同省、同规格、同口径取最新有效报价，按供应商等权算术平均，同时显示中位价与最低价。</li><li>只纳入已确认、未过期的报价。低于 5 个样本或覆盖少于 3 省，标记“样本较少”。</li><li>全国地区表示采样范围，不代表全国全部市场。品类卡片显示一个明确的代表规格，不把不同产品混成一个均价。</li><li>走势按历史当日有效样本回算；后续补录或更改审核状态可能改变历史曲线。</li><li>参考含运价为报价加填写的每公斤运费；未税报价仍需另核税费。最低供货价仍需核实品质、起订量和到货条件。</li></ul></div></details><details class="panel fold"><summary class="panel-head fold-sum"><span class="fold-icon">${icon('shield',15)}</span><span class="fold-title"><h2>团队与访问</h2><small>成员角色与访问权限</small></span></summary><div class="settings-body"><div class="settings-row"><span>当前模式</span><strong>${store.cloud?'共享数据库':'正式版'}</strong></div><div class="settings-row"><span>当前角色</span><strong>${({admin:'管理员',editor:'编辑人员',viewer:'只读成员'})[store.role]}</strong></div><div class="settings-row"><span>数据保存位置</span><strong>${store.cloud?'共享数据库':'此设备（未上传）'}</strong></div>${!store.cloud?'<p style="margin-top:12px">换设备或手机查看时，先在这台设备「导出完整备份」，再到另一台「导入备份」；自动同步需连接共享数据库。</p>':''}<div class="heading-actions"><button class="btn" data-action="backup">${icon('down',14)}导出完整备份</button><button class="btn" data-action="import-backup">导入备份</button><input type="file" id="import-backup-file" accept="application/json,.json" hidden>${store.cloud?`${admin()?'<button class="btn" data-action="members">管理成员</button>':''}<button class="btn" data-action="logout">退出登录</button>`:''}</div></div></details><details class="panel fold full"><summary class="panel-head fold-sum"><span class="fold-icon">${icon('check',15)}</span><span class="fold-title"><h2>最近入库</h2><small>点开查看，共 ${recentCount} 条有效报价</small></span></summary><div class="settings-body recent-fold">${recentRows(8)}<p style="margin:14px 0 0"><a href="#overview">去行情总览看全部 →</a></p></div></details></div>`;
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
 showDialog(dialogHead('确认入库',esc(lead.title))+`<div class="form-body"><p class="form-error" role="alert"></p>${stale}${blocked}<div class="settings-body" style="padding:0;line-height:1.6">${q.rows.map(r=>r.label==='报价日 / 有效期'?`<div class="settings-row"><span>${esc(r.label)}<small class="product-spec" style="display:block">${esc(r.note)}</small></span><span class="quick-until"><strong>${esc(q.quote.quoted_on)}</strong> → <select id="quick-valid-months" aria-label="报价有效期" required><option value="">有效期</option><option value="1">1 个月</option><option value="2">2 个月</option><option value="3">3 个月</option></select></span></div>`:`<div class="settings-row"><span>${esc(r.label)}<small class="product-spec" style="display:block">${esc(r.note)}</small></span><strong>${esc(r.value)}</strong></div>`).join('')}${extra?`<p class="subtle" style="margin:14px 0 0">${extra}</p>`:''}<p class="subtle" style="margin:14px 0 0">系统补全项已写入备注，入库后可在「报价审核 → 详情 → 编辑报价」修改。<a href="${esc(lead.url)}" target="_blank" rel="noopener noreferrer">查看采集原文 ↗</a></p></div></div><div class="dialog-foot"><button class="btn" data-action="close">取消</button><button class="btn" data-quick-edit="${esc(lead.id)}">修改后再录</button>${q.ok?`<button class="btn primary" data-quick-confirm="${esc(lead.id)}">确认入库</button>`:''}</div>`);
}
function quoteForm(existing,lead) {
 if(!canWrite()) return;
 let collectedProduct;
 const q=existing||{product_id:state.product||data.products[0]?.id,price:'',province:'广东',city:'',supplier:'',basis:state.basis,source:'manual',source_name:'电话询价',source_url:'',quoted_on:dayString(),valid_until:'',min_order:'',freight:'',notes:''};
 if(lead) {
  if(lead.kind!=='supply')return;
  const prefill=leadPrefill(lead);
  collectedProduct=prefill.product;
  const matched=data.products.find(p=>collectedProduct.name&&collectedProduct.state&&collectedProduct.spec&&['category','name','state','spec'].every(k=>p[k]===collectedProduct[k]));
  Object.assign(q,prefill.quote,{product_id:matched?.id||(admin()?'__new__':'')});
 }
 // 有效期改为「1 / 2 / 3 个月」，到期日由报价日推算；编辑旧报价时若能对上整月则回显月数，否则保留原到期日。
 const validMonths=q.quoted_on&&q.valid_until?monthsBetween(q.quoted_on,q.valid_until):0;
 const validOptions=[[1,'1 个月'],[2,'2 个月'],[3,'3 个月']];
 const validCurrent=validMonths?String(validMonths):(q.valid_until?'keep':'1');
 if(q.valid_until&&!validMonths)validOptions.push(['keep',`保持原到期日 ${q.valid_until}`]);
 showDialog(dialogHead(existing?'编辑报价':'录入报价','统一以元 / kg 入库，鲜冻、规格和价格口径分别比较。')+`${lead?`<div class="lead-origin"><span>已带入待核实信息，可修改；请核对并补齐规格、状态及供货条件。</span>${unlocked()?`<a class="btn small" href="${esc(lead.url)}" target="_blank" rel="noopener noreferrer">查看详情 ↗</a>`:''}</div>`:''}<form id="quote-form" data-id="${esc(existing?.id||'')}" data-lead-id="${esc(lead?.id||'')}"><div class="form-body"><p class="form-error" role="alert"></p><div class="form-grid">${field('产品 / 规格 <span>*</span>',`<select name="product_id" aria-label="产品规格" required>${options(productOptions(q.product_id).map(p=>[p.id,productLabel(p)]),q.product_id,'请选择具体产品规格')}${admin()?'<option value="__new__">手工填写新产品 / 规格</option>':''}</select>${admin()?'<button class="text-btn" type="button" id="custom-product-button">+ 手工新增产品 / 规格</button>':''}`,true)}${admin()?`<div class="full custom-product-fields" id="custom-product-fields" hidden>${field('品类 <span>*</span>',`<input name="custom_category" aria-label="自定义品类" list="custom-categories" maxlength="20" placeholder="例如：鹅" disabled><datalist id="custom-categories">${categories().map(c=>`<option value="${esc(c)}">`).join('')}</datalist>`)}${field('产品名称 <span>*</span>','<input name="custom_name" aria-label="自定义产品名称" maxlength="60" placeholder="例如：狮头鹅、鹅掌" disabled>')}${field('鲜冻 / 状态 <span>*</span>',`<select name="custom_state" aria-label="自定义产品状态" disabled>${options(['鲜品','冻品','活体','冷鲜'],'','请选择鲜冻状态')}</select>`)}${field('规格 <span>*</span>','<input name="custom_spec" aria-label="自定义规格" maxlength="160" placeholder="部位、产地、等级、重量、包装等" disabled>')}</div>`:''}${field('供货价格 <span>*</span>',`<div class="price-input"><input name="price" aria-label="供货价格" type="number" step="0.0001" min="0.0001" value="${esc(q.price)}" required placeholder="请输入价格"><select name="unit" aria-label="计价单位">${options([['kg','元/kg'],['jin','元/斤'],['ton','元/吨']],'kg')}</select></div>`)}${field('价格口径 <span>*</span>',`<select name="basis" aria-label="价格口径" required>${options(Object.entries(bases),q.basis,'核实后选择价格口径')}</select>`)}${field('供应商 / 市场 <span>*</span>',`<input name="supplier" aria-label="供应商" value="${esc(q.supplier)}" required maxlength="120" placeholder="尽量统一供应商名称">`)}${field('联系手机',`<input type="tel" name="contact_mobile" aria-label="联系手机" maxlength="24" value="${esc(quoteMobile(q.notes))}" placeholder="手机号码（选填）">`)}${field('报价省份 <span>*</span>',`<select name="province" aria-label="报价省份" required>${options(provinces,q.province,'请选择省份')}</select>`)}${field('城市',`<input name="city" aria-label="城市" maxlength="60" value="${esc(q.city)}" placeholder="例如：潍坊">`)}${field('起订量',`<input name="min_order" aria-label="起订量" maxlength="100" value="${esc(q.min_order)}" placeholder="例如：500 kg">`)}${field('报价日期 <span>*</span>',`<input name="quoted_on" aria-label="报价日期" type="date" value="${q.quoted_on}" max="${dayString()}" required>`)}${field('有效期 <span>*</span>',`<select name="valid_months" aria-label="有效期" required>${options(validOptions,validCurrent)}</select><small>按报价日自动推算到期日；到期后自动退出均价与比价，不再显示为有效报价。</small>`)}${field('运费',`<div class="price-input"><input name="freight" aria-label="运费" type="number" step="0.01" min="0" value="${esc(q.freight??'')}" placeholder="未知留空"><select name="freight_unit" aria-label="运费计价单位">${options([['kg','元/kg'],['ton','元/吨']],'kg')}</select></div><small>按吨报价会自动折算成元/kg；到货价已含运时留空。</small>`)}${unlocked()?`${field('来源方式',`<select name="source" aria-label="来源方式">${options([['manual','人工询价'],['engine','引擎采集 / 手动补录']],q.source)}</select>`)}${field('来源名称',`<input name="source_name" aria-label="来源名称" maxlength="120" value="${esc(q.source_name)}" placeholder="电话、微信或行情网站名称">`)}${field('原始链接',`<input name="source_url" aria-label="原始链接" type="url" value="${esc(q.source_url)}" placeholder="链接（可选）">`)}`:`<input type="hidden" name="source" value="${esc(q.source)}"><input type="hidden" name="source_name" value="${esc(q.source_name)}"><input type="hidden" name="source_url" value="${esc(q.source_url)}">`}${field('备注 / 询价联系人',`<textarea name="notes" aria-label="备注" maxlength="2000" placeholder="品质、账期、联系人、特殊条件等">${esc(withoutQuoteMobile(q.notes))}</textarea>`,true)}${admin()?field('入库方式',`<select name="status" aria-label="入库方式">${options([['approved','确认无误，直接入库'],['pending','先存入待确认']],existing?.status==='rejected'?'pending':q.status||'approved')}</select><small>引擎来源的新报价默认待确认；审核后再入库。</small>`,true):'<div class="subtle full">提交后进入待确认列表，管理员确认后参与统计。</div>'}</div></div><div class="dialog-foot"><button type="button" class="btn" data-action="close">取消</button><button type="submit" class="btn primary">${existing?'保存修改':admin()?'保存报价':'提交审核'}</button></div></form>`);
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
 showDialog(dialogHead('报价详情',productLabel(p))+`<div class="form-body"><div class="form-grid">${[['供应商',q.supplier],['地区',`${q.province} ${q.city}`],['供货价格',`¥ ${money(q.price)} / kg`],['价格口径',bases[q.basis]],['报价日期',q.quoted_on],['有效期',q.valid_until],['起订量',q.min_order||'未填写'],['运费（元/kg）',q.freight!=null?`¥ ${money(q.freight)}`:'待询'],['状态',`${statuses[q.status]}${q.valid_until<dayString()?' · 已过期':''}`]].map(([l,v])=>field(l,`<div>${esc(v)}</div>`)).join('')}${admin()?field('出处',`<div>${esc(q.source==='engine'?'引擎采集':'人工询价')} · ${esc(q.source_name||'未填写')}</div>${q.source_url&&/^https?:\/\//i.test(q.source_url)?`<div class="source-url"><a target="_blank" rel="noopener noreferrer" href="${esc(q.source_url)}">${esc(q.source_url)}</a></div>`:'<div class="source-url subtle">未提供源网址</div>'}`,true):''}${field('备注',`<div style="white-space:pre-wrap;line-height:1.8">${esc(safeNotes(q.notes))}</div>`,true)}${q.reviewed_at?field('最近审核时间',`<span class="subtle">${esc(new Date(q.reviewed_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))}</span>`,true):''}</div></div><div class="dialog-foot">${admin()?`<button class="btn" data-edit="${esc(q.id)}">编辑报价</button>${q.status==='pending'?`<button class="btn danger" data-review="rejected" data-id="${esc(q.id)}">忽略</button><button class="btn primary" data-review="approved" data-id="${esc(q.id)}">确认入库</button>`:''}`:''}<button class="btn" data-action="close">关闭</button></div>`);
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
 showDialog(dialogHead('筛选导出','按所选条件导出 CSV，可用 Excel 打开。日期按报价日或原文发布日期筛选。')+`<form id="export-form"><div class="form-body"><p class="form-error" role="alert"></p><div class="form-grid">${field('数据类型',`<select name="type" aria-label="导出数据类型">${options([['quotes','供货报价'],['leads','自动采集线索']],initialType)}</select>`)}${field('品类',`<select name="category" aria-label="导出品类">${options(leadCategories(),state.leadCategory,'全部品类')}</select>`)}<div class="full" id="export-quote-filters"><div class="form-grid">${field('产品 / 规格','<select name="product" aria-label="导出产品规格"></select>')}${field('省份',`<select name="province" aria-label="导出省份">${options(provinces,'','全部省份')}</select>`)}${field('审核状态',`<select name="status" aria-label="导出审核状态">${options(Object.entries(statuses),'','全部状态')}</select>`)}${field('报价来源',`<select name="source" aria-label="导出报价来源">${options([['manual','人工询价'],['engine','引擎采集']],'','全部来源')}</select>`)}</div></div>${field('开始日期','<input name="from" aria-label="导出开始日期" type="date">')}${field('结束日期','<input name="to" aria-label="导出结束日期" type="date">')}<p class="subtle full" id="export-count" role="status"></p></div></div><div class="dialog-foot"><button class="btn" type="button" data-action="close">取消</button><button class="btn primary" type="submit">导出 CSV</button></div></form>`);
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
  // 出处只对管理员导出，其他角色导出的 CSV 不含来源名称与源网址。
  const showOrigin=admin();
  const base=['品类','产品','状态','规格','供应商','省份','城市','供货价（元/kg）','报价口径','运费（元/kg）','起订量','报价日期','有效至'];
  header=showOrigin?[...base,'来源方式','来源名称','原始链接','审核状态','备注']:[...base,'审核状态','备注'];
  rows=records.map(q=>{const p=product(q.product_id);const core=[p?.category,p?.name,p?.state,p?.spec,q.supplier,q.province,q.city,q.price,bases[q.basis],q.freight,q.min_order,q.quoted_on,q.valid_until];return showOrigin?[...core,q.source==='engine'?'引擎采集':'人工询价',q.source_name,q.source_url,statuses[q.status],q.notes]:[...core,statuses[q.status],q.notes];});
 }
 download('\uFEFF'+[header,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n'),`行情跳动-${fields.type==='leads'?'采集线索':'供货报价'}-${fields.category||'全部品类'}-${dayString()}.csv`);
 dialog.close();toast(`已导出 ${records.length} 条记录`);
}
function exportData() {
 let rows,header;
 if(state.page==='settings' && state.settingsView==='sources') {
  header=['来源','类型','标题','原始标价','地区','原文日期','链接','处理状态'];
  rows=(data.leads||[]).filter(l=>!HANDLED_LEADS.has(l.status)&&(!state.leadKind||l.kind===state.leadKind)&&matchesLeadUse(l)&&matchesLeadCategory(l,state.leadCategory)).map(l=>[l.source_name,sourceKinds[l.kind],l.title,l.price_text,l.region_text,l.published_on,l.url,l.status]);
 } else {
  // 2026-11-28：采购比价并入总览后，导出就是页面上看到的供货明细（当前筛选、全量、不受分页限制），
  // 不再导出已被删掉的「产品参考均价」汇总。
  const showOrigin=admin();
  const base=['品类','产品','状态','规格','供应商','省份','城市','供货价（元/kg）','报价口径','运费（元/kg）','起订量','报价日期','有效至'];
  header=showOrigin?[...base,'来源','原始链接','审核状态','备注']:[...base,'审核状态','备注'];
  const quotes=state.page==='settings'?(state.settingsView==='review'?data.quotes.filter(q=>q.status===state.reviewStatus):data.quotes):comparisonRows();
  rows=quotes.map(q=>{const p=product(q.product_id);const core=[p?.category,p?.name,p?.state,p?.spec,q.supplier,q.province,q.city,q.price,bases[q.basis],q.freight,q.min_order,q.quoted_on,q.valid_until];return showOrigin?[...core,q.source_name,q.source_url,statuses[q.status],q.notes]:[...core,statuses[q.status],safeNotes(q.notes)];});
 }
 download('\uFEFF'+[header,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n'),`行情跳动-${state.page==='overview'?'供货报价':state.page}-${dayString()}.csv`);
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
 if(el.dataset.settingsView) {state.pageNumber=1;location.hash=`settings/${el.dataset.settingsView}`;return;}
 if(el.dataset.category!==undefined){changeValue({category:el.dataset.category,product:''});return;}
 if(el.dataset.pick){const id=el.dataset.pick;state.product=id;state.category=product(id)?.category||'';state.pageNumber=1;render();return;}
 if(el.dataset.comparable){state.pageNumber=1;render();comparableDialog(el.dataset.comparable);return;}
 if(el.dataset.lead){quickConvertDialog(data.leads.find(l=>l.id===el.dataset.lead));return;}
 if(el.dataset.quickEdit){quoteForm(null,data.leads.find(l=>l.id===el.dataset.quickEdit));return;}
 if(el.dataset.quickConfirm){execute(async()=>{
  const lead=data.leads.find(l=>l.id===el.dataset.quickConfirm);
  if(!lead)throw new Error('线索不存在');
  const q=buildQuickQuote(lead,data.products);
  if(!q.ok)throw new Error(q.reasons.join('；'));
  // 有效期必须由录入人当场填写，系统不再代填默认天数。
  // 有效期由录入人当场选月数（1/2/3 个月），到期日按报价日自动推算。
  const months=Number(document.querySelector('#quick-valid-months')?.value)||0;
  if(!months){document.querySelector('#quick-valid-months')?.focus();throw new Error('请先选择这条报价的有效期（1 / 2 / 3 个月）');}
  const until=addMonths(q.quote.quoted_on,months);
  const quote={...q.quote,valid_until:until,id:crypto.randomUUID()};
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
 if(el.dataset.deleteProduct){
  const pid=el.dataset.deleteProduct;
  const used=(data.quotes||[]).filter(q=>q.product_id===pid&&!q.deleted_at).length;
  if(used){toast(`该规格还有 ${used} 条报价，请先删除这些报价`);return;}
  const p=(data.products||[]).find(x=>x.id===pid);
  if(globalThis.confirm&&!globalThis.confirm(`删除「${p?p.name+' '+p.spec:'该产品'}」？`))return;
  execute(async()=>{if(!admin())throw new Error('需要管理员权限');data=await store.deleteProduct(pid);render();toast('产品已删除');},el);
  return;
 }
 if(el.dataset.restoreLead){execute(async()=>{if(!admin())throw new Error('需要管理员权限');data=await store.setLeadStatus(el.dataset.restoreLead,'pending');render();managedLeadsDialog();toast('已恢复为待审线索');},el);return;}
 if(el.dataset.catRename){categoryRenameDialog(el.dataset.catRename);return;}
 if(el.dataset.catDelete){categoryDeleteDialog(el.dataset.catDelete);return;}
 if(el.dataset.catDisable){execute(async()=>{if(!admin())throw new Error('需要管理员权限');data=await store.toggleCategory(el.dataset.catDisable,true);render();categoryDialog();toast('品类已停用，可在管理里恢复');},el);return;}
 if(el.dataset.catRestore){execute(async()=>{if(!admin())throw new Error('需要管理员权限');data=await store.restoreCategory(el.dataset.catRestore);render();categoryDialog();toast('品类已恢复');},el);return;}
 if(el.dataset.catDeleteConfirm){execute(async()=>{if(!admin())throw new Error('需要管理员权限');data=await store.deleteCategory(el.dataset.catDeleteConfirm);render();categoryDialog();toast('品类已删除，可在管理里恢复');},el);return;}
 if(el.dataset.leadKind!==undefined){changeValue({leadKind:el.dataset.leadKind});return;}
 if(el.dataset.leadSort!==undefined){
  // 点当前列翻方向；点另一列按其默认方向起步（标题 A→Z、标价低→高）。
  // 「地区 / 发布日期」一列三态循环：日期新→旧 → 日期旧→新 → 地区拼音。
  const col=['title','price','date'].includes(el.dataset.leadSort)?el.dataset.leadSort:'date';
  const [curField,curOrder]=state.leadSort.split('_');
  if(col==='date') changeValue({leadSort:state.leadSort==='date_desc'?'date_asc':state.leadSort==='date_asc'?'region_asc':'date_desc'});
  else changeValue({leadSort:curField===col?`${col}_${curOrder==='asc'?'desc':'asc'}`:`${col}_asc`});
  return;
 }
 if(el.dataset.sortPrice!==undefined){
  // 点一次按从低到高，再点一次翻成从高到低；若当前按日期排，则先切回价格升序。
  if(state.sort==='price')changeValue({sortDir:state.sortDir==='asc'?'desc':'asc'});
  else changeValue({sort:'price',sortDir:'asc'});
  return;
 }
 if(el.dataset.detail){quoteDetail(el.dataset.detail);return;}
 if(el.dataset.edit){quoteForm(data.quotes.find(q=>q.id===el.dataset.edit));return;}
 if(el.dataset.reviewStatus){changeValue({reviewStatus:el.dataset.reviewStatus});return;}
 if(el.dataset.pagination){state.pageNumber+=Number(el.dataset.pagination);render();return;}
 if(el.dataset.review){execute(async()=>{if(!admin())throw new Error('需要管理员权限');await store.review(el.dataset.id,el.dataset.review);data=await store.reload();dialog.close();render();toast(el.dataset.review==='approved'?'已确认入库；有效报价将参与均价':el.dataset.review==='pending'?'已退回待确认':'已忽略，报价不参与均价');},el);return;}
 const action=el.dataset.action;
 if(action==='close')dialog.close();
 if(action==='add')quoteForm();
 if(action==='add-product')productForm();
 if(action==='managed-leads')managedLeadsDialog();
 if(action==='manage-categories')categoryDialog();
 if(action==='import-backup')document.querySelector('#import-backup-file')?.click();
 if(action==='export'){if(state.page==='settings')exportForm();else exportData();}
 if(action==='backup')download(store.backup(),`行情跳动-完整备份-${dayString()}.json`,'application/json');
 if(action==='account')accountDialog();
 if(action==='lock-access')execute(async()=>{settingsAccess.lock();accessGate.lock();if(store.cloud)await store.logout();dialog.close();accessPage();toast('已退出访问，需重新输入密码');},el);
 if(action==='reset-filters')changeValue({category:'',product:'',province:'',source:'',search:'',basis:'factory',days:7,sort:'price',sortDir:'asc'});
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
 if(filter==='leadCategory'){state.leadKind='';state.page='settings';state.settingsView='sources';location.hash='settings';}
 if(filter==='leadUse'){changeValue({leadUse:event.target.value});return;}
 if(filter==='sort'){changeValue({sort:event.target.value,sortDir:event.target.value==='date'?'desc':'asc'});return;}
 if(filter)changeValue(filter==='category'?{category:event.target.value,product:''}:{[filter]:['days','leadRange'].includes(filter)?Number(event.target.value):event.target.value});
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
   // 运费可按摩元/吨录入，入库前统一折算成元/kg，历史与统计口径不变。
   const freight=normalizeFreight(fields.freight,fields.freight_unit);
   // 有效期按整月推算：到期日 = 报价日 + 1/2/3 个月；「保持原到期日」沿用旧值。
   const validUntil=fields.valid_months==='keep'?(old?.valid_until||''):addMonths(fields.quoted_on,Number(fields.valid_months)||1);
   if(!validUntil)throw new Error('请选择这条报价的有效期');
   const phone=String(fields.contact_mobile||'').replace(/[\s-]/g,'');
   if(phone&&!/^(?:\+86)?1[3-9]\d{9}$/.test(phone))throw new Error('请填写有效的手机号码');
   delete fields.contact_mobile;
   fields.notes=[withoutQuoteMobile(fields.notes),phone?'联系手机：'+phone:''].filter(Boolean).join('\n');
   const quote={...old,...fields,valid_until:validUntil,id:old?.id||crypto.randomUUID(),price:normalizePrice(fields.price,fields.unit),freight,supplier:fields.supplier.trim(),status:admin()?fields.status:'pending',created_at:old?.created_at||new Date().toISOString()};
   delete quote.unit;
   delete quote.freight_unit;
   delete quote.valid_months;
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
function loginPage(error='') {app.innerHTML=`<main class="login"><img src="./favicon.svg" width="40" height="40" alt="行情跳动"><h1>验证数据库口令</h1><p>首次在这台设备打开，或登录状态已过期。<br>口令由你自己保管，网页不保存、不缓存。</p><form id="login-form"><p class="form-error" role="alert">${esc(error)}</p><div class="field"><label for="password">数据库口令</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus></div><button class="btn primary" type="submit">验证并进入</button></form><small class="access-tip">验证通过后本设备会记住登录状态，之后只输访问密码即可。</small><p class="net-hint" hidden></p></main>`;
 // 静默探一次数据库是否可达：手机网络连不上 supabase.co 时，
 // 以前只能反复试密码，看不出是网络问题。这里直接说清楚。
 setTimeout(async()=>{try{if(typeof window==='undefined')return;const hint=app.querySelector?.('.net-hint');if(!hint)return;if(await probeCloud()==='fail'){hint.hidden=false;hint.textContent='当前网络连不到云端数据库（supabase.co）。这不是口令问题——请切换 Wi-Fi 或移动网络后重试。';}}catch{}},80);}
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

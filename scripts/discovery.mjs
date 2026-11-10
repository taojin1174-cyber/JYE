import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { dayString } from '../src/core.js';

const ENTITIES={'&nbsp;':' ','&#160;':' ','&amp;':'&','&quot;':'"','&#39;':"'",'&lt;':'<','&gt;':'>','&ge;':'≥','&le;':'≤','&plusmn;':'±','&mdash;':'—','&hellip;':'…','&ldquo;':'“','&rdquo;':'”','&middot;':'·'};
const clean=value=>String(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').replace(/&(?:#160|nbsp|amp|quot|#39|lt|gt|ge|le|plusmn|mdash|hellip|ldquo|rdquo|middot);/gi,m=>ENTITIES[m.toLowerCase()]??' ').replace(/\s+/g,' ').trim();
const attr=(html,key)=>html.match(new RegExp(`\\b${key}\\s*=\\s*["']([^"']*)["']`,'i'))?.[1];
const dateIn=value=>String(value).match(/20\d{2}[-/]\d{2}[-/]\d{2}/)?.[0]?.replaceAll('/','-')||null;
const inferCategory=title=>['猪','鸡','鸭','鹅','羊','牛'].find(c=>title.includes(c))||'';

// ---- 报价单位与折算：苗价按只/羽计价，不与毛禽混算 ----
const UNITS=new Set(['元/公斤','元/斤','元/只','元/羽','元/吨']);
const normUnit=value=>String(value||'').replace(/\s+/g,'').replace('千克','公斤');
const round=(n,digits=2)=>Math.round(n*10**digits)/10**digits;
const toKg=(value,unit)=>unit==='元/斤'?round(value*2):unit==='元/公斤'?round(value):unit==='元/吨'?round(value/1000,3):null;
const isUnitCell=value=>UNITS.has(normUnit(value));

function parseRange(text){
 const numbers=[...String(text).matchAll(/\d+(?:\.\d+)?/g)].map(m=>Number(m[0])).filter(n=>n>0);
 if(!numbers.length)return null;
 const low=Math.min(...numbers), high=Math.max(...numbers);
 if(numbers.length===1)return {low,high:/以上|≥|起/.test(text)?null:low};
 return {low,high};
}
function stageOf({unit,name='',group=''}){
 if(/苗/.test(name+group))return '苗';
 if(unit==='元/羽'||unit==='元/只')return /鸽/.test(name+group)?'整只':'苗';
 if(unit==='元/斤')return '毛禽';
 if(unit==='元/公斤'||unit==='元/吨')return '白条/分割';
 return '';
}

// 解析禽网行情正文表格：按“段落标题（品种+单位）”逐行取省区报价
function parsePriceTables(html){
 const rows=[];
 for(const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)){
  const trs=[...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
   .map(tr=>[...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell=>clean(cell[1])))
   .filter(cells=>cells.length&&cells.some(Boolean));
  if(!trs.length)continue;
  const head=trs[0].map(cell=>cell.replace(/\s+/g,''));
  if(head[0]==='地区'&&head[1]==='市场'){rows.push(...parseWholesaleTable(trs));continue;}
  rows.push(...parseSectionTable(trs));
 }
 return rows;
}
// 白条鸡批发市场表：地区 / 市场 / 当日 / 前一日 / 环比，单位固定元/公斤
function parseWholesaleTable(trs){
 const out=[];
 for(const cells of trs.slice(1)){
  if(cells.length<3)continue;
  const price=parseRange(cells[2]); if(!price)continue;
  const region=cells[0].replace(/(省|市|自治区)$/,'');
  const marketName=cells[1];
  if(!marketName)continue;
  const market={breed:'白条鸡',region,market:marketName,spec:'白条鸡批发',unit:'元/公斤',stage:'白条/分割',price_low:price.low,price_high:price.high??price.low,price_mid:round((price.low+(price.high??price.low))/2),unit_norm:'元/公斤',price_norm_mid:round((price.low+(price.high??price.low))/2),previous:parseRange(cells[3])?.low??null};
  out.push({title:`白条鸡 ${region} ${marketName}`,price_text:`${price.low}${price.high&&price.high!==price.low?`-${price.high}`:''} 元/公斤`,region_text:region,category:'鸡',market,details:`原文：白条鸡批发价，单位元/公斤；前一日 ${market.previous??'未列'}。批发市场报价含规格差异，请打开原文核对。`});
 }
 return out;
}
// 通用分段表：分段行形如 [品种, 单位, 涨跌]，数据行形如 [省区, 价格, 涨跌] 或 [省区, 规格, 价格, 涨跌]
const REGION_HINT=/省|市|自治区|北京|天津|河北|山西|内蒙|辽宁|吉林|黑龙江|上海|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|广西|海南|重庆|四川|贵州|云南|西藏|陕西|甘肃|青海|宁夏|新疆|川渝|粤东|粤中|粤西|鲁苏豫|陕甘宁|东北|华北|华南|华东|华中|西南|西北|到户/;
const SPEC_TOKEN=/^(胴体|活禽|水鸭|旱鸭|棚前|冻品|通货|统货|大规格|小规格|公|母)$/;
function parseSectionTable(trs){
 const out=[];
 let group='',breed='',unit='',lastRegion='';
 for(const row of trs){
  if(row.length===1){
   const text=row[0];
   if(!text||/^备注|^说明|^注[:：]|^数据来源|^单位/.test(text))continue;
   // 形如“安徽/山东/河南”的合并单元格是缺价行的占位，不代表新品种段，跳过但保留当前段状态。
   if(/[/／]/.test(text)&&!/[（(]/.test(text))continue;
   group=text.replace(/[（(][^）)]*[）)]/g,'').trim()||text;breed='';unit='';continue;
  }
  if(isUnitCell(row[1])){breed=row[0];unit=normUnit(row[1]);continue;}
  if(!unit)continue;
  const cells=row.slice();
  const last=cells.at(-1);
  if(cells.length>2&&(/^[+\-±]\d/.test(last)||last===''||/^(持平|上涨|下跌)/.test(last)))cells.pop();
  let spec='',priceText='',label='';
  if(cells.length>=3){label=cells[0];spec=cells[1];priceText=cells[2];}
  else if(cells.length===2){label=cells[0];priceText=cells[1];}
  else{
   const parts=cells[0].split(/[：:]/);
   if(parts.length===2){spec=parts[0].trim();priceText=parts[1].trim();}
   else priceText=cells[0];
  }
  const price=parseRange(priceText); if(!price)continue;
  let region=label,suffix='';
  const colon=label.match(/^(.+?)[：:](.+)$/);
  if(colon){region=colon[1].trim();suffix=colon[2].trim();}
  region=region.replace(/\s+/g,'');
  // “胴体”“活禽”“旱鸭”是规格而非产区，沿用上一行的省区，避免把规格当成地区。
  if(region&&lastRegion&&(SPEC_TOKEN.test(region)||(region.length<=3&&!REGION_HINT.test(region)))){
   spec=[region,spec].filter(Boolean).join(' ');region=lastRegion;
  } else if(region&&REGION_HINT.test(region)) lastRegion=region;
  const breedLabel=[group,breed].filter(Boolean).join('·');
  const category=inferCategory(`${group}${breed}`)||inferCategory(region);
  if(!category)continue;
  const stage=stageOf({unit,name:breed,group});
  const mid=price.high==null?price.low:round((price.low+price.high)/2);
  const specText=[spec,suffix].filter(Boolean).join(' ');
  const market={breed:breedLabel,region,spec:specText,unit,stage,price_low:price.low,price_high:price.high,price_mid:mid,unit_norm:'元/公斤',price_norm_mid:toKg(mid,unit),price_norm_low:toKg(price.low,unit),price_norm_high:price.high==null?null:toKg(price.high,unit)};
  out.push({title:`${breedLabel||'行情'} ${region}${specText?` ${specText}`:''}`.trim(),price_text:`${price.low}${price.high!=null&&price.high!==price.low?`-${price.high}`:`${/以上/.test(priceText)?' 以上':''}`} ${unit}`,region_text:region,category,market,details:`原文：${breedLabel}${suffix?`（${suffix}）`:''}，${region}，单位${unit}。${market.stage==='苗'?'苗价按只/羽计价，不折算为元/公斤。':'规格与成交条件以原文为准。'}`});
 }
 return out;
}
// 石兴鹅/鸡/鸽日报：正文为<div id="article">下的逐行文本，按“鹅/鸡/鸽”分组
function parseDailyOffer(html){
 const block=html.match(/<div[^>]*id=["']article["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]||html;
 const paragraphs=[...block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m=>clean(m[1])).filter(Boolean);
 const out=[];
 let category='';
 for(const text of paragraphs){
  if(/^(鹅|鸡|鸭|鸽|猪)$/.test(text)){category=text;continue;}
  if(/^备注|^说明/.test(text))continue;
  const matched=text.match(/^(.+?)[（(]\s*元\s*\/\s*(斤|只|公斤|千克|羽)\s*[）)]\s*(.+)$/);
  if(!matched)continue;
  const name=matched[1].replace(/\s+/g,'').replace(/价$/,'');
  const unit=normUnit(`元/${matched[2]}`);
  const price=parseRange(matched[3]); if(!price)continue;
  const kind=category||inferCategory(name);
  if(!kind)continue;
  const region=name.match(/^(清远|高要|江门|阳江|白沙|惠州|粤东|粤中|粤西|广西|广东|福建|川渝|江苏|安徽|山东)/)?.[1]||'';
  const stage=stageOf({unit,name});
  const mid=price.high==null?price.low:round((price.low+price.high)/2);
  const market={breed:name,region,spec:'',unit,stage,price_low:price.low,price_high:price.high,price_mid:mid,unit_norm:'元/公斤',price_norm_mid:toKg(mid,unit),price_norm_low:toKg(price.low,unit),price_norm_high:price.high==null?null:toKg(price.high,unit)};
  out.push({title:`${kind}·${name}`,price_text:`${price.low}${price.high!=null&&price.high!==price.low?`-${price.high}`:`${/以上/.test(matched[3])?' 以上':''}`} ${unit}`,region_text:region||'原文范围',category:kind,market,details:`原文：${name}（${unit}）${matched[3]}。${stage==='苗'?'苗价按只计价，不折算为元/公斤。':'日龄与出栏规格见原文备注。'}`});
 }
 return out;
}

export function parseDiscovery(html,source) {
 const records=[];
 const published_on=dateIn(html.match(/<h1[^>]*id=["']title["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1])||dateIn(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1])||null;
 if(source.adapter==='cnfowl-price'||source.adapter==='cnfowl-offer') {
  const rows=source.adapter==='cnfowl-price'?parsePriceTables(html):parseDailyOffer(html);
  for(const row of rows)records.push({...row,published_on:row.published_on||published_on,url:source.url});
 } else if(source.adapter==='roujiaosuo') {
  for(const match of html.matchAll(/<dl\b[^>]*>([\s\S]*?)<\/dl>/gi)) {
   const fields=new Map([...match[1].matchAll(/<dd\b[^>]*class=["']w(\d+)["'][^>]*>([\s\S]*?)<\/dd>/gi)].map(m=>[Number(m[1]),m[2]]));
   if(!fields.has(1)||!fields.has(7))continue;
   const title=clean(fields.get(1)); const url=attr(fields.get(1),'href'); const date=dateIn(clean(fields.get(7)));
   if(!url||!/^https:\/\/www\.roujiaosuo\.com\/sell\/show\/\d+\/$/.test(url)||!date||!inferCategory(title))continue;
   const price_text=clean(fields.get(4)||'');
   if(!/^\d+(?:\.\d+)?\s*元\s*\/\s*(?:公斤|千克|斤|吨)$/.test(price_text))continue;
   records.push({title,url,published_on:date,price_text,region_text:clean(fields.get(6)||''),category:inferCategory(title),details:`原文产地：${clean(fields.get(3)||'未注明')}；原文货量：${clean(fields.get(5)||'未注明')}（不是起订量）；税费、运费、规格及供应商待核实。`});
  }
 } else if(['cnfowl','nahs'].includes(source.adapter)) {
  for(const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
   const href=attr(m[1],'href');if(!href)continue;
   const url=new URL(href,source.url).href;
   if(source.adapter==='cnfowl'&&!/^https:\/\/www\.cnfowl\.com\/quote\/show-\d+\.html$/.test(url))continue;
   if(source.adapter==='nahs'&&!/^https:\/\/www\.nahs\.org\.cn\/jcyj\/jghq\/\d+\/t\d+_\d+\.htm$/.test(url))continue;
   const title=clean(attr(m[1],'title')||m[2]);if(!title||source.adapter==='cnfowl'&&!/[鸡鸭鹅猪羊牛禽]/.test(title))continue;
   let date=dateIn(title);
   if(!date&&source.adapter==='nahs'){const parts=url.match(/t(20\d{2})(\d{2})(\d{2})_/);if(parts)date=`${parts[1]}-${parts[2]}-${parts[3]}`;}
   records.push({title,url,published_on:date,price_text:'',region_text:'',category:inferCategory(title),details:source.kind==='macro'?'官方监测原文；发布日期与行情采样日可能不同，请打开原文核对。':'行情标题线索；原文可能涉及毛禽、批发均价或禽苗，不计入供货均价。'});
  }
 } else throw new Error('未知公开页面适配器');
 const keyOf=row=>row.market?`${row.url}|${row.title}|${row.price_text}`:row.url;
 const unique=[...new Map(records.map(r=>[keyOf(r),r])).values()].filter(r=>!r.published_on||r.published_on<=dayString());
 if(!unique.length)throw new Error('没有解析到有效记录，页面结构可能变化；未生成报价');
 return unique.slice(0,source.limit||30).map(r=>({...r,id:createHash('sha256').update(r.market?`${source.id}|${r.url}|${r.title}|${r.price_text}`:`${source.id}|${r.url}|${r.published_on}|${r.price_text}`).digest('hex'),source_id:source.id,source_name:source.name,kind:source.kind,status:'pending',fetched_at:new Date().toISOString()}));
}

async function getHTML(url) {
 const response=await fetch(url,{headers:{'User-Agent':'HangqingTiaodong/0.1 (+public-market-reference)',Accept:'text/html,application/xhtml+xml'},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error(`HTTP ${response.status}`);
 const html=await response.text();if(html.length>3_000_000)throw new Error('页面过大');return html;
}
// 日报类来源每天生成新文章，因此先读栏目列表，按标题匹配取当天最新一篇，再抓正文。
function findArticleLink(listHtml,source){
 const pattern=new RegExp(source.match||'.');
 for(const m of listHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){
  const href=attr(m[1],'href');if(!href)continue;
  let url;try{url=new URL(href,source.listUrl).href;}catch{continue;}
  if(!/^https:\/\/www\.cnfowl\.com\/(quote|offer)\/show-\d+\.html$/.test(url))continue;
  if(pattern.test(clean(attr(m[1],'title')||m[2])))return url;
 }
 return '';
}
async function loadSourceHTML(source){
 if(!source.listUrl)return {html:await getHTML(source.url),url:source.url};
 const listHtml=await getHTML(source.listUrl);
 const article=findArticleLink(listHtml,source);
 if(!article)throw new Error(`列表页未找到“${source.match||source.name}”文章`);
 return {html:await getHTML(article),url:article};
}
export async function discover({cacheDir='',persistCloud=false}={}) {
 const {sources}=JSON.parse(await readFile(new URL('../collector/web-sources.json',import.meta.url),'utf8'));
 const items=[],runs=[];let errors=0;
 for(const source of sources.filter(s=>s.enabled)) {
  try {
   const {html,url}=cacheDir?{html:await readFile(`${cacheDir}/${source.id}.html`,'utf8'),url:source.url}:await loadSourceHTML(source);
   const parsed=parseDiscovery(html,{...source,url});items.push(...parsed);runs.push({source_id:source.id,ok:true,count:parsed.length});
   console.log(`${source.id}: ${parsed.length} 条公开线索（未进入供货均价）`);
  }catch(e){errors++;runs.push({source_id:source.id,ok:false,error:e.message});console.error(`${source.id}: ${e.message}`);}
 }
 // 仅发布短标题、链接和明确标价等公开事实，不保存商户联系方式或全文。
 // 某个来源暂时失败时，保留上次该来源的线索，并标记本次失败。
 let previous=[];try{previous=JSON.parse(await readFile(new URL('../data/discovery.json',import.meta.url),'utf8')).items||[];}catch{}
 const failed=new Set(runs.filter(r=>!r.ok).map(r=>r.source_id));
 const merged=[...items,...previous.filter(i=>failed.has(i.source_id))];
 if(!merged.length&&errors)throw new Error('全部来源失败，保留旧快照');
 await mkdir(new URL('../data/',import.meta.url),{recursive:true});
 await writeFile(new URL('../data/discovery.json',import.meta.url),JSON.stringify({fetched_at:new Date().toISOString(),runs,items:merged},null,2)+'\n');
 if(persistCloud&&process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY&&items.length) {
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response=await fetch(process.env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/collection_items?on_conflict=id',{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates'},body:JSON.stringify(items),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`线索写入数据库失败 (${response.status})`);
 }
 return {count:merged.length,errors};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const cacheIndex=process.argv.indexOf('--from-cache');
 discover({cacheDir:cacheIndex>=0?process.argv[cacheIndex+1]:'',persistCloud:process.argv.includes('--cloud')}).then(r=>{if(r.errors)process.exitCode=1;}).catch(e=>{console.error(e.message);process.exitCode=1;});
}

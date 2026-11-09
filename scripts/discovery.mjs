import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { dayString } from '../src/core.js';
const clean=value=>value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/g,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/\s+/g,' ').trim();
const attr=(html,key)=>html.match(new RegExp(`\\b${key}\\s*=\\s*["']([^"']*)["']`,'i'))?.[1];
const dateIn=value=>value.match(/20\d{2}[-/]\d{2}[-/]\d{2}/)?.[0]?.replaceAll('/','-')||null;
const inferCategory=title=>['猪','鸡','鸭','鹅','羊','牛'].find(c=>title.includes(c))||'';
export function parseDiscovery(html,source) {
 const records=[];
 if(source.adapter==='roujiaosuo') {
  for(const match of html.matchAll(/<dl\b[^>]*>([\s\S]*?)<\/dl>/gi)) {
   const fields=new Map([...match[1].matchAll(/<dd\b[^>]*class=["']w(\d+)["'][^>]*>([\s\S]*?)<\/dd>/gi)].map(m=>[Number(m[1]),m[2]]));
   if(!fields.has(1)||!fields.has(7))continue;
   const title=clean(fields.get(1)); const url=attr(fields.get(1),'href'); const published_on=dateIn(clean(fields.get(7)));
   if(!url||!/^https:\/\/www\.roujiaosuo\.com\/sell\/show\/\d+\/$/.test(url)||!published_on||!inferCategory(title))continue;
   const price_text=clean(fields.get(4)||'');
   if(!/^\d+(?:\.\d+)?\s*元\s*\/\s*(?:公斤|千克|斤|吨)$/.test(price_text))continue;
   records.push({title,url,published_on,price_text,region_text:clean(fields.get(6)||''),category:inferCategory(title),details:`原文产地：${clean(fields.get(3)||'未注明')}；原文货量：${clean(fields.get(5)||'未注明')}（不是起订量）；税费、运费、规格及供应商待核实。`});
  }
 } else if(['cnfowl','nahs'].includes(source.adapter)) {
  for(const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
   const href=attr(m[1],'href');if(!href)continue;
   const url=new URL(href,source.url).href;
   if(source.adapter==='cnfowl'&&!/^https:\/\/www\.cnfowl\.com\/quote\/show-\d+\.html$/.test(url))continue;
   if(source.adapter==='nahs'&&!/^https:\/\/www\.nahs\.org\.cn\/jcyj\/jghq\/\d+\/t\d+_\d+\.htm$/.test(url))continue;
   const title=clean(attr(m[1],'title')||m[2]);if(!title||source.adapter==='cnfowl'&&!/[鸡鸭鹅猪羊牛禽]/.test(title))continue;
   let published_on=dateIn(title);
   if(!published_on&&source.adapter==='nahs'){const date=url.match(/t(20\d{2})(\d{2})(\d{2})_/);if(date)published_on=`${date[1]}-${date[2]}-${date[3]}`;}
   records.push({title,url,published_on,price_text:'',region_text:'',category:inferCategory(title),details:source.kind==='macro'?'官方监测原文；发布日期与行情采样日可能不同，请打开原文核对。':'行情标题线索；原文可能涉及毛禽、批发均价或禽苗，不计入供货均价。'});
  }
 } else throw new Error('未知公开页面适配器');
 const unique=[...new Map(records.map(r=>[r.url,r])).values()].filter(r=>!r.published_on||r.published_on<=dayString());
 if(!unique.length)throw new Error('没有解析到有效记录，页面结构可能变化；未生成报价');
 return unique.slice(0,source.limit||30).map(r=>({...r,id:createHash('sha256').update(`${source.id}|${r.url}|${r.published_on}|${r.price_text}`).digest('hex'),source_id:source.id,source_name:source.name,kind:source.kind,status:'pending',fetched_at:new Date().toISOString()}));
}
async function getHTML(url) {
 const response=await fetch(url,{headers:{'User-Agent':'HangqingTiaodong/0.1 (+public-market-reference)'},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error(`HTTP ${response.status}`);
 const html=await response.text();if(html.length>3_000_000)throw new Error('页面过大');return html;
}
export async function discover({cacheDir='',persistCloud=false}={}) {
 const {sources}=JSON.parse(await readFile(new URL('../collector/web-sources.json',import.meta.url),'utf8'));
 const items=[],runs=[];let errors=0;
 for(const source of sources.filter(s=>s.enabled)) {
  try {
   const html=cacheDir?await readFile(`${cacheDir}/${source.id}.html`,'utf8'):await getHTML(source.url);
   const parsed=parseDiscovery(html,source);items.push(...parsed);runs.push({source_id:source.id,ok:true,count:parsed.length});
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

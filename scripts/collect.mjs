import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { normalizePrice, validateQuote } from '../src/core.js';

export function parseCSV(text) {
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') {if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v!==''))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw new Error('CSV 引号未闭合');
  if(cell||row.length){row.push(cell);rows.push(row);}
  const header=rows.shift()?.map(s=>s.replace(/^\uFEFF/,''));
  if(!header||new Set(header).size!==header.length)throw new Error('CSV 表头为空或重复');
  return rows.map(row=>{if(row.length!==header.length)throw new Error('CSV 列数与表头不一致');return Object.fromEntries(header.map((key,i)=>[key,row[i]]));});
}
const at=(obj,path)=>path?path.split('.').reduce((v,k)=>v?.[k],obj):obj;
export function mapRecord(record,source,products) {
  const q={...source.defaults};
  for(const [key,path] of Object.entries(source.mapping||{})) {const value=at(record,path);if(value!=null&&value!=='')q[key]=value;}
  if(!q.quoted_on)throw new Error('真实来源必须提供报价日期，不使用采集日期代替');
  if(!q.valid_until)q.valid_until=q.quoted_on; // 未提供有效期时只认为当日有效。
  q.price=normalizePrice(q.price,q.unit||'kg');
  if(q.freight!==undefined&&q.freight!==null&&q.freight!=='')q.freight=Number(q.freight);else q.freight=null;
  const allowed=['product_id','supplier','province','city','price','basis','quoted_on','valid_until','freight','min_order','notes','source_url'];
  const body=Object.fromEntries(allowed.filter(k=>q[k]!==undefined).map(k=>[k,q[k]]));
  body.supplier=String(body.supplier||'').trim();body.city=String(body.city||'');
  body.source='engine';body.source_name=source.name;body.status='pending';
  const identity=[source.id,q.external_id||q.supplier,q.product_id,q.province,q.basis,q.quoted_on,q.price];
  body.collector_key=createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return validateQuote(body,products);
}
export async function main() {
  const {sources}=JSON.parse(await readFile(new URL('../collector/sources.json',import.meta.url),'utf8'));
  const enabled=sources.filter(s=>s.enabled);
  if(!enabled.length){console.log('尚未配置真实采集源；未生成任何报价。');return;}
  const endpoint=process.env.SUPABASE_URL?.replace(/\/$/,'');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!endpoint||!key)throw new Error('请配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY GitHub Secrets');
  const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
  const productResponse=await fetch(`${endpoint}/rest/v1/products?select=*`,{headers,signal:AbortSignal.timeout(30000)});
  if(!productResponse.ok)throw new Error(`读取产品库失败 (${productResponse.status})`);
  const products=await productResponse.json();let failures=0;
  for(const source of enabled) {
    try {
      if(!source.id||!source.name||!/^https:\/\//.test(source.url))throw new Error('来源需要 id、name 及 HTTPS URL');
      const feedHeaders=source.headersEnv?JSON.parse(process.env[source.headersEnv]||'{}'):{};
      const response=await fetch(source.url,{headers:feedHeaders,signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw new Error(`来源请求失败 (${response.status})`);
      const text=await response.text();if(text.length>10_000_000)throw new Error('来源超过 10MB 限制');
      if(!['json','csv'].includes(source.format))throw new Error('来源格式仅支持 json/csv');
      const records=source.format==='csv'?parseCSV(text):at(JSON.parse(text),source.recordsPath);
      if(!Array.isArray(records)||records.length>10000)throw new Error('来源必须返回不超过 10000 条的数组');
      let valid=[];let rejected=0;
      for(const record of records)try{valid.push(mapRecord(record,source,products));}catch{rejected++;}
      valid=[...new Map(valid.map(q=>[q.collector_key,q])).values()];
      for(let i=0;i<valid.length;i+=200){
        const saved=await fetch(`${endpoint}/rest/v1/quotes?on_conflict=collector_key`,{method:'POST',headers:{...headers,Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(valid.slice(i,i+200)),signal:AbortSignal.timeout(30000)});
        if(!saved.ok)throw new Error(`写入待审核报价失败 (${saved.status})`);
      }
      console.log(`来源 ${source.id}：校验通过 ${valid.length} 条，跳过无效记录 ${rejected} 条。重复报价不重复插入。`);
      if(rejected)failures++;
    }catch(error){failures++;console.error(`来源 ${source.id}：${error.message}`);}
  }
  if(failures)throw new Error(`${failures} 个来源有失败或无效数据，请检查字段映射`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});

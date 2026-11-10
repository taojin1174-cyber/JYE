// 外部行情参考：只读展示公开行情页采集到的价格，不参与供货均价计算。
const ORDER=['鸡','鸭','鹅','猪','羊','牛'];
const STAGE_ORDER=['毛禽','白条/分割','整只','苗'];
const STAGE_LABEL={'毛禽':'毛禽','白条/分割':'白条','整只':'整只','苗':'苗价'};
const num=value=>(typeof value==='number'&&Number.isFinite(value)?value:null);
const round2=value=>Math.round(value*100)/100;
const median=values=>{
 if(!values.length)return null;
 const sorted=[...values].sort((a,b)=>a-b), mid=(sorted.length-1)/2, low=Math.floor(mid), high=Math.ceil(mid);
 return round2((sorted[low]+sorted[high])/2);
};
export const hasMarket=leads=>(leads||[]).some(lead=>lead&&lead.market&&typeof lead.market==='object');
export function marketRows(leads,category=''){
 return (leads||[]).filter(lead=>lead&&lead.market&&typeof lead.market==='object'&&(!category||lead.category===category));
}
// 按品类 → 计价阶段分组。毛禽、白条、苗价口径不同，绝不合并成一个均价。
export function marketSummary(leads){
 const groups=new Map();
 for(const row of marketRows(leads)) if(row.category) (groups.get(row.category)||groups.set(row.category,[]).get(row.category)).push(row);
 return [...groups.entries()].map(([category,items])=>{
  const byStage=new Map();
  for(const row of items){
   const stage=row.market.stage||'其他';
   if(!byStage.has(stage))byStage.set(stage,[]);
   byStage.get(stage).push(row);
  }
  const stages=[...byStage.entries()].map(([stage,rows])=>{
   const prices=rows.map(row=>num(row.market.price_norm_mid)).filter(value=>value!=null);
   const raw=rows.map(row=>num(row.market.price_mid)).filter(value=>value!=null);
   const units=[...new Set(rows.map(row=>row.market.unit).filter(Boolean))];
   return {stage,label:STAGE_LABEL[stage]||stage,count:rows.length,convertible:prices.length,median:median(prices),rawMedian:units.length===1?median(raw):null,unit:units.length===1?units[0]:'',min:prices.length?round2(Math.min(...prices)):null,max:prices.length?round2(Math.max(...prices)):null};
  }).sort((a,b)=>(STAGE_ORDER.indexOf(a.stage)+1||9)-(STAGE_ORDER.indexOf(b.stage)+1||9));
  const breeds=new Set(items.map(row=>row.market.breed).filter(Boolean));
  const latest=items.map(row=>row.published_on).filter(Boolean).sort().at(-1)||'';
  const primary=stages.find(stage=>stage.median!=null)||stages[0]||null;
  return {category,count:items.length,breedCount:breeds.size,stages,primary,latest};
 }).sort((a,b)=>{const ia=ORDER.indexOf(a.category),ib=ORDER.indexOf(b.category);return (ia<0?99:ia)-(ib<0?99:ib);});
}
// 每个品类挑几条代表价：优先可折算为元/公斤的行，同品种同地区只留一条。
export function marketHighlights(leads,{category='',limit=4,stage=''}={}){
 const rows=marketRows(leads,category).filter(row=>!stage||row.market.stage===stage);
 const ordered=[...rows.filter(row=>num(row.market.price_norm_mid)!=null),...rows.filter(row=>num(row.market.price_norm_mid)==null)];
 const picks=[],seenRow=new Set(),seenBreed=new Set();
 const take=row=>{
  const key=`${row.market.breed}|${row.market.region}|${row.market.spec}`;
  if(seenRow.has(key))return false;
  seenRow.add(key);picks.push(row);return true;
 };
 // 先保证品种分散，再补足条数，避免整列都是同一个品种的不同省区。
 for(const row of ordered){
  if(picks.length>=limit)break;
  const breed=row.market.breed||'';
  if(seenBreed.has(breed))continue;
  if(take(row))seenBreed.add(breed);
 }
 for(const row of ordered){
  if(picks.length>=limit)break;
  take(row);
 }
 return picks;
}
export const marketLabel=row=>{
 const market=row?.market||{};
 const breed=String(market.breed||'').replace(/[（(][^）)]*[）)]/g,'').replace(/·.*$/,'')||market.breed||'';
 return [breed,market.region].filter(Boolean).join(' ')||row?.title||'';
};
export function marketFreshness(leads){
 return marketRows(leads).map(row=>row.published_on).filter(Boolean).sort().at(-1)||'';
}

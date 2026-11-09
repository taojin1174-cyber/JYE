import { normalizePrice, provinces } from './core.js';

// 只带入原文已有事实；库存不是起订量，未标明的鲜冻及税运条件不推断。
export function leadPrefill(lead) {
  const title=String(lead.title||'');
  const region=String(lead.region_text||'');
  const province=lead.province||provinces.find(p=>region.startsWith(p))||'';
  const match=String(lead.price_text||'').match(/^(\d+(?:\.\d+)?)\s*元\s*\/\s*(公斤|千克|斤|吨)$/);
  const explicitState=lead.product_state||(['冻品','鲜品','活体','冷鲜'].includes(lead.state)?lead.state:'');
  const state=explicitState||(/冷鲜/.test(title)?'冷鲜':/冻/.test(title)?'冻品':/鲜/.test(title)?'鲜品':/活[鸡鸭鹅羊猪牛禽]/.test(title)?'活体':'');
  return {
    product:{category:lead.category||'',name:lead.product_name||title,state,spec:lead.spec||''},
    quote:{product_id:'',basis:'',supplier:lead.supplier||'',province,city:lead.city||(province?region.slice(province.length):''),price:match?normalizePrice(match[1],({'公斤':'kg','千克':'kg','斤':'jin','吨':'ton'})[match[2]]):'',source:'engine',source_name:lead.source_name||'',source_url:lead.url||'',quoted_on:lead.published_on||'',valid_until:lead.valid_until||'',status:'pending',min_order:lead.min_order||'',freight:'',notes:`原文产品：${title}；标价：${lead.price_text||''}；仓库地区：${region}。${lead.details||''}`},
  };
}

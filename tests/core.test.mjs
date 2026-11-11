import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrice,normalizeFreight,latestQuotes,summarize,trend,validateQuote,shiftDay,dayString,csvCell } from '../src/core.js';
import { parseCSV,mapRecord } from '../scripts/collect.mjs';
import { parseDiscovery } from '../scripts/discovery.mjs';
import { matchesLeadCategory } from '../src/core.js';
test('核价筛选跨来源包含多品类标题，未采集到的鹅信息不虚构',()=>{
 assert.equal(matchesLeadCategory({category:'鸡',title:'鸡鸭鹅价格参考'},'鹅'),true);
 assert.equal(matchesLeadCategory({category:'鹅',title:'今日供货'},'鹅'),true);
 assert.equal(matchesLeadCategory({category:'鸡',title:'鸡腿报价'},'鹅'),false);
});
const products=[{id:'a',category:'鸡'},{id:'b',category:'鸡'}];
const quote=(extra={})=>({id:'q',product_id:'a',supplier:'供应商甲',province:'山东',price:10,basis:'factory',source:'manual',status:'approved',quoted_on:'2026-11-09',valid_until:'2026-11-11',created_at:'2026-11-09T08:00:00Z',...extra});
const opts={productId:'a',day:'2026-11-09',days:7,basis:'factory'};
test('北京时间跨月、跨年及单位换算',()=>{
 assert.equal(dayString(new Date('2026-11-08T16:00:00Z')),'2026-11-09');
 assert.equal(shiftDay('2026-01-01',-1),'2025-12-31');
 assert.equal(shiftDay('2026-03-01',-1),'2026-02-28');
 assert.equal(normalizePrice(6.5,'jin'),13);
 assert.equal(normalizePrice(12000,'ton'),12);
 assert.throws(()=>normalizePrice(-1,'kg'));
 assert.throws(()=>normalizePrice('NaN','kg'));
});
test('运费可按吨录入，统一折算成元/kg',()=>{
 assert.equal(normalizeFreight('0.6','kg'),0.6);
 assert.equal(normalizeFreight(80,'ton'),0.08);
 assert.equal(normalizeFreight('950','ton'),0.95);
 assert.equal(normalizeFreight('','ton'),null);
 assert.equal(normalizeFreight(null),null);
 assert.throws(()=>normalizeFreight(-1,'kg'));
 assert.throws(()=>normalizeFreight('abc','kg'));
 assert.throws(()=>normalizeFreight(1,'jin'));
});
test('同规格同口径，只保留周期内最新有效供应商样本',()=>{
 const quotes=[quote(),quote({id:'old',price:50,quoted_on:'2026-11-08'}),quote({id:'pending',supplier:'待审',status:'pending'}),quote({id:'rejected',supplier:'拒绝',status:'rejected'}),quote({id:'expired',supplier:'过期',valid_until:'2026-11-08'}),quote({id:'future',supplier:'未来',quoted_on:'2026-11-10'}),quote({id:'different',supplier:'另一规格',product_id:'b'}),quote({id:'basis',supplier:'含运',basis:'delivered'}),quote({id:'old-period',supplier:'周期外',quoted_on:'2026-10-31',valid_until:'2026-11-15'})];
 assert.deepEqual(latestQuotes(quotes,opts).map(q=>q.id),['q']);
});
test('不同供应商和省份保留独立样本，筛选来源和地区',()=>{
 const quotes=[quote(),quote({id:'2',supplier:'供应商乙',province:'河南',price:14,source:'engine'}),quote({id:'3',province:'江苏',price:12})];
 const sample=latestQuotes(quotes,opts);assert.equal(sample.length,3);
 assert.deepEqual(summarize(sample),{count:3,average:12,median:12,min:10,max:14,provinceCount:3,sparse:true});
 assert.equal(latestQuotes(quotes,{...opts,province:'山东'}).length,1);
 assert.equal(latestQuotes(quotes,{...opts,source:'engine'})[0].id,'2');
 assert.equal(summarize([]).average,null);
});
test('同一天后补录的报价覆盖旧记录，日期优先于录入时间',()=>{
 const quotes=[quote(),quote({id:'new',price:11,created_at:'2026-11-09T09:00:00Z'}),quote({id:'backdated',price:3,quoted_on:'2026-11-08',created_at:'2026-11-10T09:00:00Z'})];
 assert.equal(latestQuotes(quotes,opts)[0].id,'new');
 assert.equal(latestQuotes([quote({created_at:'2026-11-09T09:00:00+08:00'}),quote({id:'timezone',created_at:'2026-11-09T02:00:00Z'})],opts)[0].id,'timezone');
});
test('历史走势不使用未来报价，无样本保持空值',()=>{
 const history=trend([quote()],opts,3);
 assert.deepEqual(history.map(v=>v.average),[null,null,10]);
});
test('报价必须具有有效产品、日期、口径及安全链接',()=>{
 assert.equal(validateQuote(quote(),products,'2026-11-09').price,10);
 for(const extra of [{product_id:'unknown'},{quoted_on:'2026-11-10'},{quoted_on:'2026-02-30'},{valid_until:'2026-11-08'},{valid_until:'2026-11-31'},{source_url:'javascript:alert(1)'},{basis:'bad'},{freight:-1},{province:'火星'}])assert.throws(()=>validateQuote(quote(extra),products,'2026-11-09'));
});
test('CSV 正确处理中文、引号、逗号、换行和公式注入',()=>{
 assert.equal(csvCell('=HYPERLINK("bad")'),'"\'=HYPERLINK(""bad"")"');
 assert.equal(csvCell('正常,名称'),'"正常,名称"');
 assert.deepEqual(parseCSV('\uFEFFname,notes\r\n"甲,乙","说""好""\n继续"\r\n'),[{name:'甲,乙',notes:'说"好"\n继续'}]);
 assert.throws(()=>parseCSV('a,b\n"bad'));
});
test('采集记录必须有真实报价日，单位换算且重试去重键稳定',()=>{
 const source={id:'source-a',name:'测试来源',defaults:{product_id:'a',basis:'factory',unit:'jin'},mapping:{supplier:'seller',province:'region',price:'value',quoted_on:'day'}};
 const record={seller:'甲',region:'山东',value:5,day:'2026-01-01'};
 const a=mapRecord(record,source,products);const b=mapRecord(record,source,products);
 assert.equal(a.price,10);assert.equal(a.valid_until,'2026-01-01');assert.equal(a.status,'pending');assert.equal(a.collector_key,b.collector_key);
 assert.throws(()=>mapRecord({...record,day:undefined},source,products));
});
test('公开供货列表只形成线索，库存不误当起订量，不猜税运口径',()=>{
 const html='<dl><dd class="w1"><a href="https://www.roujiaosuo.com/sell/show/123/">鸡腿</a></dd><dd class="w3">中国</dd><dd class="w4">12000 元/吨</dd><dd class="w5">5 吨</dd><dd class="w6">山东潍坊市</dd><dd class="w7">2026-01-01</dd></dl>';
 const source={id:'roujiaosuo',name:'肉交所',adapter:'roujiaosuo',kind:'supply',url:'https://www.roujiaosuo.com/'};
 const [lead]=parseDiscovery(html,source);
 assert.equal(lead.price_text,'12000 元/吨');assert.equal(lead.status,'pending');assert.equal(lead.basis,undefined);assert.equal(lead.supplier,undefined);assert.match(lead.details,/不是起订量/);
 assert.throws(()=>parseDiscovery('<dl>页面已变化</dl>',source));
});
test('市场和官方标题保持参考用途，原文日期不改为抓取日',()=>{
 const [market]=parseDiscovery('<a href="https://www.cnfowl.com/quote/show-123.html" title="2026-01-02 白条鸡参考价">行情</a>',{id:'cnfowl',name:'禽网',adapter:'cnfowl',kind:'market',url:'https://www.cnfowl.com/'});
 assert.equal(market.published_on,'2026-01-02');assert.equal(market.kind,'market');assert.equal(market.price_text,'');
 const [macro]=parseDiscovery('<a href="./jghq/202601/t20260102_123.htm" title="第1周畜产品价格">周报</a>',{id:'nahs',name:'总站',adapter:'nahs',kind:'macro',url:'https://www.nahs.org.cn/jcyj/'});
 assert.equal(macro.published_on,'2026-01-02');assert.equal(macro.kind,'macro');
});

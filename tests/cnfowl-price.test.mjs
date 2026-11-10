import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiscovery } from '../scripts/discovery.mjs';

const source=(overrides={})=>({id:'cnfowl_rouji',name:'禽网 · 肉鸡行情',url:'https://www.cnfowl.com/quote/show-1.html',adapter:'cnfowl-price',kind:'market',limit:100,...overrides});

test('分段价格表：苗价元/羽不折算，毛鸡元/斤折算为元/公斤',()=>{
 const html=`<html><head><title>2026-11-10 全国肉鸡（鸡苗、毛鸡）参考价格-禽网</title></head><body>
  <table><tr><th>品种</th><th>单位</th><th>涨跌</th></tr>
   <tr><td>817鸡</td><td>元/羽</td><td>涨跌</td></tr>
   <tr><td>安徽</td><td>1.00</td><td>&nbsp;</td></tr>
   <tr><td>白羽鸡</td><td>元/斤</td><td>涨跌</td></tr>
   <tr><td>辽宁</td><td>3.40-3.45</td><td>+0.05</td></tr>
   <tr><td>山东：胴体</td><td>3.50--3.60</td><td>&nbsp;</td></tr>
  </table></body></html>`;
 const rows=parseDiscovery(html,source());
 assert.equal(rows.length,3);
 const chick=rows.find(r=>r.title.includes('安徽'));
 assert.equal(chick.category,'鸡');
 assert.equal(chick.market.stage,'苗');
 assert.equal(chick.market.price_norm_mid,null,'苗价不得折算为元/公斤');
 assert.equal(chick.price_text,'1 元/羽');
 assert.equal(chick.published_on,'2026-11-10');
 const broiler=rows.find(r=>r.title.includes('辽宁'));
 assert.equal(broiler.market.unit,'元/斤');
 assert.equal(broiler.market.price_norm_low,6.8);
 assert.equal(broiler.market.price_norm_high,6.9);
 assert.equal(broiler.market.stage,'毛禽');
 const carcass=rows.find(r=>r.title.includes('胴体'));
 assert.equal(carcass.market.spec,'胴体');
 assert.equal(carcass.market.price_low,3.5);
});

test('缺少报价的合并单元格行被忽略，但不打断当前品种段',()=>{
 const html=`<table>
   <tr><td>白羽鸡</td><td>元/斤</td><td>涨跌</td></tr>
   <tr><td>内蒙/天津/河北</td><td>屠宰：3.15 活禽：3.35</td><td>+0.05</td></tr>
   <tr><td>安徽/山东/河南</td></tr>
   <tr><td>辽宁</td><td>3.40-3.45</td><td>+0.05</td></tr>
  </table>`;
 const rows=parseDiscovery(html,source());
 assert.equal(rows.length,2);
 assert.ok(rows.every(row=>row.market.unit==='元/斤'));
 assert.ok(rows.some(row=>row.title.includes('辽宁')));
});

test('白条鸡批发市场表：按地区与市场逐条取当日价，单位元/公斤',()=>{
 const html=`<head><title>2026-11-10 全国各主要批发市场白条鸡批发价格-禽网</title></head>
  <table>
   <tr><th>地区</th><th>市场</th><th>当日价格</th><th>前一日价格</th><th>环比</th></tr>
   <tr><td>北京市</td><td>北京大洋路农副产品市场有限公司</td><td>16.35</td><td>11.6</td><td>-29.05</td></tr>
   <tr><td>天津市</td><td>天津市金钟河蔬菜贸易中心</td><td>12.4</td><td>12.4</td><td>0</td></tr>
  </table>`;
 const rows=parseDiscovery(html,source({id:'cnfowl_baotiao'}));
 assert.equal(rows.length,2);
 assert.equal(rows[0].region_text,'北京');
 assert.equal(rows[0].market.market,'北京大洋路农副产品市场有限公司');
 assert.equal(rows[0].market.price_norm_mid,16.35);
 assert.equal(rows[0].market.stage,'白条/分割');
 assert.equal(rows[0].price_text,'16.35 元/公斤');
});

test('石兴日报：按鹅/鸡/鸽分组，鹅苗按只计价不折算',()=>{
 const html=`<head><title>2026-11-10 | 石兴鹅/鸡/鸽行情信息_聚合_禽网</title></head>
  <div id="article">
   <p>鹅</p><p>清远鹅苗价（元/只） 7.5</p><p>清远地销鹅（元/斤） 8.3-8.8</p><p>普通棚通鹅（元/斤） 14.6-14.8</p>
   <p>鸡</p><p>清远麻鸡项（元/斤） 9.2-9.5</p>
   <p>鸽</p><p>乳 鸽（元/只） 13.5</p>
   <p>备注:日龄说明。</p>
  </div>`;
 const rows=parseDiscovery(html,source({id:'cnfowl_shixing',adapter:'cnfowl-offer'}));
 assert.equal(rows.length,5);
 const gosling=rows.find(r=>r.title.includes('鹅苗'));
 assert.equal(gosling.category,'鹅');
 assert.equal(gosling.market.region,'清远');
 assert.equal(gosling.market.stage,'苗');
 assert.equal(gosling.market.price_norm_mid,null);
 const goose=rows.find(r=>r.title.includes('地销鹅'));
 assert.equal(goose.market.stage,'毛禽');
 assert.equal(goose.market.price_norm_low,16.6);
 assert.equal(rows.find(r=>r.category==='鸡').market.price_norm_low,18.4);
 assert.equal(rows.find(r=>r.category==='鸽').market.stage,'整只');
});

test('同一篇文章多条报价生成互不冲突的记录 ID',()=>{
 const html=`<table>
   <tr><td>麻鸭</td><td>元/斤</td><td>涨跌</td></tr>
   <tr><td>广东</td><td>5.60--5.80</td><td>&nbsp;</td></tr>
   <tr><td>广西</td><td>5.60--5.80</td><td>&nbsp;</td></tr>
  </table>`;
 const rows=parseDiscovery(html,source({id:'cnfowl_rouya'}));
 assert.equal(rows.length,2);
 assert.notEqual(rows[0].id,rows[1].id);
 assert.equal(new Set(rows.map(row=>row.id)).size,rows.length);
});

test('页面结构变化时抛出可读错误而不是生成空数据',()=>{
 assert.throws(()=>parseDiscovery('<html><body><p>改版了</p></body></html>',source()),/没有解析到有效记录/);
});

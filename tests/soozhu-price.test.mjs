import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiscovery, soozhuArticles } from '../scripts/discovery.mjs';

const source=(overrides={})=>({id:'soozhu_pig',name:'搜猪网·生猪出栏价',url:'https://www.soozhu.com/article/521796/',adapter:'soozhu-province',kind:'market',limit:20,...overrides});

const article=(province,day,price,lastYear)=>`<html><head><title>${day}${province}瘦肉型肉猪(110kg左右)价格|三元生猪【搜猪网】</title></head><body>
 <div class="article_body"><p>${day}${province}瘦肉型肉猪(110kg左右)价格（搜猪网部分用户）</p>
 <table><tr><th>日均价格</th><th>去年同期</th><th>环比</th><th>同比</th></tr>
  <tr><td>${price}</td><td>${lastYear}</td><td>%</td><td>-0.28%</td></tr></table>
 <p>各地均价：</p>
 <table><tr><th>省</th><th>市</th><th>县</th><th>价格</th><th>单位</th></tr>
  <tr><td>${province}</td><td>邢台市</td><td>威县</td><td>8.50</td><td>元/公斤</td></tr></table></div></body></html>`;

test('省级日报：取日均价格，省份与日期来自标题，单位元/公斤不折算',()=>{
 const rows=parseDiscovery(article('河北省','2026.11.11',8.53,11.78),source());
 assert.equal(rows.length,1);
 const [row]=rows;
 assert.equal(row.category,'猪');
 assert.equal(row.region_text,'河北');
 assert.equal(row.published_on,'2026-11-11');
 assert.equal(row.price_text,'8.53 元/公斤');
 assert.equal(row.market.stage,'活畜');
 assert.equal(row.market.price_norm_mid,8.53);
 assert.equal(row.market.previous,11.78);
 assert.match(row.details,/不等于白条肉/);
});

test('“环比”列只输出 % 时仍能取到价格，不被错列干扰',()=>{
 const rows=parseDiscovery(article('新疆','2026.11.11',7.6,11.37),source());
 assert.equal(rows[0].region_text,'新疆');
 assert.equal(rows[0].market.price_low,7.6);
});

test('只有县市明细表、没有日均价格表时不生成记录',()=>{
 const html=`<html><head><title>2026.11.11山东省瘦肉型肉猪(110kg左右)价格</title></head><body>
  <table><tr><th>省</th><th>市</th><th>县</th><th>价格</th><th>单位</th></tr>
   <tr><td>山东省</td><td>临沂市</td><td>兰山区</td><td>8.70</td><td>元/公斤</td></tr></table></body></html>`;
 assert.throws(()=>parseDiscovery(html,source()),/没有解析到有效记录/);
});

test('非瘦肉型肉猪文章（期货观察等）不采集',()=>{
 const html='<html><head><title>生猪期货观察（2026年11月11日）|搜猪网</title></head><body><p>正文</p></body></html>';
 assert.throws(()=>parseDiscovery(html,source({articleTitle:'生猪期货观察（2026年11月11日）'})),/没有解析到有效记录/);
});

test('频道列表页只挑出瘦肉型肉猪文章，同链接去重',()=>{
 const list=`<ul>
  <li><a href="/article/521796/">2026.11.11河北省瘦肉型肉猪(110kg左右)价格</a></li>
  <li><a href="/article/521796/">2026.11.11河北省瘦肉型肉猪(110kg左右)价格</a></li>
  <li><a href="/article/521838/">生猪期货观察（2026年11月11日）</a></li>
  <li><a href="/article/521801/">2026.11.11山东省瘦肉型肉猪(110kg左右)价格</a></li>
  <li><a href="https://www.soozhu.com/article/521837/">搜猪网2026年11月11日监测全国猪价汇总表</a></li>
 </ul>`;
 const articles=soozhuArticles(list);
 assert.equal(articles.length,2);
 assert.deepEqual(articles.map(a=>a.url),['https://www.soozhu.com/article/521796/','https://www.soozhu.com/article/521801/']);
 assert.match(articles[0].title,/河北省瘦肉型肉猪/);
});

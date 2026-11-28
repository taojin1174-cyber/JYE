import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiscovery } from '../scripts/discovery.mjs';

const source = (overrides = {}) => ({
  id: 'cnhnb',
  name: '惠农网',
  url: 'https://www.cnhnb.com/p/erou/',
  adapter: 'cnhnb',
  kind: 'supply',
  limit: 60,
  ...overrides,
});

// 惠农网列表页真实结构（截取两条，保留 data-v 属性，页面靠它标记 SSR 节点）
const hnItem = ({ path, price, unit, title, shop = '鹅场直销', region = '佛山', turnover = '成交1.6万元' }) => `
<div class="supply-item" data-v-c4d1d192>
  <a href="/gongying/${path}/" target="_blank" class="com-bg">
    <div class="shops-price-bg"><div class="shops-price">
      <span class="sp1" data-v-79c7dd86>${price}</span> ${unit}
    </div><div class="turnover" data-v-79c7dd86>${turnover}</div></div>
    <div class="title-field"><div class="title"><h2 data-v-79c7dd86>${title}</h2></div></div>
    <div class="shop-btm">
      <div class="l-shop-btm"><a href="/homepage/931077611/" class="l-shop-btm">${shop}</a></div>
      <div class="r-shop-btm" data-v-79c7dd86>${region}</div>
    </div>
  </a>
</div>`;

test('惠农网：按斤计价的供货条目可核实入库', () => {
  const html = `<html><body>${hnItem({ path: 8485960, price: '11.00', unit: '元/斤', title: '广东清远黑棕鹅 鹅肉 烧鹅专用鹅' })}</body></html>`;
  const rows = parseDiscovery(html, source());
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.kind, 'supply', '供货源必须标为可核实入库');
  assert.equal(row.status, 'pending');
  assert.equal(row.price_text, '11.00元/斤');
  assert.equal(row.region_text, '佛山');
  assert.equal(row.category, '鹅');
  assert.equal(row.url, 'https://www.cnhnb.com/gongying/8485960/');
  assert.match(row.details, /店铺：鹅场直销/);
});

test('惠农网：按个 / 箱 / 件计价不可折算，直接丢弃', () => {
  const html = `<html><body>
    ${hnItem({ path: 1, price: '80.00', unit: '元/个', title: '白条鹅 东北土鹅' })}
    ${hnItem({ path: 2, price: '315.00', unit: '元/箱', title: '白条鹅 整箱' })}
    ${hnItem({ path: 3, price: '9.80', unit: '元/公斤', title: '白条鹅 冷鲜' })}
  </body></html>`;
  const rows = parseDiscovery(html, source());
  assert.equal(rows.length, 1, '只保留可折算成元/kg 的那条');
  assert.equal(rows[0].price_text, '9.80元/公斤');
});

test('惠农网：页面里出现手机号也不会进线索', () => {
  const html = `<html><body>${hnItem({ path: 9, price: '8.00', unit: '元/斤', title: '清远黑棕鹅 鹅肉 联系电话 13800138000' })}</body></html>`;
  const rows = parseDiscovery(html, source());
  assert.equal(rows.length, 1);
  assert.doesNotMatch(JSON.stringify(rows), /13800138000/, '红线：不得采集联系电话');
});

test('惠农网：改版解析不到条目时抛错，不写空快照', () => {
  assert.throws(
    () => parseDiscovery('<html><body><p>页面改版了</p></body></html>', source()),
    /没有解析到有效记录/,
  );
});

const sqSource = (overrides = {}) => ({
  id: 'qiye11467',
  name: '顺企网',
  url: 'https://b2b.11467.com/search/-51b751bb767d67619e45.htm',
  adapter: 'qiye11467',
  kind: 'supply',
  limit: 30,
  ...overrides,
});

const sqItem = ({ id, title, price, unit, company, region, phone = '15620376669' }) => `
<li><span class="plistimg"><a class="imglink" href="https://product.11467.com/info/${id}.htm" title="${title}">
<img alt="${title}" src="//img.11467.com/u/1/x_small.jpg"></a></span>
<dl><dt><a href="https://product.11467.com/info/${id}.htm" target="_blank">${title}</a></dt>
<dd class="canshu"><span>品牌:永利食品</span></dd>
<dd>报价<em>￥<span>${price}</span></em>/${unit}</dd>
<dd><div class="btn-mobile">${phone}</div></dd>
<dd><a href="https://kunming0136858.11467.com">${company}</a><span class="weizhi">${region}</span></dd></dl></li>`;

test('顺企网：吨价条目入库，千分位报价正确去逗号', () => {
  const html = `<html><body><ul class="pli">
    ${sqItem({ id: 3006477, title: '批发白条鹅-冷冻鹅腿鹅头批发厂家', price: '9,800.00', unit: '吨', company: '昆明永利冷冻食品有限公司', region: '云南-昆明' })}
  </ul></body></html>`;
  const rows = parseDiscovery(html, sqSource());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price_text, '9800.00元/吨');
  assert.equal(rows[0].region_text, '云南-昆明');
  assert.equal(rows[0].kind, 'supply');
  assert.match(rows[0].details, /昆明永利冷冻食品有限公司/);
});

test('顺企网：按件计价丢弃，手机号不入库', () => {
  const html = `<html><body><ul class="pli">
    ${sqItem({ id: 1, title: '冷冻白条鹅批发', price: '98.00', unit: '件', company: '天津鸿润', region: '天津' })}
    ${sqItem({ id: 2, title: '冷冻白条鹅 整鹅', price: '7,600.00', unit: '吨', company: '无锡隆达', region: '江苏-无锡' })}
  </ul></body></html>`;
  const rows = parseDiscovery(html, sqSource());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price_text, '7600.00元/吨');
  assert.doesNotMatch(JSON.stringify(rows), /15620376669/, '红线：页面上有手机号也不能读');
});

// 2026-11-28：可核价来源只覆盖四类禽肉时，线索量偏少；把牛羊肉与白条鸭一并抓，
// 同时锁住配置，避免以后精简清单时又把这几页删掉。
test('采集清单包含牛羊肉与白条鸭页，且顺企网仍带 Referer', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = JSON.parse(await readFile(new URL('../collector/web-sources.json', import.meta.url), 'utf8'));
  const items = Array.isArray(raw) ? raw : raw.sources;
  const byId = new Map(items.map(s => [s.id, s]));

  const cnhnb = byId.get('cnhnb');
  assert.equal(cnhnb.kind, 'supply');
  for (const path of ['erou', 'jirou', 'yarou', 'zhurou', 'niurou', 'yangrou']) {
    assert.ok(cnhnb.listUrls.includes(`https://www.cnhnb.com/p/${path}/`), `惠农网应抓取 /p/${path}/`);
  }

  const qiye = byId.get('qiye11467');
  assert.equal(qiye.kind, 'supply');
  assert.equal(qiye.listUrls.length, 2, '顺企网应抓「冻白条鹅」与「白条鸭」两页');
  assert.ok(qiye.listUrls.some(u => u.includes('-51b751bb767d67619e45')), '应保留冻白条鹅页');
  assert.ok(qiye.listUrls.some(u => u.includes('-767d67619e2d')), '应包含白条鸭页');
  assert.equal(qiye.headers?.Referer, 'https://b2b.11467.com/', '缺 Referer 会被 429');
});

test('顺企网列表页只留能折成元/kg 的报价，设备与服务类不计入', () => {
  const block = ({ url, title, price, unit, company = '某某食品有限公司', region = '山东-临沂' }) => `
<li><span class="plistimg"><a href="${url}"><img src="x.jpg"></a></span>
<dl><dt><a href="${url}" target="_blank">${title}</a></dt>
<dd>报价<em>￥<span>${price}</span></em>/${unit}</dd>
<dd><a href="https://abc.11467.com">${company}</a><span class="weizhi">${region}</span></dd></dl></li>`;
  const html = [
    block({ url: 'https://product.11467.com/info/1.htm', title: '冷冻白条鸭 鸭副产品批发', price: '7,000.00', unit: '吨' }),
    block({ url: 'https://product.11467.com/info/2.htm', title: '白条鸭分级分选机 流水线设备', price: '66,000.00', unit: '台' }),
    block({ url: 'https://product.11467.com/info/3.htm', title: '白条鸭检测 肌苷酸检测服务', price: '128.00', unit: '件' }),
  ].join('');
  const rows = parseDiscovery(html, { ...source(), id: 'qiye11467', adapter: 'qiye11467' });
  assert.equal(rows.length, 1, '只保留按吨计价的白条鸭货源');
  assert.equal(rows[0].price_text, '7000.00元/吨');
  assert.equal(rows[0].category, '鸭');
});

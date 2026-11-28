import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settingsLock } from '../src/settings-lock.js';
import { accessLock } from '../src/access-lock.js';
import { config } from '../config.js';
import { dayString, shiftDay, addMonths } from '../src/core.js';

// 本机模式的数据键名，由 config.localTrial 决定；用于预置「已入库」等历史状态。
const DATA_KEY = config.localTrial ? 'hqt-trial-data-v2' : 'hqt-data-v2';

const snapshot = JSON.parse(readFileSync(new URL('./fixtures/leads.json', import.meta.url), 'utf8'));

// 最小 DOM 桩：只验证模块能完整启动、4 个 hash 页面都能渲染出正确结构。
function stubDom(hash, { unlocked = true, data = snapshot, storage = {}, discovery = null } = {}) {
  // 全站访问门：默认按「已解锁」启动，另有一条用例验证未解锁时只显示密码页。
  const memory = new Map([[`hqt-access:/:${accessLock.verifier.slice(0, 16)}`, 'unlocked'], ...Object.entries(storage)]);
  if (!unlocked) memory.clear();
  const unlockedKey = `hqt-settings:/:${settingsLock.verifier.slice(0, 16)}`;
  const session = new Map([[unlockedKey, 'unlocked']]);
  const el = () => ({ innerHTML: '', textContent: '', open: false, classList: { add() {}, remove() {} }, showModal() { this.open = true; }, close() { this.open = false; }, querySelector: () => null, addEventListener() {} });
  const clicks = [], changes = [];
  const app = el(), toast = el(), dialog = el();
  globalThis.document = {
    querySelector: sel => sel === '#app' ? app : sel === '#toast' ? toast : sel === '#dialog' ? dialog : null,
    addEventListener: (type, fn) => { if (type === 'click') clicks.push(fn); if (type === 'change') changes.push(fn); },
  };
  globalThis.window = { addEventListener() {} };
  globalThis.location = { hash, pathname: '/', reload() {} };
  globalThis.localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k) };
  globalThis.sessionStorage = { getItem: k => session.get(k) ?? null, setItem: (k, v) => session.set(k, v), removeItem: k => session.delete(k) };
  // 采集快照走 data/discovery.json，其余请求（云端表）走 data；两者结构不同，需要分开供给。
  globalThis.fetch = async input => {
    const url = typeof input === 'string' ? input : String(input?.href || input?.url || input);
    if (discovery && url.includes('discovery.json')) return { ok: true, json: async () => discovery };
    return { ok: true, json: async () => data };
  };
  app.__click = dataset => {
    const target = { dataset, closest: sel => (sel === 'button,a' ? target : null) };
    for (const fn of clicks) fn({ target });
  };
  app.__change = (dataset, value) => {
    const target = { dataset, value, id: '', files: [] };
    for (const fn of changes) fn({ target });
  };
  return app;
}

const cases = [
  // 2026-11-28 采购比价并入总览：一页里既有筛选行、品类卡片、走势，也有原来的报价表。
  ['overview', ['全部品类', '全部产品规格', '均价走势', '供货报价', '导出数据', '录入报价']],
  ['compare', ['供货报价', '全部产品规格']],
  ['review', ['待确认', '刷新记录']],
  ['settings/review', ['待确认', '刷新记录', '数据中心', '基础设置']],
  ['settings', ['自动采集线索', '已处理', '数据中心', '基础设置']],
  ['settings/general', ['管理品类', '导入备份', '此设备（未上传）', '产品库', '最近入库']],
];

for (const [hash, markers] of cases) {
  test(`页面 #${hash} 正常渲染且不再重复大标题`, async () => {
    const app = stubDom('#' + hash);
    await import(`../src/app.js?route=${encodeURIComponent(hash)}`);
    assert.ok(app.innerHTML.length > 500, '页面内容过短，可能启动失败');
    assert.doesNotMatch(app.innerHTML, /暂时无法读取数据|页面暂未加载完成/);
    assert.doesNotMatch(app.innerHTML, /class="page-heading"|<h1>行情总览|MARKET OVERVIEW/);
    for (const marker of markers) assert.match(app.innerHTML, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    // 来源中心在密码解锁后本来就展示出处；前台三页必须零出处。
    if (!hash.startsWith('settings')) assert.doesNotMatch(app.innerHTML, /roujiaosuo\.com|cnfowl\.com|禽网|畜牧总站|肉交所/);
  });
}

test('基础设置页：五个面板是可折叠卡片，产品库带删除入口', async () => {
  const app = stubDom('#settings/general');
  await import('../src/app.js?route=settings-fold');
  const html = app.innerHTML;
  const folds = html.match(/<details class="panel fold[ "]/g) || [];
  assert.equal(folds.length, 5, '产品库/数据来源/统计口径/团队与访问/最近入库都应是折叠卡片');
  assert.ok(!/<section class="panel">/.test(html), '基础设置不应再有不可折叠的面板');
  assert.match(html, /data-delete-product="/, '产品库应提供删除按钮');
  assert.match(html, /data-action="add-product"/, '产品库应保留添加按钮');
  // 收起态是紧凑入口卡：图标块 + 标题 + 一行副标题，副标题不能放在 h2 里（会被窄屏样式隐藏）。
  assert.equal((html.match(/class="fold-icon"/g) || []).length, 5, '五张卡都应有图标块');
  assert.equal((html.match(/class="fold-title"/g) || []).length, 5, '五张卡都应有标题容器');
  assert.match(html, /<small>[\d]+ 个规格<\/small>/, '产品库应显示规格数量');
  assert.match(html, /<small>人工确认后入库<\/small>/);
  assert.match(html, /<h2>最近入库<\/h2>/, '最近入库应作为折叠卡收在这里，不再占用总览页');
});

test('数据设置页的导出与录入按钮并入栏目行，不再单独占一行', async () => {
  const app = stubDom('#settings');
  await import('../src/app.js?route=settings-tabs');
  const html = app.innerHTML;
  assert.doesNotMatch(html, /class="page-actions/, '不应再输出独立的操作行');
  const start = html.indexOf('<div class="settings-tabs">');
  assert.ok(start >= 0, '缺少栏目行');
  // 栏目行现在有三个视图（数据中心 / 报价审核 / 基础设置），窗口相应放宽。
  const bar = html.slice(start, start + 1600);
  assert.match(bar, /data-settings-view="general"/, '栏目行应含基础设置');
  assert.match(bar, /data-settings-view="sources"/, '栏目行应含数据中心');
  assert.match(bar, /data-settings-view="review"/, '栏目行应含报价审核');
  assert.match(bar, /data-action="export"/, '导出按钮应在栏目行内');
  assert.match(bar, /data-action="add"/, '录入按钮应在栏目行内');
  assert.doesNotMatch(bar, /data-action="lock-settings"/, '锁定按钮已去掉，栏目行只留导出与录入');
});

test('未解锁时只显示访问密码页，页面不含任何报价或线索', async () => {
  const app = stubDom('#overview', { unlocked: false });
  await import('../src/app.js?route=locked');
  assert.match(app.innerHTML, /请输入访问密码/);
  assert.match(app.innerHTML, /id="access-form"/);
  assert.doesNotMatch(app.innerHTML, /产品参考均价|供货报价|待确认报价|自动采集线索/);
});

test('已入库的线索不消失，改为沉到列表末尾并标注', async () => {
  // 预置一条本机已入库记录：它在采集快照里仍然存在（发布日 2026-11-10，本应排在前面）。
  const storage = { [DATA_KEY]: JSON.stringify({ products: [], quotes: [], leads: [{ id: 'fixture-0003', status: 'converted' }] }) };
  const app = stubDom('#settings', { storage });
  await import('../src/app.js?route=lead-done-last');
  // 默认只看「可核实入库」（2026-11-28），这里要连同行情 / 资讯一起看沉底位置，先切回全部处理方式。
  app.__change({ filter: 'leadUse' }, '');
  const html = app.innerHTML;
  const body = html.slice(html.indexOf('<tbody>') + 7, html.indexOf('</tbody>'));
  const rows = body.split('<tr').filter(Boolean);
  const last = rows.at(-1);
  assert.equal(rows.length, 10, '已入库的线索仍留在列表里，不应被隐藏');
  assert.match(last, /lead-done/, '已入库的线索应排在本页最后一行');
  assert.match(last, /白条鹅（净膛）/, '排到末尾的应是刚入库的那条线索');
  assert.match(last, /已入库/, '已入库的行要标注状态，避免与待核实混淆');
  assert.doesNotMatch(last, /data-lead="/, '已入库的线索不应再出现核实入库按钮');
  assert.equal(rows.filter(r => !/lead-done/.test(r)).length, rows.length - 1, '只有已入库的那一行被淡化');
});

test('线索表可按标题、标价、地区与发布日期排序', async () => {
  const app = stubDom('#settings');
  await import('../src/app.js?route=lead-sort');
  const rows = () => {
    const start = app.innerHTML.indexOf('<tbody>') + 7;
    return app.innerHTML.slice(start, app.innerHTML.indexOf('</tbody>')).split('<tr').filter(Boolean);
  };
  const regions = () => rows().map(r => (r.match(/<td>([^<]*)<div class="product-spec">\d{4}-\d{2}-\d{2}/) || [])[1]);

  // 三列都可点击排序。
  for (const col of ['title', 'price', 'date']) {
    assert.match(app.innerHTML, new RegExp(`<button class="th-sort" type="button" data-lead-sort="${col}"`), `${col} 列应可点击排序`);
  }

  // 默认按发布日期从新到旧：首行是样本里最新的 2026-11-10。
  assert.match(app.innerHTML, /<th aria-sort="descending"><button class="th-sort"[^>]*data-lead-sort="date"/, '发布日期列头应标为降序');
  assert.match(rows()[0], /2026-11-10/, '默认应按发布日期从新到旧');

  // 点一次改为从早到晚：首行变成最早的 2026-11-07。
  app.__click({ leadSort: 'date' });
  assert.match(app.innerHTML, /<th aria-sort="ascending"><button class="th-sort"[^>]*data-lead-sort="date"/, '点击后应切换为升序');
  assert.match(rows()[0], /2026-11-07/, '升序时最早的线索应排在第一行');

  // 再点一次改为按地区拼音，顺序应与地区拼音升序一致。
  app.__click({ leadSort: 'date' });
  const byRegion = regions();
  assert.deepEqual(byRegion, [...byRegion].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')), '第三态应按地区拼音排序');

  // 第三次点回到从新到旧。
  app.__click({ leadSort: 'date' });
  assert.match(rows()[0], /2026-11-10/, '第三次点击应切回从新到旧');
});

test('线索表「标价原文」按折算后的元/kg 排序，按只计价的沉底', async () => {
  const app = stubDom('#settings');
  await import('../src/app.js?route=lead-sort-price');
  app.__change({ filter: 'leadUse' }, ''); // 最低价的毛鸡来自行情线索，需先放开处理方式
  const rows = () => {
    const start = app.innerHTML.indexOf('<tbody>') + 7;
    return app.innerHTML.slice(start, app.innerHTML.indexOf('</tbody>')).split('<tr').filter(Boolean);
  };

  // 从低到高：4.35 元/斤（=8.70 元/kg）最低。
  app.__click({ leadSort: 'price' });
  assert.match(rows()[0], /毛鸡 4\.35 元\/斤/, '升序首行应是最便宜的 8.70 元/kg');
  assert.match(app.innerHTML, /<th aria-sort="ascending"><button class="th-sort"[^>]*data-lead-sort="price"/);

  // 从高到低：10.50 元/斤 折 21.00 元/kg，高于 16.00 元/公斤，应排第一。
  app.__click({ leadSort: 'price' });
  assert.match(rows()[0], /10\.50元\/斤/, '按斤计价需折算后比较，21.00 元/kg 应排第一');
  assert.doesNotMatch(rows()[0], /元\/只/, '按只计价的苗价不参与重量单位排序');

  // 按只计价与「见原文」的线索沉在末尾，不随方向翻转。
  assert.match(rows().at(-1), /见原文|元\/只/, '无可用单价的线索应排在最后');
});

test('线索表「原文产品 / 标题」可切换升降序', async () => {
  const app = stubDom('#settings');
  await import('../src/app.js?route=lead-sort-title');
  const rows = () => {
    const start = app.innerHTML.indexOf('<tbody>') + 7;
    return app.innerHTML.slice(start, app.innerHTML.indexOf('</tbody>')).split('<tr').filter(Boolean);
  };
  app.__click({ leadSort: 'title' });
  const ascFirst = rows()[0], ascLast = rows().at(-1);
  assert.match(app.innerHTML, /<th aria-sort="ascending"><button class="th-sort"[^>]*data-lead-sort="title"/);
  app.__click({ leadSort: 'title' });
  assert.match(app.innerHTML, /<th aria-sort="descending"><button class="th-sort"[^>]*data-lead-sort="title"/);
  assert.equal(rows()[0], ascLast, '标题倒序时首行应等于升序时的末行');
  assert.notEqual(rows()[0], ascFirst, '切换方向后首行应改变');
});

test('线索默认只显示近 30 天，更早的折叠但可切到全部时间', async () => {
  // 采集会抓到多年前的行情文章，这类老线索默认不该占据列表。
  const old = { ...snapshot.items[0], id: 'fixture-old', published_on: '2016-10-20', title: '2016 年历史行情文章' };
  const data = { ...snapshot, items: [...snapshot.items, old] };
  const app = stubDom('#settings', { data });
  await import('../src/app.js?route=lead-range');
  assert.doesNotMatch(app.innerHTML, /2016 年历史行情文章/, '默认不该显示 2016 年的线索');
  assert.match(app.innerHTML, /折叠 1 条旧线索/, '应提示被折叠的旧线索数量');
  assert.match(app.innerHTML, /data-filter="leadRange"/, '应提供发布时间下拉');
  app.__change({ filter: 'leadRange' }, '0');
  assert.match(app.innerHTML, /2016 年历史行情文章/, '选「全部时间」后旧线索应重新出现');
  assert.doesNotMatch(app.innerHTML, /折叠 1 条/, '不再显示折叠提示');
});

test('访问密码配置只含盐与派生值，且迭代次数达标', () => {
  const source = readFileSync(new URL('../src/access-lock.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /password\s*[:=]\s*['"][^'"]+['"]/i, '配置文件里不得出现明文密码');
  assert.equal(accessLock.algorithm, 'PBKDF2');
  assert.equal(accessLock.hash, 'SHA-256');
  assert.ok(accessLock.iterations >= 100000, '迭代次数过低');
  assert.match(accessLock.salt, /^[0-9a-f]{32}$/);
  assert.match(accessLock.verifier, /^[0-9a-f]{64}$/);
});

test('行情总览不展示猪卡片，默认只放鹅鸡鸭三张卡', async () => {
  const overview = stubDom('#overview');
  await import('../src/app.js?route=no-pig-card');
  const cards = overview.innerHTML.match(/<button class="price-card/g) || [];
  // 2026-11-18 起默认只看主力三类，羊等其余品类点标签才出现。
  assert.equal(cards.length, 3, '默认应只有鹅 / 鸡 / 鸭三张卡');
  assert.doesNotMatch(overview.innerHTML, /category-dot">猪</);
  assert.doesNotMatch(overview.innerHTML.slice(0, overview.innerHTML.indexOf('产品参考均价')), /category-dot">羊</, '羊默认不进卡片');

  const settings = stubDom('#settings');
  await import('../src/app.js?route=lead-use-filter');
  assert.match(settings.innerHTML, /data-filter="leadUse"/);
  assert.match(settings.innerHTML, /可核实入库/);
  assert.match(settings.innerHTML, /仅作参考/);
});

test('采购比价：供货价表头点击可切换升降序', async () => {
  const app = stubDom('#compare');
  await import('../src/app.js?route=price-sort-header');
  const prices = () => [...app.innerHTML.matchAll(/<td class="number[^"]*">([^<]+)</g)]
    .map(m => Number(String(m[1]).replace(/[^\d.]/g, '')))
    .filter(n => Number.isFinite(n) && n > 0);
  assert.match(app.innerHTML, /data-sort-price/, '供货价表头应有排序按钮');
  assert.match(app.innerHTML, /aria-sort="ascending"/, '默认按供货价从低到高');
  assert.match(app.innerHTML, /供货价：从低到高/);
  const asc = prices();
  if (asc.length > 1) assert.deepEqual(asc, [...asc].sort((a, b) => a - b), '默认应为升序');

  app.__click({ sortPrice: '' });
  assert.match(app.innerHTML, /aria-sort="descending"/, '点击后应变为降序');
  assert.match(app.innerHTML, /供货价：从高到低/);
  const desc = prices();
  if (desc.length > 1) assert.deepEqual(desc, [...desc].sort((a, b) => b - a), '降序排列应生效');

  app.__click({ sortPrice: '' });
  assert.match(app.innerHTML, /aria-sort="ascending"/, '再点一次应回到升序');
});

test('过期报价退出均价与最近入库，卡片标出有效至与剩余天数', async () => {
  const today = dayString();
  const base = { basis: 'factory', source: 'engine', source_name: '测试来源', source_url: '', min_order: '', freight: null, status: 'approved', city: '', created_at: '2020-03-01T00:00:00Z' };
  const storage = { [DATA_KEY]: JSON.stringify({
    products: [{ id: 'chicken-fresh', category: '鸡', name: '清远鸡', state: '鲜品', spec: '1.2kg/只' }],
    quotes: [
      { ...base, id: 'q-expired', product_id: 'chicken-fresh', supplier: '过期供应商', province: '广东', price: 20, quoted_on: '2020-03-01', valid_until: '2020-04-01', notes: '已经过期的旧报价' },
      { ...base, id: 'q-live', product_id: 'chicken-fresh', supplier: '有效供应商', province: '广东', price: 10, quoted_on: today, valid_until: addMonths(today, 2), notes: '仍在有效期内的报价' },
    ],
  }) };
  const overviewApp = stubDom('#overview', { storage });
  await import('../src/app.js?route=validity-note');
  const html = overviewApp.innerHTML;
  const price = html.match(/class="card-price"><strong>([\d.]+)<\/strong>/)?.[1];
  assert.equal(price, '10.00', '卡片均价只应统计未过期报价');
  assert.match(html, /card-valid/, '卡片底部应给出有效期提示');
  assert.match(html, /有效至 \d{2}-\d{2} · 剩 \d+ 天/, '提示里应写明到期日与剩余天数');
  assert.doesNotMatch(html, /最近入库/, '最近入库已移到数据设置，总览页不再出现');

  // 最近入库移到「数据设置 → 基础设置」，默认折叠，展开后仍只含未过期报价。
  const settingsApp = stubDom('#settings/general', { storage });
  await import('../src/app.js?route=validity-note-settings');
  const settingsHtml = settingsApp.innerHTML;
  assert.match(settingsHtml, /<details class="panel fold full">[\s\S]*最近入库/, '最近入库应以折叠卡形式出现在基础设置');
  assert.doesNotMatch(settingsHtml, /过期供应商/, '过期报价不应进入最近入库');
  assert.match(settingsHtml, /有效供应商/, '有效报价仍应出现在最近入库');
});

test('点击品类卡片打开可比均价：多规格逐行比较，不跨规格混算', async () => {
  const today = dayString();
  const base = { basis: 'factory', source: 'engine', source_name: '测试来源', source_url: '', min_order: '', freight: null, status: 'approved', city: '', created_at: '2020-03-01T00:00:00Z' };
  const storage = { [DATA_KEY]: JSON.stringify({
    products: [
      { id: 'goose-a', category: '鹅', name: '白条鹅', state: '冻品', spec: '3-4 斤/只' },
      { id: 'goose-b', category: '鹅', name: '白条鹅', state: '冻品', spec: '4-5 斤/只' },
    ],
    quotes: [
      { ...base, id: 'g1', product_id: 'goose-a', supplier: '甲', province: '广东', price: 20, quoted_on: today, valid_until: addMonths(today, 2), notes: '' },
      { ...base, id: 'g2', product_id: 'goose-b', supplier: '乙', province: '广东', price: 26, quoted_on: today, valid_until: addMonths(today, 2), notes: '' },
    ],
  }) };
  const app = stubDom('#overview', { storage });
  await import('../src/app.js?route=comparable');
  app.__click({ comparable: 'goose-a' });
  const html = globalThis.document.querySelector('#dialog').innerHTML;
  assert.match(html, /可比均价/, '应打开可比均价弹窗');
  assert.match(html, /3-4 斤\/只/, '第一个规格应单独成行');
  assert.match(html, /4-5 斤\/只/, '第二个规格应单独成行');
  assert.match(html, /20\.00/, '3-4 斤规格显示自己的均价');
  assert.match(html, /26\.00/, '4-5 斤规格显示自己的均价');
  assert.match(html, /较 30 日前/, '应给出同比列');
  assert.match(html, /不混算|不能直接相减/, '应提示跨规格不可直接比价');
  // 两个规格各自只有 1 条样本，不能出现合并后的 23.00 均价。
  assert.doesNotMatch(html, /23\.00/, '不得把不同重量合并成一个均价');
});

test('总览：卡片只出鹅鸡鸭三类，顺序为筛选 → 卡片 → 走势 → 报价表，产品参考均价已移除', async () => {
  const today = dayString();
  const base = { basis: 'factory', source: 'manual', source_name: '', source_url: '', min_order: '', freight: null, status: 'approved', city: '', created_at: '2020-03-01T00:00:00Z' };
  const storage = { [DATA_KEY]: JSON.stringify({
    products: [
      { id: 'goose', category: '鹅', name: '白条鹅', state: '冻品', spec: '3-4 斤/只' },
      { id: 'chicken', category: '鸡', name: '清远鸡', state: '冻品', spec: '2-3 斤/只' },
      { id: 'duck', category: '鸭', name: '白条鸭', state: '冻品', spec: '3 斤/只' },
      { id: 'lamb', category: '羊', name: '羊肉', state: '鲜品', spec: '胴体' },
      { id: 'egg', category: '蛋品', name: '鲜鸡蛋', state: '鲜品', spec: '30 斤/箱' },
    ],
    quotes: [
      { ...base, id: 'l1', product_id: 'lamb', supplier: '甲', province: '内蒙古', price: 52, quoted_on: today, valid_until: addMonths(today, 2), notes: '' },
      { ...base, id: 'e1', product_id: 'egg', supplier: '乙', province: '河北', price: 9, quoted_on: today, valid_until: addMonths(today, 2), notes: '' },
    ],
  }) };
  const app = stubDom('#overview', { storage });
  await import('../src/app.js?route=overview-merged');
  const html = app.innerHTML;

  assert.doesNotMatch(html, /产品参考均价/, '产品参考均价汇总表已按用户要求移除');

  const toolbarAt = html.indexOf('class="filter-panel market-toolbar"');
  const cardsAt = html.indexOf('<div class="cards">');
  const chartAt = html.indexOf('class="panel chart-panel"');
  const tableAt = html.indexOf('class="panel market-results"');
  assert.ok(toolbarAt >= 0 && cardsAt > toolbarAt, '筛选行在最上，品类卡片紧随其后');
  assert.ok(chartAt > cardsAt, '走势排在卡片之后');
  assert.ok(tableAt > chartAt, '报价表排在走势之后');

  // 卡片区只放主力三类
  const cards = html.slice(cardsAt, chartAt);
  assert.match(cards, /白条鹅/);
  assert.match(cards, /清远鸡/);
  assert.match(cards, /白条鸭/);
  assert.doesNotMatch(cards, /羊肉/, '羊默认不进卡片');
  assert.doesNotMatch(cards, /鲜鸡蛋/, '蛋品默认不进卡片');

  // 报价表默认跟随筛选行的「全部品类」，与控件一致
  const table = html.slice(tableAt);
  assert.match(table, /羊肉/, '筛选为全部品类时，羊的报价应出现在明细里');
  assert.match(table, /鲜鸡蛋/, '筛选为全部品类时，蛋品的报价也应出现');

  // 点卡片 = 品类与规格一起切过去，走势和报价表同步
  app.__click({ pick: 'lamb' });
  assert.match(app.innerHTML, /value="lamb" selected/, '点卡片应把筛选行的产品规格切过去');
  assert.match(app.innerHTML, /value="羊" selected/, '品类下拉也应跟着切换');
  assert.doesNotMatch(app.innerHTML, /鲜鸡蛋/, '切到羊之后报价表只剩羊');
});

test('选中不展示卡片的品类时不输出空卡片容器，避免留出空白块', async () => {
  const storage = { [DATA_KEY]: JSON.stringify({
    products: [
      { id: 'goose', category: '鹅', name: '白条鹅', state: '冻品', spec: '3-4 斤/只' },
      { id: 'pig', category: '猪', name: '白条猪', state: '鲜品', spec: '胴体' },
    ],
    quotes: [],
  }) };
  const app = stubDom('#overview', { storage });
  await import('../src/app.js?route=empty-cards');
  assert.match(app.innerHTML, /<div class="cards">/, '默认视图应有卡片容器');
  app.__change({ filter: 'category' }, '猪');
  assert.doesNotMatch(app.innerHTML, /<div class="cards">/, '猪不出卡片，不应留空容器');
});

test('数据中心：筛选组排在最左，标题与类型切换在其后', async () => {
  const app = stubDom('#settings');
  await import('../src/app.js?route=lead-head-order');
  const html = app.innerHTML;
  const headAt = html.indexOf('class="panel-head lead-head"');
  assert.ok(headAt > 0, '缺少线索面板头部');
  const head = html.slice(headAt, headAt + 1400);

  const filtersAt = head.indexOf('class="lead-filters"');
  const titleAt = head.indexOf('自动采集线索');
  const kindAt = head.indexOf('class="segmented"');

  assert.ok(filtersAt >= 0 && titleAt >= 0 && kindAt >= 0, '三个部分都应存在');
  assert.ok(filtersAt < titleAt, '筛选组应在标题之前（放最左边）');
  assert.ok(titleAt < kindAt, '标题应在类型切换之前');

  // 五个筛选项都要在筛选组里，顺序保持原样（2026-11-28 起「来源」排在最左）
  const filters = head.slice(filtersAt, titleAt);
  const order = ['全部来源', '全部品类', '全部处理方式', '近 30 天'].map((t) => filters.indexOf(t));
  assert.ok(order.every((i) => i >= 0), '四个下拉都应保留');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), '筛选顺序应保持不变');
});

test('总览导出就是当前筛选的供货明细，不受分页限制', async () => {
  const today = dayString();
  const base = { basis: 'factory', source: 'manual', source_name: '', source_url: '', min_order: '', freight: null, status: 'approved', city: '', created_at: '2020-03-01T00:00:00Z' };
  const saved = {
    products: [
      { id: 'lamb', category: '羊', name: '羊肉', state: '鲜品', spec: '胴体' },
      { id: 'egg', category: '蛋品', name: '鲜鸡蛋', state: '鲜品', spec: '30 斤/箱' },
    ],
    quotes: [
      { ...base, id: 'l1', product_id: 'lamb', supplier: '甲', province: '内蒙古', price: 52, quoted_on: today, valid_until: addMonths(today, 2), notes: '' },
      { ...base, id: 'e1', product_id: 'egg', supplier: '乙', province: '河北', price: 9, quoted_on: today, valid_until: addMonths(today, 2), notes: '' },
    ],
  };
  const app = stubDom('#overview', { storage: { [DATA_KEY]: JSON.stringify(saved) } });
  await import('../src/app.js?route=export-scope');
  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;
  const createElement = document.createElement;
  let captured;
  URL.createObjectURL = blob => { captured = blob; return 'blob:qa-export'; };
  URL.revokeObjectURL = () => {};
  document.createElement = () => ({ click() {} });
  const read = async () => { app.__click({ action: 'export' }); return (await captured.text()).trim().split('\r\n'); };
  try {
    let lines = await read();
    assert.equal(lines.length, 3, '默认应导出两条明细 + 表头');
    app.__change({ filter: 'category' }, '羊');
    lines = await read();
    assert.equal(lines.length, 2, '选羊后只导出羊的报价');
    assert.match(lines[1], /^"羊"/);
  } finally { URL.createObjectURL = createObjectURL; URL.revokeObjectURL = revokeObjectURL; document.createElement = createElement; }
});

test('线索品类包含产品档案与采集到的扩展物种', async () => {
 const custom=structuredClone(snapshot);
 custom.items.push({...custom.items[0],id:'qa-pigeon',title:'白羽鸽',category:'鸽'});
 const app=stubDom('#settings',{data:custom});
 await import('../src/app.js?route=lead-category-regression');
 assert.match(app.innerHTML,/<select aria-label="线索品类"[^>]*>[\s\S]*?<option value="鸽"/);
});

test('手机隐藏导出文字后，操作按钮仍有独立的可读名称', async () => {
 const app=stubDom('#settings');
 await import('../src/app.js?route=export-accessible-label');
 const button=app.innerHTML.match(/<button[^>]*data-action="export"[^>]*>/)?.[0];
 assert.match(button||'',/aria-label="导出数据"/);
});

test('总览对待核实规格显示原因，不能把两条未知规格报价显示为均价', async () => {
 const today=dayString();
 const definitions=[{id:'unknown-goose',category:'鹅',name:'验收未核实鹅',state:'冻品',spec:'冻品 · 规格待核实'}];
 const quotes=[7.5,11.6].map((price,i)=>({id:'unverified-'+i,product_id:'unknown-goose',supplier:'验收供应商'+i,province:'广东',price,basis:'factory',source:'manual',status:'approved',quoted_on:today,valid_until:addMonths(today,1),created_at:new Date().toISOString()}));
 const saved={products:definitions,quotes,leads:[],audit:[],deletionRequests:[]};
 const app=stubDom('#overview',{storage:{[DATA_KEY]:JSON.stringify(saved)}});
 await import('../src/app.js?route=unknown-spec-averages');
 assert.doesNotMatch(app.innerHTML,/>9\.55</,'未知规格不能显示混合均价');
 assert.match(app.innerHTML,/不计入均价/,'规格已写待核实时，第二行只说结果，不重复一遍原因');
 saved.quotes[0].notes='联系手机：13800000000';
 const compare=stubDom('#compare',{storage:{[DATA_KEY]:JSON.stringify(saved)}});
 await import('../src/app.js?route=unknown-spec-comparison');
 assert.match(compare.innerHTML,/验收供应商0/);
 assert.match(compare.innerHTML,/<th>联系方式<\/th>/);
 assert.match(compare.innerHTML,/href="tel:13800000000"/);
 assert.match(compare.innerHTML,/验收供应商1/);
 assert.match(compare.innerHTML,/不计入均价/);
 compare.__change({filter:'product'},'unknown-goose');
 assert.doesNotMatch(compare.innerHTML,/>9\.55</,'单选待核实规格也不能计算均价');
});

// 2026-11-28 用户反馈「均价走势没有显示」：图形没坏，是默认把这个 id 写死成白羽鸡，
// 而它在 7 天窗口内一条合格样本都没有。以下三条锁住修复后的行为。
test('均价走势默认落在最近 7 天真有样本的产品上，不落在空产品上', async () => {
 const today = dayString();
 const base = { basis: 'factory', source: 'engine', source_name: '测试来源', source_url: '', min_order: '', freight: null, status: 'approved', city: '', created_at: '2020-03-01T00:00:00Z' };
 const saved = {
  products: [
   { id: 'chicken-empty', category: '鸡', name: '白羽鸡', state: '鲜品', spec: '白条整鸡 · 1–1.5 kg/只' },
   { id: 'goose-has', category: '鹅', name: '白条鹅', state: '冻品', spec: '整鹅 · 3–4 kg/只' },
  ],
  quotes: [{ ...base, id: 'g1', product_id: 'goose-has', supplier: '甲', province: '广东', price: 18.5, quoted_on: today, valid_until: addMonths(today, 2), notes: '' }],
  leads: [], audit: [], deletionRequests: [],
 };
 const app = stubDom('#overview', { storage: { [DATA_KEY]: JSON.stringify(saved) } });
 await import('../src/app.js?route=chart-default-with-sample');
 assert.match(app.innerHTML, /均价走势 <small>白条鹅 · 冻品/, '默认应落在真有样本的产品上，而不是列表第一个');
 assert.match(app.innerHTML, /<svg class="chart"/, '有样本时应画出走势图');
 assert.doesNotMatch(app.innerHTML, /最近 7 天没有可用样本/);
});

test('窗口内报价全是待核实规格时，均价走势要说明是规格原因，而不是笼统的「暂无」', async () => {
 const today = dayString();
 const base = { basis: 'factory', source: 'engine', source_name: '测试来源', source_url: '', min_order: '', freight: null, status: 'approved', city: '', created_at: '2020-03-01T00:00:00Z' };
 const saved = {
  products: [
   { id: 'unverified-goose', category: '鹅', name: '其他冻品', state: '冻品', spec: '冻品 · 规格待核实' },
  ],
  quotes: [
   { ...base, id: 'u1', product_id: 'unverified-goose', supplier: '甲', province: '河南', price: 11.6, quoted_on: today, valid_until: addMonths(today, 2), notes: '' },
   { ...base, id: 'u2', product_id: 'unverified-goose', supplier: '乙', province: '河南', price: 16.8, quoted_on: today, valid_until: addMonths(today, 2), notes: '' },
  ],
  leads: [], audit: [], deletionRequests: [],
 };
 const app = stubDom('#overview', { storage: { [DATA_KEY]: JSON.stringify(saved) } });
 await import('../src/app.js?route=chart-empty-unverified-spec');
 assert.match(app.innerHTML, /最近 7 天没有可用样本/);
 assert.match(app.innerHTML, /2 条报价规格为「待核实」/, '应指出是规格待核实挡住了统计');
 assert.doesNotMatch(app.innerHTML, /暂无有效报价，录入后即可查看走势/, '旧的含糊提示应被替换');
});

test('手动选到没有样本的产品时，空图给出可一键切换到有样本产品的入口', async () => {
 const today = dayString();
 const base = { basis: 'factory', source: 'engine', source_name: '测试来源', source_url: '', min_order: '', freight: null, status: 'approved', city: '', created_at: '2020-03-01T00:00:00Z' };
 const saved = {
  products: [
   { id: 'goose-old', category: '鹅', name: '白条鹅', state: '冻品', spec: '整鹅 · 3–4 kg/只' },
   { id: 'goose-live', category: '鹅', name: '白条鹅', state: '鲜品', spec: '整鹅 · 2–3 kg/只' },
  ],
  quotes: [
   { ...base, id: 'o1', product_id: 'goose-old', supplier: '甲', province: '广东', price: 18.5, quoted_on: shiftDay(today, -13), valid_until: shiftDay(today, -1), notes: '' },
   { ...base, id: 'o2', product_id: 'goose-live', supplier: '乙', province: '广东', price: 20.2, quoted_on: today, valid_until: addMonths(today, 2), notes: '' },
  ],
  leads: [], audit: [], deletionRequests: [],
 };
 const app = stubDom('#overview', { storage: { [DATA_KEY]: JSON.stringify(saved) } });
 await import('../src/app.js?route=chart-empty-switch');
 assert.match(app.innerHTML, /均价走势 <small>白条鹅 · 鲜品/, '首次进入应自动落在有样本的产品上');
 app.__change({ filter: 'product' }, 'goose-old');
 assert.match(app.innerHTML, /最近 7 天没有可用样本/, '手动选到空产品应给出解释');
 assert.match(app.innerHTML, /最近一次入库是/);
 assert.match(app.innerHTML, /data-pick="goose-live"/, '应给出有样本产品的一键切换入口');
});

// 2026-11-28 用户反馈「只是找到了肉交所的数据」：惠农网 108 条、顺企网 6 条其实早已在库里，
// 但肉交所一家占了九成且都有发布日期，其余来源被挤到几十页之后。来源筛选就是解决这个。
test('线索可按来源筛选，肉交所的多个子源合并成一条', async () => {
  const base = { kind: 'supply', status: 'pending', fetched_at: '2026-11-27T00:00:00Z', published_on: null, url: 'https://example.com/x', region_text: '郑州', details: '' };
  const discovery = {
    fetched_at: '2026-11-27T21:09:54Z',
    runs: [],
    items: [
      { ...base, id: 'a1', source_id: 'roujiaosuo', source_name: '肉交所', title: '肉交所白条鹅甲', price_text: '11.00元/公斤' },
      { ...base, id: 'a2', source_id: 'roujiaosuo_cats', source_name: '肉交所·四品类', title: '肉交所白条鹅乙', price_text: '11.20元/公斤' },
      { ...base, id: 'b1', source_id: 'cnhnb', source_name: '惠农网', title: '惠农白条鹅', price_text: '8.21元/斤' },
      { ...base, id: 'c1', source_id: 'qiye11467', source_name: '顺企网', title: '顺企白条鹅', price_text: '9800.00元/吨' },
    ],
  };
  const app = stubDom('#settings', { discovery });
  await import('../src/app.js?route=lead-source-filter');

  assert.match(app.innerHTML, /data-filter="leadSource"/, '线索筛选组里应有来源下拉');
  assert.match(app.innerHTML, /肉交所（2）/, '肉交所的两个子源应合并计数');
  assert.match(app.innerHTML, /惠农网（1）/);
  assert.match(app.innerHTML, /顺企网（1）/);

  const rows = () => app.innerHTML.slice(app.innerHTML.indexOf('<tbody>') + 7, app.innerHTML.indexOf('</tbody>'));
  app.__change({ filter: 'leadSource' }, 'cnhnb');
  assert.match(rows(), /惠农白条鹅/, '切到惠农网后应只剩惠农网的线索');
  assert.doesNotMatch(rows(), /肉交所白条鹅/, '其他来源的线索不应再出现');
  assert.doesNotMatch(rows(), /顺企白条鹅/);
});

// 2026-11-28 用户要求：打开「自动采集线索」默认就看能核价的那批，不用每次先切一次筛选。
test('数据中心默认只列「可核实入库」的线索，行情与资讯需手动切回', async () => {
  const app = stubDom('#settings');
  await import('../src/app.js?route=lead-use-default');
  const rows = () => app.innerHTML.slice(app.innerHTML.indexOf('<tbody>') + 7, app.innerHTML.indexOf('</tbody>'));

  assert.match(app.innerHTML, /<option value="convertible" selected>可核实入库/, '处理方式下拉应默认选中「可核实入库」');
  assert.match(rows(), /白条鹅（净膛）/, '供货线索应照常列出');
  assert.doesNotMatch(rows(), /全国肉鸡/, '默认不列行情均价');
  assert.doesNotMatch(rows(), /畜产品价格监测周报/, '默认不列行业资讯');
  assert.equal(rows().split('<tr').length - 1, 8, '快照里的 8 条供货线索应全部可见');

  // 主动切到不能核价的类型时，默认的处理方式不能把结果清空
  app.__click({ leadKind: 'market' });
  assert.match(rows(), /全国肉鸡/, '点「行情均价」应真能看到行情线索，而不是被处理方式筛成空表');

  app.__click({ leadKind: '' });
  app.__change({ filter: 'leadUse' }, '');
  assert.match(rows(), /畜产品价格监测周报/, '把处理方式改成全部后，资讯也应出现');
});

test('默认筛选下空表时给出改回「全部处理方式」的提示，而不是只说没有线索', async () => {
  const base = { kind: 'market', status: 'pending', fetched_at: '2026-11-27T00:00:00Z', published_on: null, url: 'https://example.com/m', region_text: '全国', details: '', price_text: '见原文' };
  const discovery = { fetched_at: '2026-11-27T00:00:00Z', runs: [], items: [{ ...base, id: 'm1', source_id: 'roujiaosuo', source_name: '肉交所', title: '全国毛鸡参考价' }] };
  const app = stubDom('#settings', { discovery });
  await import('../src/app.js?route=lead-use-empty');
  assert.match(app.innerHTML, /当前只看「可核实入库」/, '空表时应告诉用户可以改回全部处理方式');
});

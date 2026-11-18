import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settingsLock } from '../src/settings-lock.js';
import { accessLock } from '../src/access-lock.js';
import { config } from '../config.js';
import { dayString, addMonths } from '../src/core.js';

// 本机模式的数据键名，由 config.localTrial 决定；用于预置「已入库」等历史状态。
const DATA_KEY = config.localTrial ? 'hqt-trial-data-v2' : 'hqt-data-v2';

const snapshot = JSON.parse(readFileSync(new URL('./fixtures/leads.json', import.meta.url), 'utf8'));

// 最小 DOM 桩：只验证模块能完整启动、4 个 hash 页面都能渲染出正确结构。
function stubDom(hash, { unlocked = true, data = snapshot, storage = {} } = {}) {
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
  globalThis.fetch = async () => ({ ok: true, json: async () => data });
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
  ['overview', ['参考范围', '产品参考均价', '导出数据', '录入报价']],
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
  assert.match(bar, /data-action="lock-settings"/, '锁定按钮应在栏目行内');
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
  app.__click({ chart: 'goose-a' });
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

test('总览默认只显示鹅、鸡、鸭，其余品类收进标签；均价走势排在产品参考均价之前', async () => {
  const storage = { [DATA_KEY]: JSON.stringify({
    products: [
      { id: 'goose', category: '鹅', name: '白条鹅', state: '冻品', spec: '3-4 斤/只' },
      { id: 'chicken', category: '鸡', name: '清远鸡', state: '冻品', spec: '2-3 斤/只' },
      { id: 'duck', category: '鸭', name: '白条鸭', state: '冻品', spec: '3 斤/只' },
      { id: 'lamb', category: '羊', name: '羊肉', state: '鲜品', spec: '胴体' },
      { id: 'egg', category: '蛋品', name: '鲜鸡蛋', state: '鲜品', spec: '30 斤/箱' },
    ],
    quotes: [],
  }) };
  const app = stubDom('#overview', { storage });
  await import('../src/app.js?route=overview-core');
  const html = app.innerHTML;

  // 走势在参考均价之前
  const chartAt = html.indexOf('均价走势');
  const panelAt = html.indexOf('产品参考均价');
  assert.ok(chartAt > 0 && panelAt > 0, '两个板块都应存在');
  assert.ok(chartAt < panelAt, '均价走势应排在产品参考均价之前');
  const cardsAt = html.indexOf('<div class="cards">');
  assert.ok(chartAt < cardsAt && cardsAt < panelAt, '顺序应为：筛选 → 均价走势 → 品类卡片 → 产品参考均价');

  // 卡片区只放主力三类
  const cards = html.slice(html.indexOf('<div class="cards">'), panelAt);
  assert.match(cards, /白条鹅/);
  assert.match(cards, /清远鸡/);
  assert.match(cards, /白条鸭/);
  assert.doesNotMatch(cards, /羊肉/, '羊默认不进卡片');
  assert.doesNotMatch(cards, /鲜鸡蛋/, '蛋品默认不进卡片');

  // 表格默认也只列主力三类
  const table = html.slice(panelAt);
  assert.doesNotMatch(table, /羊肉/, '羊默认不进明细表');
  assert.doesNotMatch(table, /鲜鸡蛋/, '蛋品默认不进明细表');

  // 标签：常用 / 全部 / 其余品类各一个，主力三类不再重复占位
  assert.match(html, /data-category=""[^>]*>常用</);
  assert.match(html, /data-category="\*"[^>]*>全部</);
  assert.match(html, /data-category="羊"[^>]*>羊</);
  assert.doesNotMatch(html, /data-category="鸡"/, '鸡属于常用三品类，不再单独成标签');

  // 点「羊」能看到羊；点「全部」能看到所有品类
  app.__click({ category: '羊' });
  assert.match(app.innerHTML, /羊肉/, '选中羊后应显示羊的规格');
  app.__click({ category: '*' });
  assert.match(app.innerHTML, /羊肉/, '全部视图应包含羊');
  assert.match(app.innerHTML, /鲜鸡蛋/, '全部视图应包含蛋品');
});

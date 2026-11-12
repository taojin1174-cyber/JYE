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
  ['settings', ['自动采集线索', '已处理', '数据中心', '基础设置']],
  ['settings/general', ['管理品类', '导入备份', '此设备（未上传）', '产品库']],
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

test('基础设置页：四个面板是可折叠卡片，产品库带删除入口', async () => {
  const app = stubDom('#settings/general');
  await import('../src/app.js?route=settings-fold');
  const html = app.innerHTML;
  const folds = html.match(/<details class="panel fold"/g) || [];
  assert.equal(folds.length, 4, '产品库/数据来源/统计口径/团队与访问都应是折叠卡片');
  assert.ok(!/<section class="panel">/.test(html), '基础设置不应再有不可折叠的面板');
  assert.match(html, /data-delete-product="/, '产品库应提供删除按钮');
  assert.match(html, /data-action="add-product"/, '产品库应保留添加按钮');
});

test('数据设置页的导出与录入按钮并入栏目行，不再单独占一行', async () => {
  const app = stubDom('#settings');
  await import('../src/app.js?route=settings-tabs');
  const html = app.innerHTML;
  assert.doesNotMatch(html, /class="page-actions/, '不应再输出独立的操作行');
  const start = html.indexOf('<div class="settings-tabs">');
  assert.ok(start >= 0, '缺少栏目行');
  const bar = html.slice(start, start + 900);
  assert.match(bar, /data-settings-view="general"/, '栏目行应含基础设置');
  assert.match(bar, /data-settings-view="sources"/, '栏目行应含数据中心');
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

test('线索表可按发布日期升降序切换', async () => {
  const app = stubDom('#settings');
  await import('../src/app.js?route=lead-sort');
  const rows = () => {
    const start = app.innerHTML.indexOf('<tbody>') + 7;
    return app.innerHTML.slice(start, app.innerHTML.indexOf('</tbody>')).split('<tr').filter(Boolean);
  };
  // 默认从新到旧：表头可点，且首行是样本里最新的 2026-11-10。
  assert.match(app.innerHTML, /<th aria-sort="descending"><button class="th-sort"[^>]*data-lead-sort/, '发布日期列头应可点击排序');
  assert.match(rows()[0], /2026-11-10/, '默认应按发布日期从新到旧');
  // 点一次改为从早到晚：首行变成最早的 2026-11-07，表头状态跟着翻转。
  app.__click({ leadSort: '' });
  assert.match(app.innerHTML, /<th aria-sort="ascending">/, '点击后应切换为升序');
  assert.match(rows()[0], /2026-11-07/, '升序时最早的线索应排在第一行');
  // 再点一次回到从新到旧。
  app.__click({ leadSort: '' });
  assert.match(app.innerHTML, /<th aria-sort="descending">/, '再次点击应切回降序');
  assert.match(rows()[0], /2026-11-10/, '降序时最新的线索应排在第一行');
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

test('行情总览不展示猪卡片，线索页有「处理方式」下拉', async () => {
  const overview = stubDom('#overview');
  await import('../src/app.js?route=no-pig-card');
  const cards = overview.innerHTML.match(/<button class="price-card/g) || [];
  assert.equal(cards.length, 4, '去掉猪之后应只剩鸡鸭鹅羊四张卡');
  assert.doesNotMatch(overview.innerHTML, /category-dot">猪</);

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
  const app = stubDom('#overview', { storage });
  await import('../src/app.js?route=validity-note');
  const html = app.innerHTML;
  const price = html.match(/class="card-price"><strong>([\d.]+)<\/strong>/)?.[1];
  assert.equal(price, '10.00', '卡片均价只应统计未过期报价');
  assert.doesNotMatch(html, /过期供应商/, '过期报价不应进入最近入库');
  assert.match(html, /有效供应商/, '有效报价仍应出现在最近入库');
  assert.match(html, /card-valid/, '卡片底部应给出有效期提示');
  assert.match(html, /有效至 \d{2}-\d{2} · 剩 \d+ 天/, '提示里应写明到期日与剩余天数');
});

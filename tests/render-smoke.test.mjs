import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settingsLock } from '../src/settings-lock.js';
import { accessLock } from '../src/access-lock.js';
import { config } from '../config.js';

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

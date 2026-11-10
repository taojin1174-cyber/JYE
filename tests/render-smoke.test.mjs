import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settingsLock } from '../src/settings-lock.js';

const snapshot = JSON.parse(readFileSync(new URL('../data/discovery.json', import.meta.url), 'utf8'));

// 最小 DOM 桩：只验证模块能完整启动、4 个 hash 页面都能渲染出正确结构。
function stubDom(hash) {
  const memory = new Map();
  const unlockedKey = `hqt-settings:/:${settingsLock.verifier.slice(0, 16)}`;
  const session = new Map([[unlockedKey, 'unlocked']]);
  const el = () => ({ innerHTML: '', textContent: '', open: false, classList: { add() {}, remove() {} }, showModal() { this.open = true; }, close() { this.open = false; }, querySelector: () => null, addEventListener() {} });
  const app = el(), toast = el(), dialog = el();
  globalThis.document = {
    querySelector: sel => sel === '#app' ? app : sel === '#toast' ? toast : sel === '#dialog' ? dialog : null,
    addEventListener() {},
  };
  globalThis.window = { addEventListener() {} };
  globalThis.location = { hash, pathname: '/', reload() {} };
  globalThis.localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k) };
  globalThis.sessionStorage = { getItem: k => session.get(k) ?? null, setItem: (k, v) => session.set(k, v), removeItem: k => session.delete(k) };
  globalThis.fetch = async () => ({ ok: true, json: async () => snapshot });
  return app;
}

const cases = [
  ['overview', ['参考范围', '产品参考均价', '导出数据', '录入报价']],
  ['compare', ['供货报价', '全部产品规格']],
  ['review', ['待确认报价', '刷新记录']],
  ['settings', ['管理品类', '导入备份', '此设备（未上传）', '基础设置']],
  ['settings/sources', ['自动采集线索', '已处理', '核实入库']],
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

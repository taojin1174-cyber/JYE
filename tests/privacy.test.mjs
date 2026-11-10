import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildQuickQuote } from '../src/lead-quick.js';
import { validateQuote } from '../src/core.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const FORBIDDEN = /肉交所|roujiaosuo\.com|cnfowl\.com|禽网|畜牧总站/i;
const bodyOf = (src, name) => {
  const a = src.indexOf(`function ${name}(`);
  assert.ok(a >= 0, `找不到函数 ${name}`);
  const b = src.indexOf('\nfunction ', a + 1);
  return src.slice(a, b < 0 ? src.length : b);
};

test('前台四个页面不渲染来源、网址或渠道名', () => {
  const app = read('../src/app.js');
  for (const name of ['overview', 'recentPanel', 'compare', 'review']) {
    const body = bodyOf(app, name);
    assert.doesNotMatch(body, FORBIDDEN, `${name} 不应出现渠道名`);
    assert.doesNotMatch(body, /source_name|source_url|sourcePill|引擎采集|原始链接|查看原文/, `${name} 不应渲染来源字段`);
  }
});

test('报价详情的来源 / 原始链接只在解锁后显示，备注默认脱敏', () => {
  const body = bodyOf(read('../src/app.js'), 'quoteDetail');
  assert.match(body, /unlocked\(\)\?\[?'|unlocked\(\)\?field\('原始来源'/);
  assert.match(body, /safeNotes\(q\.notes\)/);
});

test('录入表单的来源字段只在解锁后渲染，未解锁用隐藏域保住校验', () => {
  const body = bodyOf(read('../src/app.js'), 'quoteForm');
  assert.match(body, /unlocked\(\)\?`\$\{field\('来源方式'/);
  assert.match(body, /type="hidden" name="source"/);
});

test('前台导出去掉来源与链接列，筛选导出仍需解锁', () => {
  const app = read('../src/app.js');
  assert.match(bodyOf(app, 'exportData'), /showOrigin=unlocked\(\)/);
  assert.match(bodyOf(app, 'exportSelected'), /isUnlocked\(\)\)throw new Error/);
  assert.match(bodyOf(app, 'exportForm'), /isUnlocked\(\)\)return/);
});

test('一键入库写入的供应商与备注不含渠道名，且报价仍合法', () => {
  const snapshot = JSON.parse(read('../data/discovery.json'));
  const lead = snapshot.items.find(i => String(i.details || '').includes('品类：清远鸡（冻品）'));
  const q = buildQuickQuote(lead, [], '2026-11-11');
  assert.equal(q.ok, true, q.reasons.join('；'));
  assert.doesNotMatch(q.quote.supplier, FORBIDDEN);
  assert.doesNotMatch(q.quote.notes, FORBIDDEN);
  assert.doesNotThrow(() => validateQuote(q.quote, [q.product], '2026-11-11'));
});

test('静态模块与页面元数据不泄露明文出处', () => {
  for (const f of ['../src/sources.js', '../src/lead-quick.js', '../src/lead-prefill.js', '../src/store.js', '../index.html']) {
    assert.doesNotMatch(read(f), FORBIDDEN, `${f} 不应含明文出处`);
  }
  assert.doesNotMatch(read('../scripts/roujiaosuo-build.mjs'), /肉交所|roujiaosuo\.com|登录肉交所/);
});

test('发布脚本必须脱敏快照、排除原始抓取数据并做发布前自检', () => {
  const b = read('../scripts/build.mjs');
  assert.match(b, /rm\('dist\/data'/);
  assert.match(b, /roujiaosuo-leads/);
  assert.match(b, /ref:enc/);
  assert.match(b, /scanLeak/);
  assert.match(b, /store\.js 运行时还原/);
});

test('发布快照的 ref 编码可无损还原，还原后仍能一键入库', () => {
  const snapshot = JSON.parse(read('../data/discovery.json'));
  const enc = v => Buffer.from(String(v ?? ''), 'utf8').toString('base64');
  const dec = v => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(v), c => c.charCodeAt(0))));
  const item = snapshot.items[0];
  const { url, source_name, details, source_id, ...rest } = item;
  const published = {
    ...rest, source_id: 'supply', source_name: '供货线索', url: '', details: '',
    ref: enc(JSON.stringify({ url, source_name, details, source_id })),
  };
  assert.doesNotMatch(JSON.stringify(published), FORBIDDEN);
  const restored = { ...published, ...dec(published.ref) };
  assert.equal(restored.url, item.url);
  assert.equal(restored.details, item.details);
  assert.equal(restored.source_name, item.source_name);
  assert.equal(restored.source_id, item.source_id);
  const q = buildQuickQuote(restored, [], '2026-11-11');
  assert.equal(q.ok, true, q.reasons.join('；'));
});

test('线索表页面必须有密码门且数据不以明文内嵌', () => {
  const html = read('../leads.html');
  assert.match(html, /id="gate-form"/);
  assert.match(html, /id="app" hidden/);
  assert.match(html, /type="text\/plain"/);
  assert.match(html, /verifyGate/);
  assert.doesNotMatch(html, /roujiaosuo\.com|肉交所/);
});

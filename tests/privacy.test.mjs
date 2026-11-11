import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
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
  const snapshot = JSON.parse(read('./fixtures/leads.json'));
  const lead = snapshot.items.find(i => String(i.details || '').includes('品类：清远鸡（冻品）'));
  const q = buildQuickQuote(lead, [], '2026-11-11');
  assert.equal(q.ok, true, q.reasons.join('；'));
  assert.doesNotMatch(q.quote.supplier, FORBIDDEN);
  assert.doesNotMatch(q.quote.notes, FORBIDDEN);
  // 有效期由录入人填写，补齐后才应通过校验。
  assert.doesNotThrow(() => validateQuote({ ...q.quote, valid_until: '2026-11-11' }, [q.product], '2026-11-11'));
});

test('静态模块与页面元数据不泄露明文出处', () => {
  for (const f of ['../src/sources.js', '../src/lead-quick.js', '../src/lead-prefill.js', '../src/store.js', '../index.html']) {
    assert.doesNotMatch(read(f), FORBIDDEN, `${f} 不应含明文出处`);
  }
  assert.doesNotMatch(read('../scripts/roujiaosuo-build.mjs'), /肉交所|roujiaosuo\.com|登录肉交所/);
});

test('构建脚本不把任何业务数据写进静态产物，并保留发布前泄漏自检', () => {
  const b = read('../scripts/build.mjs');
  assert.doesNotMatch(b, /dist\/data/, '不得生成数据目录');
  assert.doesNotMatch(b, /discovery\.json/, '不得读取采集快照并发布');
  assert.doesNotMatch(b, /leads\.html/, '不得复制线索页');
  assert.match(b, /rm\('dist'/, '每次构建应全量重建，避免旧数据残留');
  assert.match(b, /scanLeak/, '仍需保留发布前的明文泄漏自检');
});

test('线索数据的来源字段编码可无损还原', () => {
  const enc = v => Buffer.from(String(v ?? ''), 'utf8').toString('base64');
  const dec = v => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(v), c => c.charCodeAt(0))));
  const item = {
    id: 'x1', title: '白条鹅 5斤装', price_text: '9.80元/斤', region_text: '广东清远',
    published_on: '2026-11-10', category: '鹅', kind: 'supply', status: 'pending',
    url: 'https://example.com/item/1', source_name: '某来源', source_id: 'src-1', details: '详情文本',
  };
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

test('公开产物不得包含任何业务数据（线索页密码门只是前端校验，挡不住直接下载）', () => {
  // 静态页面的密码门在浏览器里校验，服务器仍会把整份数据发给未登录访客，
  // 所以线索页不再生成、数据不再预渲染进任何静态文件。
  for (const p of ['../leads.html', '../dist/leads.html', '../dist/data', '../dist/data/discovery.json']) {
    assert.equal(existsSync(new URL(p, import.meta.url)), false, `${p} 不应存在：会被未登录访客直接下载`);
  }
});

test('构建脚本不向静态产物写入业务数据', () => {
  const build = read('../scripts/build.mjs');
  assert.doesNotMatch(build, /leads\.html/, '构建不得复制线索页');
  assert.doesNotMatch(build, /dist\/data/, '构建不得生成数据目录');
  const gen = read('../scripts/roujiaosuo-build.mjs');
  assert.match(gen, /--with-page/, '线索页只能在显式加参数时生成到本地');
});

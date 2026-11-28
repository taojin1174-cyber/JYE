import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildQuickQuote } from '../src/lead-quick.js';
import { validateQuote, dayString } from '../src/core.js';

const TODAY = '2026-11-10';
const snapshot = JSON.parse(readFileSync(new URL('./fixtures/leads.json', import.meta.url), 'utf8'));
const sample = cat => snapshot.items.find(i => String(i.details || '').includes(`品类：${cat}（冻品）`));
const lead = overrides => ({ ...sample('清远鸡'), ...overrides });

test('真实线索可一键组装成合法报价，且价格 / 地区 / 来源均来自原文', () => {
  const q = buildQuickQuote(lead(), [], TODAY);
  assert.equal(q.ok, true, q.reasons.join('；'));
  assert.equal(q.quote.quoted_on, TODAY);
  // 有效期不再由系统预设，必须由录入人当场填写。
  assert.equal(q.quote.valid_until, '');
  assert.throws(() => validateQuote(q.quote, [q.product], TODAY), /有效期/);
  assert.doesNotThrow(() => validateQuote({ ...q.quote, valid_until: TODAY }, [q.product], TODAY));
  assert.equal(q.quote.price, 12.9);
  assert.equal(q.quote.province, '河南');
  assert.equal(q.quote.city, '濮阳市');
  assert.equal(q.quote.status, 'approved');
  assert.equal(q.quote.source, 'engine');
  assert.equal(q.quote.collection_item_id, lead().id);
  assert.equal(q.quote.source_url, lead().url);
});

test('四个品类各自归到固定产品规格，同类线索复用同一规格', () => {
  const ids = ['清远鸡', '白条鹅', '清远麻鸡', '鸽子'].map(c => buildQuickQuote(sample(c), [], TODAY).product.id);
  assert.equal(new Set(ids).size, 4);
  const a = buildQuickQuote(sample('清远鸡'), [], TODAY);
  const b = buildQuickQuote(sample('清远鸡'), [a.product], TODAY);
  assert.equal(b.product.id, a.product.id);
  assert.equal(b.rows[0].value.includes('规格待核实'), true);
});

test('元/斤按 ×2 折算，系统补全项明确写进备注', () => {
  const q = buildQuickQuote(lead({ price_text: '8 元/斤' }), [], TODAY);
  assert.equal(q.quote.price, 16);
  assert.match(q.quote.notes, /系统补全（可修改）/);
  assert.match(q.quote.notes, /税运条件未注明/);
  assert.match(q.quote.notes, /不是起订量/);
});

test('区间价 / 面议不能一键入库，需走完整表单', () => {
  for (const price_text of ['面议', '12-14 元/公斤', '']) {
    const q = buildQuickQuote(lead({ price_text }), [], TODAY);
    assert.equal(q.ok, false);
    assert.equal(q.quote.price, '');
    assert.match(q.reasons.join(''), /单价/);
  }
});

test('地区匹配不到省份时明确拦截，不静默写入空省份', () => {
  const q = buildQuickQuote(lead({ region_text: '境外某地' }), [], TODAY);
  assert.equal(q.ok, false);
  assert.match(q.reasons.join(''), /省份/);
});

test('历史发布信息标出天数，报价日仍取核实当天', () => {
  const q = buildQuickQuote(lead({ published_on: '2016-05-01' }), [], TODAY);
  assert.equal(q.quote.quoted_on, TODAY);
  assert.ok(q.staleDays > 30);
  assert.match(q.quote.notes, /2016-05-01/);
});

test('有效期不预设，缺了就不能入库', () => {
  const q = buildQuickQuote(lead(), [], dayString());
  assert.equal(q.quote.valid_until, '');
  assert.throws(() => validateQuote(q.quote, [q.product]), /有效期/);
  assert.doesNotThrow(() => validateQuote({ ...q.quote, valid_until: dayString() }, [q.product]));
});

// 2026-11-28 用户反馈：采购比价里筛选「鹅」，产品名显示「其他冻品」，鸭 / 鸡 / 牛还被并进同一条产品。
// 根因是旧兜底把产品 id 写死成 frozen-other、名称写死成「其他冻品」。以下四条锁住按品类归类。
const withCat = (cat, extra = '') => lead({ category: '', title: cat, details: `品类：${cat}（冻品）；联系人：黄老板；电话：131****0003；规格/单个重量：待核实；原文货量：3000 公斤；鲜冻线索：冻品线索${extra}` });

test('品类能认出来时按品类归到规范产品，不再落到「其他冻品」', () => {
  const cases = [['老鹅', '鹅', '白条鹅'], ['一级白条鸭', '鸭', '白条鸭'], ['二级三黄鸡', '鸡', '白条鸡'], ['牛肉', '牛', '牛肉']];
  for (const [cat, category, name] of cases) {
    const p = buildQuickQuote(withCat(cat), [], TODAY).product;
    assert.equal(p.category, category, `${cat} 应归到 ${category}`);
    assert.equal(p.name, name, `${cat} 产品名应是 ${name}`);
    assert.notEqual(p.name, '其他冻品');
  }
});

test('不同品类不会共用同一条产品，避免鸭 / 鸡 / 牛的报价串到鹅下面', () => {
  const ids = ['老鹅', '一级白条鸭', '二级三黄鸡', '牛肉'].map(c => buildQuickQuote(withCat(c), [], TODAY).product.id);
  assert.equal(new Set(ids).size, 4, `四个品类应各自一条产品，实际 ${ids.join(' / ')}`);
  assert.equal(ids.includes('frozen-other'), false);
});

test('库里已有同品类同鲜冻状态的产品时直接复用，不重复新建', () => {
  const products = [{ id: 'frozen-white-goose', category: '鹅', name: '白条鹅', state: '冻品', spec: '冻品 · 规格待核实' }];
  const p = buildQuickQuote(withCat('老鹅'), products, TODAY).product;
  assert.equal(p.id, 'frozen-white-goose');
});

test('真判断不出品类时用原文品类命名并带品类后缀，不再是一句笼统的「其他冻品」', () => {
  const a = buildQuickQuote(withCat('冷冻拼箱'), [], TODAY).product;
  const b = buildQuickQuote(withCat('鸡蛋'), [], TODAY).product;
  assert.equal(a.name, '冷冻拼箱');
  assert.equal(b.name, '鸡蛋');
  assert.notEqual(a.id, b.id, '不同兜底品类不能共用同一个产品 id');
});

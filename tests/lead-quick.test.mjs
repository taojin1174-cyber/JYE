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

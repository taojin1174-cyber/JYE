import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildQuickQuote } from '../src/lead-quick.js';
import { validateQuote } from '../src/core.js';

const TODAY = '2026-11-10';
const snapshot = JSON.parse(readFileSync(new URL('../data/discovery.json', import.meta.url), 'utf8'));

test('一键确认入库：写库、直接生效、线索标记已转报价、重复入库被拦截', async () => {
  const memory = new Map();
  globalThis.localStorage = { getItem: k => memory.get(k) || null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k) };
  globalThis.fetch = async () => ({ ok: true, json: async () => snapshot });
  const { store } = await import('../src/store.js');
  let data = await store.init();
  assert.equal(data.leads.length, snapshot.items.length);
  assert.equal(data.quotes.length, 0);

  const lead = data.leads.find(l => String(l.details || '').includes('品类：清远鸡（冻品）'));
  const q = buildQuickQuote(lead, data.products, TODAY);
  assert.equal(q.ok, true, q.reasons.join('；'));
  const quote = { ...q.quote, id: 'quick-test-1' };
  validateQuote(quote, [...data.products, q.product], TODAY);
  if (!data.products.some(p => p.id === q.product.id)) data = await store.addProduct(q.product);
  await store.saveQuote(quote);
  data = await store.reload();

  assert.equal(data.quotes.length, 1);
  assert.equal(data.quotes[0].status, 'approved');
  assert.equal(data.quotes[0].collection_item_id, lead.id);
  assert.equal(data.quotes[0].product_id, q.product.id);
  assert.equal(data.leads.find(l => l.id === lead.id).status, 'converted');
  assert.equal(data.products.some(p => p.id === q.product.id), true);
  assert.match(data.quotes[0].notes, /系统补全（可修改）/);
  await assert.rejects(() => store.saveQuote({ ...q.quote, id: 'quick-test-2' }), /已经生成报价/);
});

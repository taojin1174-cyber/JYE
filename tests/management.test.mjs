import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildQuickQuote } from '../src/lead-quick.js';

const snapshot = JSON.parse(readFileSync(new URL('./fixtures/leads.json', import.meta.url), 'utf8'));
const HANDLED = new Set(['converted', 'dismissed', 'deleted']);

function setup() {
  const memory = new Map();
  globalThis.localStorage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: key => memory.delete(key),
  };
  globalThis.fetch = async () => ({ ok: true, json: async () => snapshot });
  return memory;
}

const draftQuote = (id, productId) => ({
  id, product_id: productId, supplier: '测试供应商', province: '广东', city: '', price: 12.5,
  basis: 'factory', source: 'manual', source_name: '', source_url: '', quoted_on: '2026-11-11',
  valid_until: '2026-11-18', min_order: '', freight: null, notes: '', status: 'approved',
});

test('已入库 / 忽略 / 删除的线索退出待审列表，删除状态在重新加载与采集重写后仍保留', async () => {
  setup();
  const { store } = await import('../src/store.js');
  let data = await store.init();
  const lead = data.leads[0];

  data = await store.setLeadStatus(lead.id, 'converted');
  assert.equal(data.leads.find(l => l.id === lead.id).status, 'converted');
  assert.ok(data.leads.filter(l => !HANDLED.has(l.status)).every(l => l.id !== lead.id));

  data = await store.deleteLead(lead.id);
  assert.equal(data.leads.find(l => l.id === lead.id).status, 'deleted');

  data = await store.init(); // 模拟刷新页面：采集快照会重新合并
  assert.equal(data.leads.find(l => l.id === lead.id).status, 'deleted');
  assert.equal(data.leads.length, snapshot.items.length);

  data = await store.setLeadStatus(lead.id, 'pending');
  assert.equal(data.leads.find(l => l.id === lead.id).status, 'pending');
});

test('撤销入库删除关联报价并把线索放回待审，重复入库不再被拦', async () => {
  setup();
  const { store } = await import('../src/store.js');
  let data = await store.init();
  const lead = data.leads.find(l => String(l.details || '').includes('品类：清远鸡（冻品）'));
  const quick = buildQuickQuote(lead, data.products, '2026-11-11');
  assert.equal(quick.ok, true, quick.reasons.join('；'));
  if (!data.products.some(p => p.id === quick.product.id)) data = await store.addProduct(quick.product);

  data = await store.saveQuote({ ...quick.quote, id: 'undo-test-1' });
  assert.equal(data.quotes.length, 1);
  assert.equal(data.leads.find(l => l.id === lead.id).status, 'converted');

  data = await store.undoLeadQuote(lead.id);
  assert.equal(data.quotes.length, 0);
  assert.equal(data.leads.find(l => l.id === lead.id).status, 'pending');
  await assert.doesNotReject(() => store.saveQuote({ ...quick.quote, id: 'undo-test-2' }));
});

test('核价品类可停用 / 改名 / 删除 / 恢复，有报价的品类不允许删除', async () => {
  setup();
  const { store } = await import('../src/store.js');
  let data = await store.init();

  data = await store.toggleCategory('羊', true);
  assert.ok(data.prefs.disabledCategories.includes('羊'));
  data = await store.renameCategory('羊', '羊肉类');
  assert.ok(data.prefs.disabledCategories.includes('羊肉类'));
  assert.ok(!data.prefs.disabledCategories.includes('羊'));
  assert.ok(data.products.some(p => p.category === '羊肉类'));

  data = await store.renameCategory('鸡', '家禽');
  assert.ok(data.products.some(p => p.category === '家禽'));
  assert.ok(!data.products.some(p => p.category === '鸡'));
  assert.equal(data.products.length, 10);

  data = await store.deleteCategory('牛'); // 无规格的内置品类
  assert.ok(data.prefs.deletedCategories.includes('牛'));
  data = await store.restoreCategory('牛');
  assert.ok(!data.prefs.deletedCategories.includes('牛'));

  data = await store.saveQuote(draftQuote('cat-test-1', 'pig-fresh'));
  assert.equal(data.quotes.length, 1);
  await assert.rejects(() => store.deleteCategory('猪'), /已有报价/);
  assert.ok(data.products.some(p => p.category === '猪'));
});

test('完整备份可在另一设备导入，报价与品类偏好一并恢复', async () => {
  const memory = setup();
  const { store } = await import('../src/store.js');
  let data = await store.init();
  data = await store.saveQuote(draftQuote('backup-test-1', 'chicken-fresh'));
  data = await store.toggleCategory('羊', true);
  const backup = store.backup();
  assert.match(backup, /"version": 3/);

  memory.clear(); // 模拟另一台设备 / 手机首次打开
  data = await store.importBackup(backup);
  assert.equal(data.quotes.length, 1);
  assert.equal(data.quotes[0].id, 'backup-test-1');
  assert.ok(data.prefs.disabledCategories.includes('羊'));
  assert.equal(data.leads.length, snapshot.items.length);

  await assert.rejects(() => store.importBackup('{bad json'), /不是有效的 JSON/);
  await assert.rejects(() => store.importBackup('{"products":[]}'), /缺少产品库或报价数据/);
});

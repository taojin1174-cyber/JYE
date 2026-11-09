import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterExport } from '../src/export-filter.js';

test('导出按品类、规格、地区、日期、来源和状态筛选，排除删除记录', () => {
  const quote = { product_id:'goose', province:'广东', quoted_on:'2026-11-09', source:'manual', status:'approved' };
  const data = { products:[{ id:'goose', category:'鹅' }], quotes:[quote, { ...quote, deleted_at:'2026-11-09' }, { ...quote, province:'山东' }] };
  assert.deepEqual(filterExport(data, { category:'鹅', product:'goose', province:'广东', from:'2026-11-09', to:'2026-11-09', source:'manual', status:'approved' }), [quote]);
  assert.equal(filterExport(data, { category:'鸡' }).length, 0);
  assert.throws(() => filterExport(data, { from:'2026-11-10', to:'2026-11-09' }), /开始日期/);
});

test('线索导出包含跨品类标题，日期未知不会混入日期筛选结果', () => {
  const lead = { title:'鸡鸭鹅供货', category:'鸡', published_on:'2026-11-09' };
  const data = { products:[], leads:[lead, { title:'鹅供货', category:'鹅' }] };
  assert.deepEqual(filterExport(data, { type:'leads', category:'鹅', from:'2026-11-09', to:'2026-11-09' }), [lead]);
  assert.equal(filterExport(data, { type:'leads', category:'鹅' }).length, 2);
});

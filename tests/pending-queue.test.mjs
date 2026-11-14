import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectRows } from '../scripts/consume-pending.mjs';
import { FIELDS } from '../scripts/import-leads-to-cloud.mjs';

const lead = (id, extra = {}) => ({
  id,
  source_id: 'cnfowl_rouji',
  source_name: '禽网·肉鸡行情',
  title: '鸡翅中',
  url: 'https://example.com/a',
  price_text: '12.50 元/公斤',
  region_text: '广西南宁',
  published_on: '2026-11-14',
  category: '鸡',
  kind: 'market',
  details: '原文说明',
  status: 'pending',
  fetched_at: '2026-11-14T01:00:00.000Z',
  ...extra,
});

async function withQueue(files, run) {
  const dir = await mkdtemp(join(tmpdir(), 'hqt-queue-'));
  for (const [name, payload] of Object.entries(files)) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf8');
  }
  try {
    return await run(pathToFileURL(dir + '/'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('队列目录不存在时返回空结果，不报错', async () => {
  const { rows, files } = await collectRows(pathToFileURL(join(tmpdir(), 'hqt-not-exists-' + Date.now()) + '/'));
  assert.equal(rows.length, 0);
  assert.equal(files.length, 0);
});

test('多个队列文件合并，重复 id 只保留一条', async () => {
  await withQueue(
    {
      'leads-20261114-0900.json': { items: [lead('a'), lead('b')] },
      'leads-20261114-1500.json': { items: [lead('b'), lead('c')] },
    },
    async dir => {
      const { rows, files } = await collectRows(dir);
      assert.deepEqual(rows.map(r => r.id), ['a', 'b', 'c'], '按文件名顺序合并并去重');
      assert.equal(files.length, 2);
    },
  );
});

test('不完整记录被丢弃并计数，不影响同批其它线索', async () => {
  await withQueue(
    {
      'leads-20261114-0900.json': {
        items: [
          lead('ok'),
          lead('no-url', { url: '' }),
          lead('bad-kind', { kind: 'unknown' }),
          lead('no-title', { title: '' }),
        ],
      },
    },
    async dir => {
      const { rows, dropped } = await collectRows(dir);
      assert.deepEqual(rows.map(r => r.id), ['ok']);
      assert.equal(dropped, 3);
    },
  );
});

test('所有行的键集合完全一致，日期缺失填 null', async () => {
  await withQueue(
    {
      'leads-20261114-0900.json': {
        items: [lead('x'), lead('y', { published_on: '2026年11月' }), lead('z', { details: '', region_text: '' })],
      },
    },
    async dir => {
      const { rows } = await collectRows(dir);
      assert.equal(rows.length, 3);
      for (const row of rows) assert.deepEqual(Object.keys(row).sort(), [...FIELDS].sort());
      assert.equal(rows[1].published_on, null, '日期格式不合规应置空而不是原样写库');
    },
  );
});

test('损坏的队列文件被跳过，其余文件照常读取', async () => {
  await withQueue(
    {
      'leads-20261114-0800.json': '{ 这不是 JSON',
      'leads-20261114-0900.json': { items: [lead('good')] },
    },
    async dir => {
      const { rows } = await collectRows(dir);
      assert.deepEqual(rows.map(r => r.id), ['good']);
    },
  );
});

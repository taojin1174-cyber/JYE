import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummary } from '../scripts/source-summary.mjs';

const sources = [
  { id: 'cnfowl_rouji', name: '禽网·肉鸡行情', enabled: true },
  { id: 'soozhu_pig', name: '搜猪网·生猪出栏价', enabled: true },
  { id: 'nahs', name: '全国畜牧总站', enabled: true },
];
// 只关心肉交所段落时，源清单只列本轮实际涉及的源，避免「未执行」干扰断言。
const onlyFowl = [sources[0]];

test('全部来源正常：摘要列出每个源与条数，不产生警告', () => {
  const { markdown, warnings } = buildSummary({
    discovery: {
      fetched_at: '2026-11-18T02:08:11.017Z',
      runs: [
        { source_id: 'cnfowl_rouji', ok: true, count: 35 },
        { source_id: 'soozhu_pig', ok: true, count: 18 },
        { source_id: 'nahs', ok: true, count: 12 },
      ],
    },
    sources,
  });
  assert.match(markdown, /采集结果 · 2026-11-18 10:08（北京时间）/);
  assert.match(markdown, /3 个来源正常，共 65 条/);
  assert.match(markdown, /禽网·肉鸡行情 \| ✅ \| 35/);
  assert.match(markdown, /搜猪网·生猪出栏价 \| ✅ \| 18/);
  assert.equal(warnings.length, 0);
});

test('源返回 0 条不算成功：摘要标注可能改版并发出警告', () => {
  const { markdown, warnings } = buildSummary({
    discovery: {
      fetched_at: '2026-11-18T02:08:11.017Z',
      runs: [
        { source_id: 'cnfowl_rouji', ok: true, count: 35 },
        { source_id: 'soozhu_pig', ok: true, count: 0 },
        { source_id: 'nahs', ok: true, count: 0 },
      ],
    },
    sources,
  });
  // 0 条不进「正常」计数，否则正是过去那种「一片绿色却停更」的假象。
  assert.match(markdown, /1 个来源正常，共 35 条；2 个来源 0 条/);
  assert.equal((markdown.match(/⚠️ 0 条/g) || []).length, 2);
  assert.match(markdown, /可能页面改版或解析规则失效/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /2 个来源返回 0 条：搜猪网·生猪出栏价、全国畜牧总站/);
});

test('抓取失败与未执行分开标注，错误原因写进表格', () => {
  const { markdown, warnings } = buildSummary({
    discovery: {
      fetched_at: '2026-11-18T02:08:11.017Z',
      runs: [{ source_id: 'cnfowl_rouji', ok: false, error: '列表页未找到“肉鸡行情”文章' }],
    },
    sources,
  });
  assert.match(markdown, /❌ 失败 \| — \| 列表页未找到/);
  assert.match(markdown, /⏸ 未运行 \| — \| 本轮未执行，页面沿用上次数据/);
  assert.equal((markdown.match(/⏸ 未运行/g) || []).length, 2);
  assert.equal(warnings.length, 2, '失败与未执行应各发一条警告');
  assert.match(warnings.join('\n'), /1 个来源失败：禽网·肉鸡行情/);
  assert.match(warnings.join('\n'), /2 个来源本轮未执行/);
});

test('快照缺失时明确说明而不是输出空表', () => {
  const { markdown, warnings } = buildSummary({ discovery: null, sources });
  assert.match(markdown, /本次未生成快照/);
  assert.match(markdown, /抓取步骤在写快照之前就中断/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /所有来源均未更新/);
});

test('肉交所明细单独成段：品类条数与详情失败数都要给出', () => {
  const { markdown, warnings } = buildSummary({
    discovery: {
      fetched_at: '2026-11-18T02:08:11.017Z',
      runs: [{ source_id: 'cnfowl_rouji', ok: true, count: 35 }],
    },
    sources: onlyFowl,
    roujiaosuo: {
      stats: [
        { keyword: '清远鸡', total: 35 },
        { keyword: '白条鹅', total: 86 },
      ],
      rows: [
        { detail_ok: true },
        { detail_ok: false },
      ],
    },
    expectRoujiaosuo: true,
  });
  assert.match(markdown, /肉交所明细抓取.*2 条（清远鸡 35 · 白条鹅 86）/);
  assert.match(markdown, /详情页失败 1 条/);
  assert.equal(warnings.length, 0, '明细正常时不应报警');
});

test('云端没抓到肉交所时，即使其它源正常也要警告', () => {
  const { markdown, warnings } = buildSummary({
    discovery: {
      fetched_at: '2026-11-18T02:08:11.017Z',
      runs: [{ source_id: 'cnfowl_rouji', ok: true, count: 35 }],
    },
    sources: onlyFowl,
    roujiaosuo: null,
    expectRoujiaosuo: true,
  });
  assert.match(markdown, /本次未产出 `data\/roujiaosuo-leads\.json`/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /肉交所明细抓取未产出结果文件/);
});

test('错误信息里的竖线不会撑坏表格', () => {
  const { markdown } = buildSummary({
    discovery: {
      fetched_at: '2026-11-18T02:08:11.017Z',
      runs: [{ source_id: 'cnfowl_rouji', ok: false, error: 'HTTP 403 | blocked' }],
    },
    sources,
  });
  assert.match(markdown, /HTTP 403 \\\| blocked/);
});

test('本轮状态单独落盘时以它为准，不被后续步骤改写过的快照带偏', () => {
  // 真实故障：肉交所导入用 --only-frozen 把 discovery.json 的 runs 重写成只剩自己，
  // 摘要据此报「8 个来源本轮未执行」，真正的失败源反而看不见。
  const { markdown, warnings } = buildSummary({
    discovery: {
      fetched_at: '2026-11-18T02:08:11.017Z',
      runs: [{ source_id: 'roujiaosuo_cats', ok: true, count: 183 }],
    },
    runs: {
      fetched_at: '2026-11-18T02:07:00.000Z',
      runs: [
        { source_id: 'cnfowl_rouji', ok: true, count: 35 },
        { source_id: 'soozhu_pig', ok: false, error: 'HTTP 403' },
      ],
    },
    sources: [
      { id: 'cnfowl_rouji', name: '禽网·肉鸡行情', enabled: true },
      { id: 'soozhu_pig', name: '搜猪网·生猪出栏价', enabled: true },
    ],
  });
  assert.match(markdown, /采集结果 · 2026-11-18 10:07（北京时间）/, '时间应取本轮状态文件');
  assert.match(markdown, /禽网·肉鸡行情 \| ✅ \| 35/);
  assert.match(markdown, /搜猪网·生猪出栏价 \| ❌ 失败 \| — \| HTTP 403/);
  assert.doesNotMatch(markdown, /未运行/, '已抓取过的来源不得报成未执行');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /1 个来源失败：搜猪网·生猪出栏价/);
});

test('肉交所明细滞后时标出抓取时间，不让人误以为是本次结果', () => {
  const { markdown } = buildSummary({
    discovery: {
      fetched_at: '2026-11-18T02:08:11.017Z',
      runs: [{ source_id: 'cnfowl_rouji', ok: true, count: 35 }],
    },
    sources: onlyFowl,
    roujiaosuo: {
      fetched_at: '2026-11-17T10:00:00Z',
      stats: [{ keyword: '白条鹅', total: 86 }],
      rows: [{ detail_ok: true }],
    },
  });
  assert.match(markdown, /抓取于 11-17 18:00（非本次，抓取步骤可能未运行）/);
});

test('多个国内源失败时说明补抓链路，避免把常态当故障', () => {
  const { markdown, warnings } = buildSummary({
    discovery: {
      fetched_at: '2026-11-18T02:08:11.017Z',
      runs: [
        { source_id: 'cnfowl_rouji', ok: false, error: 'HTTP 403' },
        { source_id: 'soozhu_pig', ok: false, error: 'HTTP 403' },
      ],
    },
    sources: [sources[0], sources[1]],
  });
  assert.match(markdown, /对 GitHub 海外机房 IP 通常不可达，属于常态/);
  assert.match(markdown, /本机每日采集 → 仓库队列 → 云端入库/);
  assert.match(markdown, /本机整天未开机时，这些来源不会更新/);
  assert.equal(warnings.length, 1);
});

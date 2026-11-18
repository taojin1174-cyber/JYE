#!/usr/bin/env node
// 把「每个来源本次抓了多少条、哪个没抓到」写成 GitHub Actions 运行摘要。
//
// 起因：discovery.mjs 对单个来源失败是容忍处理（写进 runs 的 ok:false 后继续跑），
// 页面照常沿用上一版数据。原先只有「整步失败」才写摘要，于是出现两种盲区：
//   1. 某个来源返回 0 条（页面改版、解析规则失效），脚本不报错，全程绿色；
//   2. 一切正常时没有任何记录，无法确认「今天 8 个源是否都跑到了」。
// 现在改为每次运行都输出一张表，异常来源在摘要里带 ⚠️ / ❌，并额外发一条 warning 注解。
import { readFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const BADGE = { ok: '✅', empty: '⚠️ 0 条', fail: '❌ 失败', missing: '⏸ 未运行' };
const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const beijing = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
};

export function buildSummary({ discovery, runs = null, sources = [], roujiaosuo = null, expectRoujiaosuo = false }) {
  const lines = [];
  const warnings = [];

  // 优先用本轮单独落盘的来源状态；discovery.json 的 runs 会被后续导入步骤改写，不能作为唯一依据。
  const latestRuns = Array.isArray(runs) ? runs : Array.isArray(runs?.runs) ? runs.runs : null;
  const runList = latestRuns || (Array.isArray(discovery?.runs) ? discovery.runs : null);
  const stamp = (runs && !Array.isArray(runs) && runs.fetched_at) || discovery?.fetched_at;

  if (!runList) {
    lines.push('## 采集结果：本次未生成快照');
    lines.push('');
    lines.push('采集脚本没有产出 `data/discovery.json` 或 `data/discovery-runs.json`，说明抓取步骤在写快照之前就中断了。');
    lines.push('页面已沿用上一次成功快照的数据，请按上方失败步骤的日志排查。');
    return { markdown: lines.join('\n'), warnings: ['本次采集未生成快照，所有来源均未更新'] };
  }

  const byId = new Map(runList.map((run) => [run.source_id, run]));
  const nameOf = new Map(sources.map((source) => [source.id, source.name || source.id]));
  // 源清单里的启用项 + 本轮出现过但清单里没有的项，都要列出来，避免漏看。
  const ordered = [
    ...sources.filter((source) => source.enabled !== false).map((source) => source.id),
    ...runList.map((run) => run.source_id).filter((id) => !sources.some((source) => source.id === id)),
  ];

  const rows = [];
  const failed = [];
  const empty = [];
  const missing = [];
  let total = 0;
  let okCount = 0;

  for (const id of ordered) {
    const run = byId.get(id);
    const name = nameOf.get(id) || id;
    if (!run) {
      missing.push(name);
      rows.push(`| ${cell(name)} | ${BADGE.missing} | — | 本轮未执行，页面沿用上次数据 |`);
      continue;
    }
    if (!run.ok) {
      failed.push(name);
      rows.push(`| ${cell(name)} | ${BADGE.fail} | — | ${cell(run.error || '未记录原因').slice(0, 160)} |`);
      continue;
    }
    const count = Number(run.count) || 0;
    total += count;
    if (count > 0) {
      okCount += 1;
      rows.push(`| ${cell(name)} | ${BADGE.ok} | ${count} | |`);
    } else {
      empty.push(name);
      rows.push(`| ${cell(name)} | ${BADGE.empty} | 0 | 可能页面改版或解析规则失效，需人工检查 |`);
    }
  }

  const head = `## 采集结果 · ${beijing(stamp) || '时间未知'}（北京时间）`;
  const tally = [`${okCount} 个来源正常，共 ${total} 条`];
  if (empty.length) tally.push(`${empty.length} 个来源 0 条`);
  if (failed.length) tally.push(`${failed.length} 个来源失败`);
  if (missing.length) tally.push(`${missing.length} 个来源未执行`);

  lines.push(head, '', tally.join('；') + '。', '', '| 来源 | 状态 | 条数 | 说明 |', '| --- | --- | --- | --- |', ...rows);

  if (roujiaosuo) {
    const stats = Array.isArray(roujiaosuo.stats) ? roujiaosuo.stats : [];
    const detailFailed = (roujiaosuo.rows || []).filter((row) => row.detail_ok === false).length;
    const parts = stats.map((item) => `${item.keyword} ${item.total}`);
    // 明细是独立文件，本机不跑抓取时它会是上一次的结果，必须标出抓取时间。
    const fetchedAt = beijing(roujiaosuo.fetched_at);
    const lagHours = fetchedAt && stamp ? (Date.parse(stamp) - Date.parse(roujiaosuo.fetched_at)) / 3600e3 : 0;
    const timing = fetchedAt
      ? ` · 抓取于 ${fetchedAt.slice(5)}${lagHours > 3 ? '（非本次，抓取步骤可能未运行）' : ''}`
      : '';
    lines.push(
      '',
      `**肉交所明细抓取**：${roujiaosuo.rows ? roujiaosuo.rows.length : 0} 条（${parts.join(' · ') || '无品类统计'}）` +
        (detailFailed ? `；详情页失败 ${detailFailed} 条` : '；详情页全部成功') +
        timing,
    );
    if (!stats.length || !(roujiaosuo.rows || []).length) {
      warnings.push('肉交所四品类本次没有抓到明细，请检查 roujiaosuo-scrape 日志');
    }
  } else if (expectRoujiaosuo) {
    lines.push('', '**肉交所明细抓取**：本次未产出 `data/roujiaosuo-leads.json`，抓取步骤可能失败。');
    warnings.push('肉交所明细抓取未产出结果文件，请检查该步骤日志');
  }

  if (failed.length) warnings.push(`${failed.length} 个来源失败：${failed.join('、')}`);
  if (empty.length) warnings.push(`${empty.length} 个来源返回 0 条：${empty.join('、')}`);
  if (missing.length) warnings.push(`${missing.length} 个来源本轮未执行：${missing.join('、')}`);

  return { markdown: lines.join('\n'), warnings };
}

const readJson = async (relative) => {
  try {
    return JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'));
  } catch {
    return null;
  }
};

async function main() {
  const discoveryFile = await readJson('../data/discovery.json');
  const runsFile = await readJson('../data/discovery-runs.json');
  const sourceFile = await readJson('../collector/web-sources.json');
  const sources = (sourceFile?.sources || []).map((source) => ({
    id: source.id,
    name: source.name,
    enabled: source.enabled !== false,
  }));
  const roujiaosuo = await readJson('../data/roujiaosuo-leads.json');
  const { markdown, warnings } = buildSummary({
    discovery: discoveryFile,
    runs: runsFile,
    sources,
    roujiaosuo,
    expectRoujiaosuo: process.argv.includes('--expect-roujiaosuo'),
  });

  console.log(markdown);
  for (const warning of warnings) console.log(`::warning::${warning}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`摘要生成失败：${error.message}`);
    process.exitCode = 1;
  });
}

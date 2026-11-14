// 本机抓到的公开线索排进仓库队列，交给 GitHub Actions 写进云端。
//
// 为什么需要这一步：国内行情站（禽网系列等）对境外机房 IP 基本不通，
// Actions 每次都在这些源上超时；反过来本机连不上 *.supabase.co。
// 于是拆成两段——本机只负责抓，Actions 只负责写，仓库当中间传输带。
//
// 队列文件只保留公开字段（标题 / 价格 / 地区 / 原文链接），
// 供应商电话、联系人不落盘、不进仓库。肉交所由云端自己抓，不重复排。
//
// 用法：node scripts/queue-leads.mjs
import { readFile, writeFile, mkdir, readdir, unlink, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { FIELDS, pickLead } from './import-leads-to-cloud.mjs';

const SNAPSHOT = new URL('../data/discovery.json', import.meta.url);
const QUEUE_DIR = new URL('../data/pending/', import.meta.url);
// 已排过的线索 id 记在本机（data/* 已被忽略，不进仓库）。
// 线索 id 是内容哈希，同一条报价明天再抓还是同一个 id，
// 不记一下就会每天把同样的两百多条重新传一遍。
const SENT_DB = new URL('../data/queued-ids.json', import.meta.url);
const SENT_TTL_DAYS = 3;
// 云端自己抓得到的来源不必经本机转手，避免同一批线索两边重复排队。
// 肉交所的下游有 roujiaosuo / roujiaosuo_cats 等多个 id，按前缀判断。
const CLOUD_COVERED = /^roujiaosuo/;
const KEEP_DAYS = 7;

const stamp = (date = new Date()) => {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
};

async function loadSent() {
  if (!existsSync(SENT_DB)) return {};
  try {
    const raw = JSON.parse(await readFile(SENT_DB, 'utf8'));
    const cutoff = Date.now() - SENT_TTL_DAYS * 86400000;
    // 过期记录自动作废：万一某次推送没成功，过几天会重新排一次，不至于永久漏掉。
    return Object.fromEntries(Object.entries(raw).filter(([, ts]) => Number(ts) > cutoff));
  } catch {
    return {};
  }
}

async function saveSent(sent) {
  await writeFile(SENT_DB, JSON.stringify(sent), 'utf8');
}

async function pruneOld() {
  if (!existsSync(QUEUE_DIR)) return;
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  for (const name of await readdir(QUEUE_DIR)) {
    if (!name.endsWith('.json')) continue;
    const path = new URL(name, QUEUE_DIR);
    const info = await stat(path).catch(() => null);
    // 消费失败时文件会留下，超过一周才清，避免长期堆积在仓库里。
    if (info && info.mtimeMs < cutoff) await unlink(path).catch(() => {});
  }
}

async function main() {
  if (!existsSync(SNAPSHOT)) throw new Error('找不到 data/discovery.json，先跑一次采集');
  const snapshot = JSON.parse(await readFile(SNAPSHOT, 'utf8'));
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const sent = await loadSent();
  const candidates = items
    .filter(item => !CLOUD_COVERED.test(item.source_id || ''))
    .map(pickLead)
    .filter(Boolean);
  const queued = candidates
    .filter(row => !sent[row.id])
    .map(row => Object.fromEntries(FIELDS.map(field => [field, row[field] ?? (field === 'published_on' ? null : '')])));

  await pruneOld();

  if (!queued.length) {
    await saveSent(sent);
    console.log(`本次没有新增线索（${candidates.length} 条之前已排过，仍在等待入库）`);
    return;
  }

  await mkdir(QUEUE_DIR, { recursive: true });
  const file = new URL(`leads-${stamp()}.json`, QUEUE_DIR);
  await writeFile(file, `${JSON.stringify({ queued_at: new Date().toISOString(), count: queued.length, items: queued }, null, 1)}\n`, 'utf8');
  const now = Date.now();
  for (const row of queued) sent[row.id] = now;
  await saveSent(sent);

  const by = {};
  for (const row of queued) by[row.source_name] = (by[row.source_name] || 0) + 1;
  console.log(`已排队 ${queued.length} 条新增待入库线索 → data/pending/${file.pathname.split('/').pop()}`);
  console.log(`（另有 ${candidates.length - queued.length} 条此前已排过，跳过）`);
  for (const [name, count] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${name}：${count} 条`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});

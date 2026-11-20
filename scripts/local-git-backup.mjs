#!/usr/bin/env node
// 本地 Git 备份：固定 3 个槽位，循环覆盖，永不增长。
//
// 为什么是 bundle 而不是整目录复制：
//   git bundle 是 Git 官方备份格式，单文件、包含全部分支与标签，
//   恢复时 `git clone xxx.bundle` 即可，体积约为工作区的 1/5。
//
// 用法：
//   node scripts/local-git-backup.mjs
//   node scripts/local-git-backup.mjs --dir "D:/YPSP【2026】/【云端网站】/01-行情跳动/03-Git备份"
//   node scripts/local-git-backup.mjs --quiet
//
// 默认写到归档文件夹的 03-Git备份\，这样「01-行情跳动」这一个文件夹
// 就等于「源码 + 数据 + 完整 Git 历史」，换电脑只复制它。BASE 可用环境变量 ARCHIVE_ROOT 覆盖。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const SLOTS = 3;
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const quiet = argv.includes('--quiet');

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const repo = git(['rev-parse', '--show-toplevel']);
const label = opt('label', basename(repo));
const ARCHIVE_ROOT = process.env.ARCHIVE_ROOT || 'D:/YPSP【2026】/【云端网站】/01-行情跳动';
const root = resolve(opt('dir', `${ARCHIVE_ROOT}/03-Git备份`));

// ---- 先看有没有没提交的改动：bundle 只含已提交对象，未提交的会丢 ----
let dirty = '';
try {
  dirty = git(['status', '--porcelain'], repo);
} catch {
  dirty = '';
}

const branch = (() => {
  try {
    return git(['rev-parse', '--abbrev-ref', 'HEAD'], repo);
  } catch {
    return 'HEAD';
  }
})();
const commit = git(['rev-parse', '--short=7', 'HEAD'], repo);
const now = new Date();
const stamp = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
].join('') + '-' + [
  String(now.getHours()).padStart(2, '0'),
  String(now.getMinutes()).padStart(2, '0'),
  String(now.getSeconds()).padStart(2, '0'),
].join('');

mkdirSync(root, { recursive: true });

// ---- 选槽：优先空槽，其次最旧的槽 ----
const slots = Array.from({ length: SLOTS }, (_, i) => ({
  index: i + 1,
  dir: join(root, `slot-${i + 1}`),
}));

function slotScore(slot) {
  if (!existsSync(slot.dir)) return -1;
  const bundles = readdirSync(slot.dir).filter((f) => f.endsWith('.bundle'));
  if (!bundles.length) return -1;
  return Math.max(...bundles.map((f) => statSync(join(slot.dir, f)).mtimeMs));
}

const picked = slots
  .map((s) => ({ ...s, score: slotScore(s) }))
  .sort((a, b) => a.score - b.score || a.index - b.index)[0];

// ---- 覆盖目标槽 ----
if (existsSync(picked.dir)) rmSync(picked.dir, { recursive: true, force: true });
mkdirSync(picked.dir, { recursive: true });

const file = `${label}-${stamp}-${commit}.bundle`;
const target = join(picked.dir, file);
git(['bundle', 'create', target, '--all'], repo);

const mb = (statSync(target).size / 1024 / 1024).toFixed(1);

// ---- 重写清单 ----
function describe(slot) {
  if (!existsSync(slot.dir)) return '（空）';
  const bundles = readdirSync(slot.dir).filter((f) => f.endsWith('.bundle'));
  if (!bundles.length) return '（空）';
  const newest = bundles.sort(
    (a, b) => statSync(join(slot.dir, b)).mtimeMs - statSync(join(slot.dir, a)).mtimeMs,
  )[0];
  const st = statSync(join(slot.dir, newest));
  const m = newest.match(/-(\d{8}-\d{6})-([0-9a-f]{7})\.bundle$/);
  const when = m
    ? `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)} ${m[1].slice(9, 11)}:${m[1].slice(11, 13)}:${m[1].slice(13, 15)}`
    : '未知时间';
  return `${when}  @${m ? m[2] : '?'}  ${(st.size / 1024 / 1024).toFixed(1)} MB  ${newest}`;
}

const lines = [
  `${label} · 本地 Git 备份`,
  '',
  `固定 ${SLOTS} 个槽位，每次写入最旧的一个，永不增长。`,
  `备份根目录：${root}`,
  '',
  ...slots.map((s) => `slot-${s.index}  ${describe(s)}`),
  '',
  '恢复方式：',
  `  git clone "${join(root, `slot-${picked.index}`, file)}" 恢复目录`,
  '  cd 恢复目录 && git checkout main',
  '',
  '注意：bundle 只含已提交的 commit。备份前的未提交改动不会被保存。',
  '',
];

writeFileSync(join(root, 'MANIFEST.txt'), lines.join('\n'), 'utf8');

if (!quiet) {
  console.log(lines.join('\n'));
  if (dirty) {
    console.log(`⚠ 当前有未提交改动，以下内容不在备份里：`);
    console.log(dirty.split('\n').slice(0, 10).map((l) => '  ' + l).join('\n'));
  }
  console.log(`\n✅ 已写入 slot-${picked.index}：${file}（${mb} MB，${branch}@${commit}）`);
}

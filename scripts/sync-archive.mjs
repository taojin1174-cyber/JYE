#!/usr/bin/env node
// 把当前项目同步到换电脑用的归档目录（默认 D:\YPSP【2026】\【云端网站】\01-行情跳动\01-网站源码）。
//
// 用法：
//   npm run archive            覆盖式同步（不删除归档里多出来的文件）
//   npm run archive -- --prune  同时删除归档里已不存在的旧文件（谨慎）
//   npm run archive -- --to "D:\其它路径"
//
// 为什么需要这个脚本：
//   1. 归档目录靠 Qsync 同步到 NAS，换电脑时只带这一个文件夹；
//   2. Qsync 不同步以 "." 开头的文件，所以 .env 传不上去，必须额外生成一份
//      明文备份 `_密钥_换电脑用.txt`，否则新电脑缺密钥连不上数据库。
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TO = 'D:\\YPSP【2026】\\【云端网站】\\01-行情跳动\\01-网站源码';

const args = process.argv.slice(2);
const prune = args.includes('--prune');
const toIndex = args.indexOf('--to');
const TARGET = (toIndex >= 0 ? args[toIndex + 1] : process.env.ARCHIVE_DIR) || DEFAULT_TO;

// 只带走"要出现在 NAS 上、且能让网站直接跑起来"的东西。
const INCLUDE_DIRS = ['src', 'scripts', 'tests', 'collector', 'supabase', '.github'];
const INCLUDE_FILES = [
  'index.html', 'rescue.html', 'config.js', 'favicon.svg',
  'package.json', 'package-lock.json',
  'README.md', 'HANDOFF.md', '换电脑开工说明.md', 'AGENTS.md', 'CLAUDE.md', '启动本地预览.cmd',
  '.env', '.gitignore', '.gitattributes',
];
// 这些目录是运行环境或本机产物，传上去只会污染归档、还会冲掉 NAS 上 Linux 的可执行位。
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'artifacts', 'backups', 'deploy', '.workbuddy', 'data\\pending']);

const copied = [];
const skipped = [];

function skip(relPath) {
  const parts = relPath.split(sep);
  if (parts.some(part => SKIP_DIRS.has(part))) return true;
  if (/\.((log)|(tmp))$/i.test(relPath)) return true;
  if (/^server-(runtime|start)/i.test(parts[parts.length - 1])) return true;
  return false;
}

function copyTree(absSrc) {
  const rel = relative(ROOT, absSrc);
  if (skip(rel)) { skipped.push(rel); return; }
  const stat = statSync(absSrc);
  if (stat.isDirectory()) {
    for (const name of readdirSync(absSrc)) copyTree(join(absSrc, name));
    return;
  }
  const dest = join(TARGET, rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(absSrc, dest);
  copied.push(rel);
}

function main() {
  if (!existsSync(ROOT)) throw new Error('找不到项目根目录');
  mkdirSync(TARGET, { recursive: true });

  for (const dir of INCLUDE_DIRS) {
    const abs = join(ROOT, dir);
    if (existsSync(abs)) copyTree(abs);
  }
  for (const file of INCLUDE_FILES) {
    const abs = join(ROOT, file);
    if (existsSync(abs)) copyTree(abs);
  }

  // data 只带采集快照，仓库里的活跃数据库与本机临时队列不进归档。
  const dataDir = join(ROOT, 'data');
  if (existsSync(dataDir)) {
    for (const name of readdirSync(dataDir)) {
      if (name === 'pending') continue;
      if (/\.(json|csv)$/i.test(name)) copyTree(join(dataDir, name));
    }
  }

  // 密钥兜底：Qsync 跳过点文件，必须另存一份非点文件。
  const envPath = join(ROOT, '.env');
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split('\n').filter(line => line.trim());
    const body = `【密钥备份】行情跳动 —— 换电脑时需要这个文件
生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}

为什么单独有这一份：
  Qsync 默认不同步以 "." 开头的文件，所以源码里的 .env 传不到 NAS。
  换电脑时若只从 NAS 取资料，会缺 .env，网站连不上数据库。
  本文件就是它的明文备份。

怎么用：
  把下面几行原样复制进一个新文件，命名为 .env，放在网站源码根目录（和 config.js 同级）。

------------------------ 以下原样复制 ------------------------
${lines.join('\n')}
-------------------------------------------------------------------

安全提醒：
  · 这是数据库最高权限密钥，能绕过所有权限读写整个库
  · 不要转发、不要传公开网盘、不要贴到聊天里
  · 需要轮换时去 Supabase 后台 Project Settings → API Keys 重新生成，
    然后同时更新三处：本文件、电脑上的 .env、GitHub 仓库 Secrets
`;
    writeFileSync(join(TARGET, '_密钥_换电脑用.txt'), body, 'utf8');
    copied.push('_密钥_换电脑用.txt');
  } else {
    console.warn('⚠ 本机没有 .env，未生成密钥备份');
  }

  if (prune) {
    // 只删归档里存在、而源工程已不存在的文件，避免历史残留越攒越乱。
    const known = new Set(copied.map(p => p.split(sep).join('/')));
    walk(TARGET).forEach(rel => {
      const key = rel.split(sep).join('/');
      if (known.has(key)) return;
      if (key === '_密钥_换电脑用.txt') return;
      rmSync(join(TARGET, rel), { force: true });
      console.log('删除多余文件', rel);
    });
  }

  console.log(`\n归档完成 → ${TARGET}`);
  console.log(`复制 ${copied.length} 个文件，跳过 ${skipped.length} 项`);
  if (!prune) console.log('（保留归档中多出来的旧文件；要清理用 npm run archive -- --prune）');
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else out.push(relative(TARGET, abs));
  }
  return out;
}

main();

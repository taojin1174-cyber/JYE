#!/usr/bin/env node
/**
 * 开工自检 —— 换电脑、换 AI、隔几天再来，开工前跑这一条。
 *
 *   npm run check                 常规自检（会尝试比对远程，确认有没有落后/未推送）
 *   npm run check -- --no-fetch   网络差时跳过远程比对
 *
 * 只用 Node 内置模块，npm install 之前也能跑。
 * 不打印任何密钥内容，只检查键是否存在。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NO_FETCH = process.argv.includes('--no-fetch');
const REQUIRED_NODE = 22;
const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

const results = [];
const add = (level, label, hint = '') => results.push({ level, label, hint });

function git(args, { timeout = 15000 } = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  }).trim();
}
function gitRaw(args, { timeout = 15000 } = {}) {
  // 不能 trim：`git status --porcelain` 的首行以空格开头（" M file"），trim 会把状态位吃掉
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  });
}
function tryGit(args, opts) {
  try {
    return git(args, opts);
  } catch {
    return null;
  }
}
function tryGitRaw(args, opts) {
  try {
    return gitRaw(args, opts);
  } catch {
    return null;
  }
}

// ① 是不是在仓库里
const isRepo = existsSync(resolve(ROOT, '.git'));
add(
  isRepo ? 'ok' : 'fail',
  isRepo ? `项目目录 ${ROOT}` : `${ROOT} 不是 git 仓库`,
  isRepo ? '' : '确认工作区指向项目源码目录，不要指向归档副本'
);

// ② Node 版本
const major = Number(process.versions.node.split('.')[0]);
add(
  major >= REQUIRED_NODE ? 'ok' : 'fail',
  `Node ${process.version}`,
  major >= REQUIRED_NODE ? '' : `需要 Node ${REQUIRED_NODE}+，低版本跑测试会直接失败`
);

// ③ 依赖
const hasModules = existsSync(resolve(ROOT, 'node_modules'));
add(
  hasModules ? 'ok' : 'warn',
  hasModules ? '依赖已安装' : '依赖未安装（node_modules 不存在）',
  hasModules ? '' : '先跑 npm ci，约 1~2 分钟'
);

// ④ 云端密钥（只报键名，不读值）
const envPath = resolve(ROOT, '.env');
if (!existsSync(envPath)) {
  add('info', '没有 .env', '只改界面和样式不需要它；要跑采集入库、云端备份才要');
} else {
  const text = readFileSync(envPath, 'utf8');
  const missing = ENV_KEYS.filter(
    (key) => !new RegExp(`^\\s*${key}\\s*=\\s*\\S`, 'm').test(text)
  );
  add(
    missing.length ? 'warn' : 'ok',
    missing.length ? `.env 缺 ${missing.join('、')}` : '.env 两个键都在',
    missing.length ? '缺了就写不进云端数据库，界面开发不受影响' : ''
  );
}

// ⑤ 当前提交与工作区
let branch = null;
let dirty = [];
if (isRepo) {
  branch = tryGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = tryGit(['log', '-1', '--pretty=%h %s']);
  add('info', `HEAD ${head || '读取失败'}`, branch ? `分支 ${branch}` : '');

  dirty = (tryGitRaw(['status', '--porcelain']) || '').split('\n').filter(Boolean);
  if (dirty.length) {
    const shown = dirty.slice(0, 3).map((line) => line.slice(3).trim()).join('、');
    add(
      'warn',
      `有 ${dirty.length} 个文件未提交`,
      `${shown}${dirty.length > 3 ? ' 等' : ''} —— 确认是不是你要保留的改动`
    );
  } else {
    add('ok', '工作区干净', '');
  }
}

// ⑥ 与远程的差异
if (isRepo) {
  let fetched = false;
  if (!NO_FETCH) {
    try {
      git(['fetch', '--quiet', 'origin', 'main'], { timeout: 20000 });
      fetched = true;
    } catch {
      fetched = false;
    }
  }

  if (fetched) {
    const counts = tryGit(['rev-list', '--left-right', '--count', 'origin/main...HEAD']);
    if (counts) {
      const [behind, ahead] = counts.split(/\s+/).map(Number);
      if (behind > 0) {
        add('warn', `落后远程 ${behind} 个提交`, '先 git pull --rebase origin main，否则推不上去');
      } else if (ahead > 0) {
        add('warn', `本地领先远程 ${ahead} 个提交`, '收工前 git push origin main，另一台电脑才看得到');
      } else {
        add('ok', '与远程一致', '');
      }
    }
  } else {
    add(
      'info',
      NO_FETCH ? '已跳过远程比对' : '没拉到远程状态（网络问题）',
      '本地照常可开发；真要推送时按 换电脑开工说明.md 第 4 节处理'
    );
  }
}

// 输出
const ICON = { ok: '[ OK ]', warn: '[WARN]', fail: '[FAIL]', info: '[INFO]' };
const line = '─'.repeat(52);
console.log(`\n行情跳动 · 开工自检\n${line}`);
for (const item of results) {
  console.log(`${ICON[item.level]} ${item.label}`);
  if (item.hint) console.log(`       ${item.hint}`);
}
console.log(line);

const fails = results.filter((r) => r.level === 'fail').length;
const warns = results.filter((r) => r.level === 'warn').length;
console.log(
  fails
    ? `有 ${fails} 项阻断问题，先处理再开工。`
    : warns
      ? `可以开工，有 ${warns} 项需要留意。`
      : '环境正常，可以开工。'
);

if (!fails) {
  console.log('\n下一步：');
  if (!hasModules) console.log('  npm ci           # 装依赖');
  console.log('  npm test         # 基线：111 项全过、0 失败');
  console.log('  npm run dev      # 本地预览 http://127.0.0.1:5173');
}

process.exit(fails ? 1 : 0);

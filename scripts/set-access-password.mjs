// 统一设置站点密码：全站访问门、数据设置页、线索表页共用同一个密码。
// 只写入随机盐 + PBKDF2 派生值，不保存明文密码。
// 用法（密码从 stdin 读入，不回显、不进 shell 历史）：
//   echo 你的密码 | node scripts/set-access-password.mjs --all
//   node scripts/set-access-password.mjs            # 交互输入，仅改全站访问门
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const withSettings = process.argv.includes('--all');

let password = '';
if (process.stdin.isTTY) {
  console.log('请输入新的站点密码（输入内容不回显），回车确认：');
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  await new Promise((resolve, reject) => {
    function read(chunk) {
      for (const char of chunk) {
        if (char === '\u0003') { cleanup(); reject(new Error('已取消')); return; }
        if (char === '\r' || char === '\n') { cleanup(); resolve(); return; }
        if (char === '\u007f' || char === '\b') password = password.slice(0, -1);
        else password += char;
      }
    }
    function cleanup() { process.stdin.removeListener('data', read); process.stdin.setRawMode(false); process.stdin.pause(); }
    process.stdin.on('data', read);
  });
} else {
  for await (const chunk of process.stdin) password += chunk.toString();
  password = password.replace(/\r?\n$/, '');
}
if (password.length < 4 || password.length > 256) throw new Error('站点密码长度须为 4–256 个字符');

function policy() {
  const salt = randomBytes(16);
  return {
    algorithm: 'PBKDF2', hash: 'SHA-256', iterations: 600000,
    salt: salt.toString('hex'),
    verifier: pbkdf2Sync(password, salt, 600000, 32, 'sha256').toString('hex'),
  };
}
async function writeLock(file, header, name) {
  const body = 'export const ' + name + ' = Object.freeze(' + JSON.stringify(policy(), null, 2) + ');\n';
  await writeFile(new URL(file, import.meta.url), header + body);
}

await writeLock('../src/access-lock.js',
  '// 全站访问密码校验配置：仅含随机盐与派生值，不含明文密码。\n// 重新设置：node scripts/set-access-password.mjs\n', 'accessLock');
const written = ['src/access-lock.js'];
if (withSettings) {
  await writeLock('../src/settings-lock.js',
    '// 页面入口密码校验配置，仅含随机盐和派生校验值。\n', 'settingsLock');
  written.push('src/settings-lock.js');
}
password = '';
console.log('已更新：' + written.join('、') + '（未保存明文）。所有设备的已解锁状态会自动失效。');
if (withSettings) console.log('线索表页需重新执行 node scripts/roujiaosuo-build.mjs 才会用上新密码。');
process.stdin.destroy();

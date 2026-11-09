import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

console.log('Ready for settings password on stdin (input is hidden).');
let password = '';
if (process.stdin.isTTY) {
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
if (password.length < 10 || password.length > 256) throw new Error('密码长度须为 10–256 个字符');
const salt = randomBytes(16);
const policy = {
  algorithm: 'PBKDF2', hash: 'SHA-256', iterations: 600000,
  salt: salt.toString('hex'),
  verifier: pbkdf2Sync(password, salt, 600000, 32, 'sha256').toString('hex'),
};
password = '';
await writeFile(new URL('../src/settings-lock.js', import.meta.url), '// 页面入口密码校验配置，仅含随机盐和派生校验值。\nexport const settingsLock = Object.freeze(' + JSON.stringify(policy, null, 2) + ');\n');
console.log('入口密码校验配置已更新；未保存明文密码。');
process.stdin.destroy();

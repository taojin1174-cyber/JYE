import { settingsLock } from './settings-lock.js';

function bytesFromHex(value, size) {
  if (typeof value !== 'string' || value.length !== size * 2 || !/^[0-9a-f]+$/i.test(value)) {
    throw new Error('入口密码配置异常，请联系管理员');
  }
  return Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16));
}

export async function verifySettingsPassword(password, policy = settingsLock) {
  if (!globalThis.crypto?.subtle) throw new Error('当前浏览器无法验证密码，请使用 HTTPS 地址访问');
  if (policy.algorithm !== 'PBKDF2' || policy.hash !== 'SHA-256' || !Number.isInteger(policy.iterations) || policy.iterations < 100000) {
    throw new Error('入口密码配置异常，请联系管理员');
  }
  const salt = bytesFromHex(policy.salt, 16);
  const expected = bytesFromHex(policy.verifier, 32);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: policy.hash, salt, iterations: policy.iterations }, key, 256));
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}

// 静态测试站的页面入口锁。真实数据权限仍由共享数据库 RLS 验证。
export function createSettingsAccess(storage, path = '/') {
  const sessionKey = `hqt-settings:${path}:${settingsLock.verifier.slice(0, 16)}`;
  let unlocked = false;
  try { unlocked = storage?.getItem(sessionKey) === 'unlocked'; } catch {}
  return {
    isUnlocked: () => unlocked,
    async unlock(password) {
      if (!await verifySettingsPassword(password)) return false;
      unlocked = true;
      try { storage?.setItem(sessionKey, 'unlocked'); } catch {}
      return true;
    },
    lock() {
      unlocked = false;
      try { storage?.removeItem(sessionKey); } catch {}
    },
  };
}

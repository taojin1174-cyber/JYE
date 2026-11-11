import { accessLock } from './access-lock.js';
import { verifySettingsPassword } from './settings-access.js';

// 全站访问门：校验通过后在本设备记住，清除浏览器数据即失效。
// 注意：这是「不让随手打开的人看到」的遮挡，不是服务器权限控制；
// 静态站的代码与公开快照仍可被技术手段读取，真正的数据私有需要登录 + 数据库 RLS。
const STORAGE_KEY = `hqt-access:${location.pathname}:${accessLock.verifier.slice(0, 16)}`;

// 每次都读存储，避免同一页面里多个模块实例对解锁状态判断不一致。
function readUnlocked() {
  try { return localStorage.getItem(STORAGE_KEY) === 'unlocked'; } catch { return false; }
}

export const accessGate = {
  isUnlocked: readUnlocked,
  async unlock(password) {
    if (!await verifySettingsPassword(password, accessLock)) return false;
    try { localStorage.setItem(STORAGE_KEY, 'unlocked'); } catch {}
    return true;
  },
  lock() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  },
};

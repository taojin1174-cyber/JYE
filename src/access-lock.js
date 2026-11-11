// 全站访问密码校验配置：仅含随机盐与派生值，不含明文密码。
// 重新设置：node scripts/set-access-password.mjs
export const accessLock = Object.freeze({
  "algorithm": "PBKDF2",
  "hash": "SHA-256",
  "iterations": 600000,
  "salt": "4916e08ee4e4d409615311eadf6387cf",
  "verifier": "f468258de6388bde4db4c00f34109ee37f60bbffd9d1b4be4ca522f89bfa8676"
});

// 全站访问密码校验配置：仅含随机盐与派生值，不含明文密码。
// 重新设置：node scripts/set-access-password.mjs
export const accessLock = Object.freeze({
  "algorithm": "PBKDF2",
  "hash": "SHA-256",
  "iterations": 600000,
  "salt": "034e7cf7b86a494c90e206741e0d8870",
  "verifier": "301fe6305600edde943ec008d163c265363f76a5ec8eff88df20f55235f37bb6"
});

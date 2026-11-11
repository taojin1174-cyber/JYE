// 页面入口密码校验配置，仅含随机盐和派生校验值。
export const settingsLock = Object.freeze({
  "algorithm": "PBKDF2",
  "hash": "SHA-256",
  "iterations": 600000,
  "salt": "26f1d06c5f3c07522526ecf7f101e61f",
  "verifier": "e453855dc26b7cd9ac12f9fe8ea6deb288bf1d3e3fa8d1a4a6f1b1fa830be4a2"
});

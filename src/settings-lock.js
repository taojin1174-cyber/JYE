// 页面入口密码校验配置，仅含随机盐和派生校验值。
export const settingsLock = Object.freeze({
  "algorithm": "PBKDF2",
  "hash": "SHA-256",
  "iterations": 600000,
  "salt": "0944ef057b0bcc9e71544bdab0bc422b",
  "verifier": "4bf310d3d72b8d5bfd0e443cc6aadea7f355b0c97e9502e83e37cadec62a549a"
});

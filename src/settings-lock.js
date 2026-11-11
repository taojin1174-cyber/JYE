// 页面入口密码校验配置，仅含随机盐和派生校验值。
export const settingsLock = Object.freeze({
  "algorithm": "PBKDF2",
  "hash": "SHA-256",
  "iterations": 600000,
  "salt": "cbf180748c8c640c22ae60cdb099cf78",
  "verifier": "c45649d49f3696e4d5381f1fded5ba0a098b2e1a7aa064f16f12b947375d2899"
});

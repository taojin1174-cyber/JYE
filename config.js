// 仅填写 Supabase 项目 URL 和 publishable/anon 公钥。严禁放 service_role / sb_secret_ 私钥。
// 【公司电脑操作】只改下面两处引号内的空内容，保留引号与逗号；其他文件一律不用动。
// 两处都填好后会自动切换为共享数据库模式（代码用 Boolean(url && key) 判断），localTrial 无需修改。
export const config = {
  // 正式版禁止回退到本机演示数据。连接团队数据库后才能开放员工登录。
  allowDemo: false,
  localTrial: true,
  supabaseUrl: '', // ← 粘贴 Project URL，例如 https://xxxxxxxx.supabase.co
  supabaseKey: '', // ← 粘贴 publishable key(sb_publishable_...) 或旧版 anon(eyJ...)
};

// 仅填写 Supabase 项目 URL 和 publishable/anon 公钥。严禁放 service_role 密钥。
export const config = {
  // 正式试运行禁止回退到本机演示数据。连接团队数据库后才能开放员工登录。
  allowDemo: false,
  localTrial: true,
  supabaseUrl: '',
  supabaseKey: '',
};

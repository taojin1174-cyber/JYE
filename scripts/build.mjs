import { mkdir, copyFile, cp, readFile, writeFile } from 'node:fs/promises';
import { config } from '../config.js';
if(config.supabaseKey.startsWith('sb_secret_'))throw new Error('私钥不能发布到前端，请使用 publishable / anon 公钥');
if(config.supabaseKey.startsWith('eyJ')) {
  const payload=JSON.parse(Buffer.from(config.supabaseKey.split('.')[1],'base64url').toString());
  if(payload.role==='service_role')throw new Error('service_role 不能发布到前端，请使用 anon 公钥');
}
await mkdir('dist',{recursive:true});
for(const file of ['index.html','config.js','favicon.svg'])await copyFile(file,`dist/${file}`);
await cp('src','dist/src',{recursive:true});
await cp('data','dist/data',{recursive:true});
await writeFile('dist/.nojekyll','');
try {
 const domain=(await readFile('CNAME','utf8')).trim();
 if(!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain))throw new Error('CNAME 域名格式无效');
 await writeFile('dist/CNAME',domain+'\n');
}catch(e){if(e.code!=='ENOENT')throw e;}
console.log('静态站已生成：dist/（兼容 GitHub Pages 子路径）');

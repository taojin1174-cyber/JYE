import { mkdir, copyFile, cp, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
// HTML 与模块使用同一内容版本，避免发布后旧缓存与新模块交叉加载。
const sourceFiles=(await readdir('src')).filter(name=>/\.(js|css)$/.test(name)).sort();
const hash=createHash('sha256');
for(const name of sourceFiles)hash.update(name).update(await readFile(`src/${name}`));
hash.update(await readFile('config.js')).update(await readFile('index.html'));
const version=hash.digest('hex').slice(0,12);
for(const name of sourceFiles.filter(name=>name.endsWith('.js'))) {
 const code=await readFile(`src/${name}`,'utf8');
 await writeFile(`dist/src/${name}`,code.replace(/from\s+(['"])(\.[^'"]+\.js)\1/g,(_,quote,path)=>`from ${quote}${path}?v=${version}${quote}`));
}
const html=await readFile('index.html','utf8');
await writeFile('dist/index.html',html.replace(/((?:src|href)="\.\/src\/[^"?]+\.(?:js|css))"/g,`$1?v=${version}"`));
await writeFile('dist/.nojekyll','');
try {
 const domain=(await readFile('CNAME','utf8')).trim();
 if(!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain))throw new Error('CNAME 域名格式无效');
 await writeFile('dist/CNAME',domain+'\n');
}catch(e){if(e.code!=='ENOENT')throw e;}
console.log('静态站已生成：dist/（兼容 GitHub Pages 子路径）');

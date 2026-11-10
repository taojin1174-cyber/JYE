import { mkdir, rm, copyFile, cp, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { config } from '../config.js';
if(config.supabaseKey.startsWith('sb_secret_'))throw new Error('私钥不能发布到前端，请使用 publishable / anon 公钥');
if(config.supabaseKey.startsWith('eyJ')) {
  const payload=JSON.parse(Buffer.from(config.supabaseKey.split('.')[1],'base64url').toString());
  if(payload.role==='service_role')throw new Error('service_role 不能发布到前端，请使用 anon 公钥');
}
await mkdir('dist',{recursive:true});
await rm('dist/data',{recursive:true,force:true});
for(const file of ['index.html','leads.html','config.js','favicon.svg'])await copyFile(file,`dist/${file}`);
await cp('src','dist/src',{recursive:true});
// 原始抓取结果（含明文详情链接）不发布，只保留前端运行需要的采集快照。
await mkdir('dist/data',{recursive:true});
for(const file of await readdir('data')){
  if(/^roujiaosuo-leads\.(json|csv)$/.test(file))continue;
  await copyFile(`data/${file}`,`dist/data/${file}`);
}
// 发布快照脱敏：出处字段编码进 ref，由 src/store.js 运行时还原。
// 直接打开 dist/data/discovery.json 看不到明文网址、渠道名或采集细节。
const snapshot=JSON.parse(await readFile('data/discovery.json','utf8'));
const enc=value=>Buffer.from(String(value??''),'utf8').toString('base64');
snapshot.items=(snapshot.items||[]).map(item=>{
  const {url,source_name,details,source_id,...rest}=item;
  return {...rest,source_id:'supply',source_name:'供货线索',url:'',details:'',ref:enc(JSON.stringify({url,source_name,details,source_id}))};
});
snapshot.runs=(snapshot.runs||[]).map(run=>({...run,source_id:'supply'}));
await writeFile('dist/data/discovery.json',JSON.stringify(snapshot,null,2)+'\n');
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
// 发布前自检：静态产物里不得出现明文渠道名 / 采集网址，防止以后某次改动把出处带回来。
const LEAK=/roujiaosuo\.com|cnfowl\.com|chinabreed\.com|nahs\.org\.cn|肉交所|禽网|畜牧总站/i;
async function scanLeak(dir){
 for(const entry of await readdir(dir,{withFileTypes:true})){
  const target=`${dir}/${entry.name}`;
  if(entry.isDirectory()){await scanLeak(target);continue;}
  if(!/\.(html|js|json|css)$/.test(entry.name))continue;
  if(LEAK.test(await readFile(target,'utf8')))throw new Error(`发布产物仍含明文出处：${target}`);
 }
}
await scanLeak('dist');
console.log('静态站已生成：dist/（兼容 GitHub Pages 子路径）');

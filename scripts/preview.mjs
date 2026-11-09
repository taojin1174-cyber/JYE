// 生成无需服务器的单文件体验版。仅使用本机演示报价和公开采集快照。
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
const root=process.cwd();
const snapshot=JSON.parse(await readFile('data/discovery.json','utf8'));
const logo='data:image/svg+xml;base64,'+Buffer.from(await readFile('favicon.svg')).toString('base64');
const cache=new Map();
async function bundle(path) {
 if(cache.has(path))return cache.get(path);
 let code=await readFile(path,'utf8');
 if(path===resolve(root,'config.js'))code="export const config={supabaseUrl:'',supabaseKey:''};";
 if(path===resolve(root,'src/store.js'))code=code.replace("await fetch(new URL('../data/discovery.json',import.meta.url),{cache:'no-store'})",`({ok:true,json:async()=>(${JSON.stringify(snapshot)})})`);
 code=code.replaceAll('./favicon.svg',logo);
 const deps=[...code.matchAll(/from\s+(['"])(\.[^'"]+)\1/g)];
 for(const match of deps)code=code.replace(match[0],`from '${await bundle(resolve(dirname(path),match[2]))}'`);
 const url='data:text/javascript;base64,'+Buffer.from(code).toString('base64');cache.set(path,url);return url;
}
const entry=await bundle(resolve(root,'src/app.js'));
let html=await readFile('index.html','utf8');
html=html.replace('./favicon.svg',logo).replace('<link rel="stylesheet" href="./src/styles.css">',`<style>${await readFile('src/styles.css','utf8')}</style>`).replace('<script type="module" src="./src/app.js"></script>',`<script type="module">import '${entry}';</script>`);
html=html.replace('<link rel="stylesheet" href="./src/settings.css">',`<style>${await readFile('src/settings.css','utf8')}</style>`);
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/行情跳动-离线体验.html',html);
console.log('已生成 artifacts/行情跳动-离线体验.html，可直接用浏览器打开。');

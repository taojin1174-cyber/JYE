import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root=process.cwd();
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
 try {
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=resolve(root,'.'+(path==='/'?'/index.html':path));
  const relative=file.slice(root.length+1).split(sep);
  if(!file.startsWith(root+sep)||relative.some(x=>x.startsWith('.'))||['supabase','tests','scripts','collector','artifacts'].includes(relative[0])){res.writeHead(403);res.end('Forbidden');return;}
  if(!(await stat(file)).isFile())throw new Error('not found');
  res.writeHead(200,{'Content-Type':types[extname(file)]||'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(await readFile(file));
 }catch {res.writeHead(404);res.end('Not found');}
});
server.listen(Number(process.env.PORT||5173),'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${server.address().port}`));

import { config } from '../config.js';
import { createDemo,defaultProducts } from './demo.js';
import { can,canEditQuote,canReviewQuote,canRequestDeletion,defaultPermissions } from './permissions.js';

// v2：上线前清空旧的本机录入数据（含混入的苗价报价）。旧键 v1 仍留在浏览器里，需要时可用控制台恢复。
const DATA_KEY=config.localTrial?'hqt-trial-data-v2':'hqt-data-v2', SESSION_KEY='hqt-session-v1', PREFS_KEY='hqt-prefs-v1';
// 品类停用 / 删除属于本机显示偏好，随完整备份一起导出，换设备导入后保持一致。
function readPrefs(){
 let raw={};try{raw=JSON.parse(localStorage.getItem(PREFS_KEY)||'{}');}catch{}
 const names=value=>Array.isArray(value)?[...new Set(value.filter(x=>typeof x==='string'&&x.trim()))]:[];
 return {disabledCategories:names(raw.disabledCategories),deletedCategories:names(raw.deletedCategories)};
}
function writePrefs(prefs){try{localStorage.setItem(PREFS_KEY,JSON.stringify(prefs));}catch{throw new Error('本机偏好保存失败，请检查浏览器存储');}}
const cloud=Boolean(config.supabaseUrl&&config.supabaseKey);
const mutableFields=['product_id','supplier','province','city','price','basis','source','source_name','source_url','quoted_on','valid_until','min_order','freight','notes','status'];
// 发布快照把出处编码进 ref，运行时还原；静态文件本身不含明文网址 / 渠道名。
const decodeRef=ref=>{
 if(!ref)return{};
 try{const bytes=Uint8Array.from(atob(ref),c=>c.charCodeAt(0));return JSON.parse(new TextDecoder().decode(bytes));}catch{return{};}
};
let session;
try{session=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');}catch{session=null;}
let data,refreshTask;
const demoMembers=['admin','editor','viewer'].map(role=>({id:`demo-${role}`,email:`${role}@demo.invalid`,display_name:{admin:'演示管理员',editor:'演示录入员工',viewer:'演示只读成员'}[role],role,active:true,...defaultPermissions(role)}));
export const store={
  cloud,trial:!cloud&&config.localTrial===true,role:cloud?null:'admin',user:null,member:cloud?null:demoMembers[0],discovery:null,requiresPasswordChange:false,
  async init(){
    if(Boolean(config.supabaseUrl)!==Boolean(config.supabaseKey))throw new Error('共享数据库配置不完整，请同时填写 URL 和公钥');
    if(!cloud){
      if(config.allowDemo!==true&&!config.localTrial)throw new Error('团队数据库尚未连接，请先在配置中填写 Supabase 地址与公钥。');
      const saved=localStorage.getItem(DATA_KEY);
      try{data=saved?JSON.parse(saved):config.localTrial?{products:structuredClone(defaultProducts),quotes:[],leads:[]}:createDemo();}catch{throw new Error('本机数据无法读取，请先备份浏览器存储，避免覆盖');}
      if(!Array.isArray(data?.quotes)||!Array.isArray(data?.products))throw new Error('本机数据格式不正确');
      if(config.localTrial)this.member={id:'local-owner',display_name:'本机操作者',email:'',role:'admin',active:true,...defaultPermissions('admin')};
      data.deletionRequests||=[];data.audit||=[];data.members=config.localTrial?[this.member]:structuredClone(demoMembers);this.user={id:this.member.id,email:this.member.email};
      await mergeDiscovery();return viewData();
    }
    if(!session)return null;
    this.user=await request('/auth/v1/user');return this.reload();
  },
  async reload(){
    if(!cloud)return viewData();
    const profileRows=await request(`/rest/v1/members?id=eq.${encodeURIComponent(this.user.id)}&select=*`);
    this.member=profileRows[0];this.role=this.member?.role;
    if(!this.member?.active){this.clearSession();throw new Error('账号未获授权或已停用，请联系管理员');}
    this.requiresPasswordChange=this.member.must_change_password;
    if(this.requiresPasswordChange){data={products:[],quotes:[],leads:[],deletionRequests:[],audit:[]};return viewData();}
    if(!await request('/rest/v1/rpc/member_role',{method:'POST',body:{}})){this.clearSession();throw new Error('账号安全信息已更新，请重新登录');}
    const [products,quotes,leads,deletionRequests,audit,members]=await Promise.all([readAll('products','name'),readAll('quotes','created_at'),readAll('collection_items','fetched_at'),readAll('deletion_requests','created_at'),this.role==='admin'?readAll('management_audit','created_at'):Promise.resolve([]),this.role==='admin'?readAll('members','created_at'):Promise.resolve([this.member])]);
    data={products,quotes,leads,deletionRequests,audit,members};return viewData();
  },
  async login(email,password){
    // 登录页只保留密码框：只传一个参数时，按配置中的登录邮箱提交。
    if(password===undefined||password===null){password=email;email=config.loginEmail||'';}
    if(!email)throw new Error('尚未配置登录账号，请联系管理员');
    // 口令只来自用户输入。前端不保存、不派生、不缓存，避免随静态站一起公开。
    try{session=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},anonymous:true});session.expires_at=Math.floor(Date.now()/1000)+session.expires_in;localStorage.setItem(SESSION_KEY,JSON.stringify(session));return await this.init();}
    catch(error){this.clearSession();throw error;}
  },
  clearSession(){session=null;data=null;this.user=null;this.member=null;this.role=null;this.requiresPasswordChange=false;localStorage.removeItem(SESSION_KEY);},
  async logout(){try{if(cloud&&session)await request('/auth/v1/logout',{method:'POST'});}catch{}finally{this.clearSession();}},
  setDemoRole(role){if(cloud)throw new Error('正式账号不能切换身份');const member=demoMembers.find(m=>m.role===role);if(!member)throw new Error('演示角色无效');this.member=member;this.role=role;this.user={id:member.id,email:member.email};return viewData();},
  async saveQuote(quote){
    const existing=data.quotes.find(q=>q.id===quote.id);
    if(existing?!canEditQuote(this.member,existing):!can(this.member,'can_create_quotes'))throw new Error('当前账号没有修改或录入权限');
    const clean=Object.fromEntries(mutableFields.filter(k=>quote[k]!==undefined).map(k=>[k,quote[k]]));if(this.role!=='admin')clean.status='pending';
    if(cloud){const body=existing?clean:{...clean,id:quote.id,...(quote.collection_item_id?{collection_item_id:quote.collection_item_id}:{})};await request('/rest/v1/quotes'+(existing?`?id=eq.${encodeURIComponent(quote.id)}`:''),{method:existing?'PATCH':'POST',body});return this.reload();}
    const next=structuredClone(data);const i=next.quotes.findIndex(q=>q.id===quote.id);
    const saved={...existing,...clean,id:quote.id,created_by:existing?.created_by||this.member.id,created_at:existing?.created_at||new Date().toISOString(),collection_item_id:quote.collection_item_id||existing?.collection_item_id};
    if(saved.collection_item_id){if(data.quotes.some(q=>q.id!==saved.id&&q.collection_item_id===saved.collection_item_id))throw new Error('该线索已经生成报价');const lead=next.leads.find(l=>l.id===saved.collection_item_id);if(!lead||lead.kind!=='supply')throw new Error('只有供货线索可以转成报价');lead.status='converted';}
    if(i<0)next.quotes.push(saved);else next.quotes[i]=saved;
    localAudit(next,existing?'quote_updated':'quote_created',saved.id);persist(next);return viewData();
  },
  async review(id,status){
    const quote=data.quotes.find(q=>q.id===id);if(!canReviewQuote(this.member,quote))throw new Error('没有审核该报价的权限');
    if(cloud){await request(`/rest/v1/quotes?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{status}});return this.reload();}
    const next=structuredClone(data);Object.assign(next.quotes.find(q=>q.id===id),{status,reviewed_at:new Date().toISOString(),reviewed_by:this.member.id});localAudit(next,'quote_reviewed',id,{status});persist(next);return viewData();
  },
  async requestDeletion(id,reason){
    const quote=data.quotes.find(q=>q.id===id);if(!canRequestDeletion(this.member,quote))throw new Error('仅可按授权申请删除本人报价');checkReason(reason);
    if(cloud){await request('/rest/v1/rpc/request_quote_deletion',{method:'POST',body:{p_quote_id:id,p_reason:reason.trim()}});return this.reload();}
    if(data.deletionRequests.some(r=>r.quote_id===id&&r.status==='pending'))throw new Error('该报价已有待审批的删除申请');
    const next=structuredClone(data);const item={id:crypto.randomUUID(),quote_id:id,reason:reason.trim(),status:'pending',requested_by:this.member.id,created_at:new Date().toISOString(),quote_snapshot:structuredClone(quote)};
    next.deletionRequests.push(item);localAudit(next,'deletion_requested',id,{reason:item.reason});persist(next);return viewData();
  },
  async reviewDeletion(id,decision,note=''){
    requireAdmin();if(!['approved','rejected'].includes(decision))throw new Error('审批结果无效');if(decision==='rejected')checkReason(note);
    if(cloud){await request('/rest/v1/rpc/review_quote_deletion',{method:'POST',body:{p_request_id:id,p_decision:decision,p_note:note.trim()}});return this.reload();}
    const next=structuredClone(data);const item=next.deletionRequests.find(r=>r.id===id);if(!item||item.status!=='pending')throw new Error('申请不存在或已处理');const stamp=new Date().toISOString();
    if(decision==='approved'){const quote=next.quotes.find(q=>q.id===item.quote_id);if(!quote||quote.deleted_at)throw new Error('报价已被删除');Object.assign(quote,{deleted_at:stamp,deleted_by:this.member.id,deletion_request_id:id});}
    Object.assign(item,{status:decision,reviewed_by:this.member.id,reviewed_at:stamp,review_note:note.trim()});localAudit(next,'deletion_'+decision,item.quote_id,{reason:item.reason,note:note.trim()});persist(next);return viewData();
  },
  async restoreQuote(id,reason){
    requireAdmin();checkReason(reason);if(cloud){await request('/rest/v1/rpc/restore_quote',{method:'POST',body:{p_quote_id:id,p_reason:reason.trim()}});return this.reload();}
    const next=structuredClone(data);const quote=next.quotes.find(q=>q.id===id);if(!quote?.deleted_at)throw new Error('报价不在回收站');Object.assign(quote,{deleted_at:null,deleted_by:null,deletion_request_id:null,restored_at:new Date().toISOString(),restored_by:this.member.id,restore_reason:reason.trim()});localAudit(next,'quote_restored',id,{reason:reason.trim()});persist(next);return viewData();
  },
  async addProduct(product){requireAdmin();if(cloud){await request('/rest/v1/products',{method:'POST',body:product});return this.reload();}const next=structuredClone(data);next.products.push(product);persist(next);return viewData();},
  // 删除产品规格。已有报价引用的产品不允许直接删，避免报价变成无主记录。
  async deleteProduct(id){
   requireAdmin();
   const product=(data.products||[]).find(p=>p.id===id);
   if(!product)throw new Error('产品不存在');
   const used=(data.quotes||[]).filter(q=>q.product_id===id&&!q.deleted_at).length;
   if(used)throw new Error(`「${product.name} ${product.spec}」还有 ${used} 条报价，请先删除这些报价再删产品`);
   if(cloud){
    try{await request(`/rest/v1/products?id=eq.${encodeURIComponent(id)}`,{method:'DELETE'});}
    catch(e){
     const msg=String(e&&e.message||'');
     if(/permission denied|42501|jwt/i.test(msg))throw new Error('云端尚未开通删除权限，请先在 Supabase 执行 supabase/migrations/20261111_product_delete.sql');
     if(/foreign key|23503/i.test(msg))throw new Error('该规格仍被报价引用，请先删除对应报价');
     throw e;
    }
    return this.reload();
   }
   const next=structuredClone(data);next.products=next.products.filter(p=>p.id!==id);persist(next);return viewData();
  },
  async dismissLead(id){requireAdmin();if(cloud){await request(`/rest/v1/collection_items?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{status:'dismissed'}});return this.reload();}const next=structuredClone(data);const lead=next.leads.find(l=>l.id===id);if(!lead)throw new Error('线索不存在');lead.status='dismissed';persist(next);return viewData();},
  // 已处理线索：恢复待审 / 删除 / 撤销入库。云端状态受 check 约束，删除退化为 dismissed。
  async setLeadStatus(id,status){
   requireAdmin();
   const allowed=['pending','converted','dismissed',...(cloud?[]:['deleted'])];
   if(!allowed.includes(status))throw new Error('线索状态无效');
   if(cloud){await request(`/rest/v1/collection_items?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{status}});return this.reload();}
   const next=structuredClone(data);const lead=next.leads.find(l=>l.id===id);
   if(!lead)throw new Error('线索不存在');
   lead.status=status;persist(next);return viewData();
  },
  async deleteLead(id){return this.setLeadStatus(id,cloud?'dismissed':'deleted');},
  async undoLeadQuote(leadId){
   requireAdmin();
   const quote=data.quotes.find(q=>q.collection_item_id===leadId);
   if(!quote)throw new Error('没有找到该线索生成的报价');
   if(cloud){
    await request(`/rest/v1/quotes?id=eq.${encodeURIComponent(quote.id)}`,{method:'DELETE'});
    await request(`/rest/v1/collection_items?id=eq.${encodeURIComponent(leadId)}`,{method:'PATCH',body:{status:'pending'}});
    return this.reload();
   }
   const next=structuredClone(data);
   next.quotes=next.quotes.filter(q=>q.id!==quote.id);
   const lead=next.leads.find(l=>l.id===leadId);if(lead)lead.status='pending';
   localAudit(next,'quote_undone',quote.id,{lead_id:leadId});persist(next);return viewData();
  },
  async toggleCategory(category,disabled){
   requireAdmin();const name=String(category||'').trim();if(!name)throw new Error('品类名称无效');
   const prefs=readPrefs();const set=new Set(prefs.disabledCategories);
   if(disabled)set.add(name);else set.delete(name);
   prefs.disabledCategories=[...set];writePrefs(prefs);return viewData();
  },
  async renameCategory(from,to){
   requireAdmin();const name=String(to||'').trim();
   if(!name||name.length>20)throw new Error('品类名称需为 1–20 个字');
   if(name===from)return viewData();
   if(data.products.some(p=>p.category===name))throw new Error('该品类名称已存在，避免把两个品类合并');
   if(cloud){await request(`/rest/v1/products?category=eq.${encodeURIComponent(from)}`,{method:'PATCH',body:{category:name}});return this.reload();}
   const next=structuredClone(data);for(const p of next.products)if(p.category===from)p.category=name;
   const prefs=readPrefs();
   prefs.disabledCategories=prefs.disabledCategories.map(c=>c===from?name:c);
   prefs.deletedCategories=prefs.deletedCategories.map(c=>c===from?name:c);
   writePrefs(prefs);persist(next);return viewData();
  },
  async deleteCategory(category){
   requireAdmin();const name=String(category||'').trim();if(!name)throw new Error('品类名称无效');
   const ids=new Set(data.products.filter(p=>p.category===name).map(p=>p.id));
   if(data.quotes.some(q=>ids.has(q.product_id)))throw new Error('该品类已有报价，请先在报价审核处理，或改用「停用」');
   if(cloud)await request(`/rest/v1/products?category=eq.${encodeURIComponent(name)}`,{method:'DELETE'});
   else{const next=structuredClone(data);next.products=next.products.filter(p=>p.category!==name);persist(next);}
   const prefs=readPrefs();
   prefs.disabledCategories=prefs.disabledCategories.filter(c=>c!==name);
   if(!prefs.deletedCategories.includes(name))prefs.deletedCategories.push(name);
   writePrefs(prefs);
   return cloud?this.reload():viewData();
  },
  async restoreCategory(category){
   requireAdmin();const name=String(category||'').trim();if(!name)throw new Error('品类名称无效');
   const prefs=readPrefs();
   prefs.disabledCategories=prefs.disabledCategories.filter(c=>c!==name);
   prefs.deletedCategories=prefs.deletedCategories.filter(c=>c!==name);
   writePrefs(prefs);return viewData();
  },
  // 本机数据跨设备搬运：导出完整备份 → 在另一台设备导入（覆盖该设备数据）。
  // 云端模式下改为「合并导入」：本机已有数据搬进共享库，不覆盖云端已有记录。
  async importBackup(text){
   requireAdmin();
   let raw;try{raw=JSON.parse(String(text));}catch{throw new Error('备份文件不是有效的 JSON');}
   if(!raw||!Array.isArray(raw.products)||!Array.isArray(raw.quotes))throw new Error('备份内容缺少产品库或报价数据');
   if(cloud){
    const stat=await pushBackupToCloud(raw);
    const view=await this.reload();
    this.lastImportMessage=`已合并到共享数据库：产品 ${stat.products} 个、报价 ${stat.quotes} 条`+(stat.failed?`，失败 ${stat.failed} 条`:'');
    return view;
   }
   const clean={products:raw.products,quotes:raw.quotes,leads:Array.isArray(raw.leads)?raw.leads:[],deletionRequests:Array.isArray(raw.deletionRequests)?raw.deletionRequests:[],audit:Array.isArray(raw.audit)?raw.audit:[]};
   if(raw.prefs){const prefs=readPrefs();const names=v=>Array.isArray(v)?[...new Set(v.filter(x=>typeof x==='string'))]:null;
    prefs.disabledCategories=names(raw.prefs.disabledCategories)??prefs.disabledCategories;
    prefs.deletedCategories=names(raw.prefs.deletedCategories)??prefs.deletedCategories;
    writePrefs(prefs);}
   localStorage.setItem(DATA_KEY,JSON.stringify(clean));
   return this.init();
  },
  async members(){requireAdmin();return cloud?request('/rest/v1/members?select=*&order=created_at.asc'):structuredClone(demoMembers);},
  async accountAction(action,fields){if(!cloud)throw new Error('当前为本机演示，请先连接团队数据库后管理员工账号');if(action!=='change_password')requireAdmin();return request('/functions/v1/account-admin',{method:'POST',body:{...fields,action}});},
  backup(){return JSON.stringify({version:3,exported_at:new Date().toISOString(),...data,prefs:readPrefs()},null,2);},
};
function requireAdmin(){if(store.role!=='admin'||store.member?.active===false||store.requiresPasswordChange)throw new Error('需要有效管理员权限');}
function checkReason(reason){if(typeof reason!=='string'||reason.trim().length<4||reason.length>500)throw new Error('请填写 4–500 字原因');}
function localAudit(next,action,target_id,details={}){next.audit.push({id:crypto.randomUUID(),actor:store.member.id,action,target_id,details,created_at:new Date().toISOString()});}
function persist(next){try{localStorage.setItem(DATA_KEY,JSON.stringify(next));}catch{throw new Error('保存失败：浏览器空间不足，请导出备份');}data=next;}
async function mergeDiscovery(){
  data.leads||=[];
  try{const response=await fetch(new URL('../data/discovery.json',import.meta.url),{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('无法读取采集快照');const snapshot=await response.json();if(!Array.isArray(snapshot.items))throw new Error('采集快照格式错误');const states=new Map(data.leads.map(l=>[l.id,l.status]));const incoming=snapshot.items.map(l=>({...l,...decodeRef(l.ref),status:states.get(l.id)||'pending'}));const ids=new Set(incoming.map(l=>l.id));data.leads=[...incoming,...data.leads.filter(l=>!ids.has(l.id)&&l.status!=='pending')];store.discovery={fetched_at:snapshot.fetched_at,runs:snapshot.runs};}catch(error){store.discovery={error:error.message};}
}
// 本机备份 → 共享数据库：产品按 id 或「品类+名称+状态+规格」对齐后合并，
// 报价按 id 去重插入；单条异常不影响整批，最后回报成功/失败数量。
async function pushBackupToCloud(raw){
 const productFields=['id','category','name','state','spec'];
 const quoteFields=['id','product_id','supplier','province','city','price','basis','source','source_name','source_url','quoted_on','valid_until','min_order','freight','notes','status'];
 const bases=new Set(['factory','delivered','untaxed']),sources=new Set(['manual','engine']),statuses=new Set(['pending','approved','rejected']);
 const pick=(row,keys)=>{const out={};for(const k of keys){const v=row[k];if(v!==undefined&&v!==null&&v!=='')out[k]=v;}return out;};
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 const products=(raw.products||[]).map(p=>pick(p,productFields)).filter(p=>p.id&&p.category&&p.name&&p.state&&p.spec);
 const existing=await request('/rest/v1/products?select=id,category,name,state,spec');
 const byId=new Map(existing.map(p=>[p.id,p]));
 const byKey=new Map(existing.map(p=>[[p.category,p.name,p.state,p.spec].join('\u0001'),p]));
 const idMap=new Map(),toInsert=[];
 for(const p of products){
  if(byId.has(p.id)){idMap.set(p.id,p.id);continue;}
  const key=[p.category,p.name,p.state,p.spec].join('\u0001');
  if(byKey.has(key)){idMap.set(p.id,byKey.get(key).id);continue;}
  idMap.set(p.id,p.id);toInsert.push(p);byKey.set(key,p);byId.set(p.id,p);
 }
 if(toInsert.length)await request('/rest/v1/products',{method:'POST',body:toInsert,headers:{Prefer:'return=minimal'}});
 const quotes=(raw.quotes||[]).map(q=>pick(q,quoteFields)).filter(q=>{
  const productId=idMap.get(q.product_id);
  if(!q.id||!productId)return false;
  q.product_id=productId;
  if(!(Number(q.price)>0)||!q.quoted_on||q.quoted_on>today)return false;
  // 导入不再替缺失的有效期补当天，缺了就当这条数据不完整、跳过并计入失败。
  if(!q.valid_until)return false;
  if(q.valid_until<q.quoted_on)return false;
  if(!bases.has(q.basis))return false;
  q.source=sources.has(q.source)?q.source:'manual';
  if(statuses.has(q.status)===false)q.status='pending';
  return true;
 });
 let inserted=0,failed=0;
 for(let i=0;i<quotes.length;i+=150){
  const batch=quotes.slice(i,i+150);
  try{
   await request('/rest/v1/quotes?on_conflict=id',{method:'POST',body:batch,headers:{Prefer:'resolution=ignore-duplicates,return=minimal'}});
   inserted+=batch.length;
  }catch{
   for(const one of batch){
    try{await request('/rest/v1/quotes?on_conflict=id',{method:'POST',body:[one],headers:{Prefer:'resolution=ignore-duplicates,return=minimal'}});inserted++;}
    catch{failed++;}
   }
  }
 }
 return {products:products.length,quotes:inserted,failed};
}
async function readAll(table,order){const all=[];for(let offset=0;;offset+=1000){const batch=await request(`/rest/v1/${table}?select=*&order=${order}.asc,id.asc&limit=1000&offset=${offset}`);all.push(...batch);if(batch.length<1000)return all;}}
async function request(path,{method='GET',body,headers={},anonymous=false}={}){
  if(!anonymous&&session?.refresh_token&&session.expires_at<Date.now()/1000+60){if(!refreshTask)refreshTask=request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token},anonymous:true}).then(value=>{session={...value,expires_at:Math.floor(Date.now()/1000)+value.expires_in};localStorage.setItem(SESSION_KEY,JSON.stringify(session));}).finally(()=>{refreshTask=null;});await refreshTask;}
  const response=await fetch(config.supabaseUrl.replace(/\/$/,'')+path,{method,headers:{apikey:config.supabaseKey,Authorization:`Bearer ${!anonymous&&session?.access_token?session.access_token:config.supabaseKey}`,'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  const raw=await response.text();let value;try{value=raw?JSON.parse(raw):null;}catch{throw new Error('服务器返回了无法识别的数据');}if(!response.ok)throw new Error(value?.error||value?.msg||value?.message||value?.error_description||'操作未获授权或连接失败');return value;
}

function viewData(){
 const base=cloud||store.role==='admin'?data:{...data,quotes:data.quotes.filter(q=>!q.deleted_at&&(q.status==='approved'||q.created_by===store.member.id||can(store.member,'can_review_quotes'))),deletionRequests:data.deletionRequests.filter(r=>r.requested_by===store.member.id),audit:[],members:[store.member]};
 return {...base,prefs:readPrefs()};
}

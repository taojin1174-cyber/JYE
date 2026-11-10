import { config } from '../config.js';
import { createDemo,defaultProducts } from './demo.js';
import { can,canEditQuote,canReviewQuote,canRequestDeletion,defaultPermissions } from './permissions.js';

// v2：上线前清空旧的本机录入数据（含混入的苗价报价）。旧键 v1 仍留在浏览器里，需要时可用控制台恢复。
const DATA_KEY=config.localTrial?'hqt-trial-data-v2':'hqt-data-v2', SESSION_KEY='hqt-session-v1';
const cloud=Boolean(config.supabaseUrl&&config.supabaseKey);
const mutableFields=['product_id','supplier','province','city','price','basis','source','source_name','source_url','quoted_on','valid_until','min_order','freight','notes','status'];
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
  async dismissLead(id){requireAdmin();if(cloud){await request(`/rest/v1/collection_items?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{status:'dismissed'}});return this.reload();}const next=structuredClone(data);const lead=next.leads.find(l=>l.id===id);if(!lead)throw new Error('线索不存在');lead.status='dismissed';persist(next);return viewData();},
  async members(){requireAdmin();return cloud?request('/rest/v1/members?select=*&order=created_at.asc'):structuredClone(demoMembers);},
  async accountAction(action,fields){if(!cloud)throw new Error('当前为本机演示，请先连接团队数据库后管理员工账号');if(action!=='change_password')requireAdmin();return request('/functions/v1/account-admin',{method:'POST',body:{...fields,action}});},
  backup(){return JSON.stringify({version:2,exported_at:new Date().toISOString(),...data},null,2);},
};
function requireAdmin(){if(store.role!=='admin'||store.member?.active===false||store.requiresPasswordChange)throw new Error('需要有效管理员权限');}
function checkReason(reason){if(typeof reason!=='string'||reason.trim().length<4||reason.length>500)throw new Error('请填写 4–500 字原因');}
function localAudit(next,action,target_id,details={}){next.audit.push({id:crypto.randomUUID(),actor:store.member.id,action,target_id,details,created_at:new Date().toISOString()});}
function persist(next){try{localStorage.setItem(DATA_KEY,JSON.stringify(next));}catch{throw new Error('保存失败：浏览器空间不足，请导出备份');}data=next;}
async function mergeDiscovery(){
  data.leads||=[];
  try{const response=await fetch(new URL('../data/discovery.json',import.meta.url),{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('无法读取采集快照');const snapshot=await response.json();if(!Array.isArray(snapshot.items))throw new Error('采集快照格式错误');const states=new Map(data.leads.map(l=>[l.id,l.status]));const incoming=snapshot.items.map(l=>({...l,status:states.get(l.id)||'pending'}));const ids=new Set(incoming.map(l=>l.id));data.leads=[...incoming,...data.leads.filter(l=>!ids.has(l.id)&&l.status!=='pending')];store.discovery={fetched_at:snapshot.fetched_at,runs:snapshot.runs};}catch(error){store.discovery={error:error.message};}
}
async function readAll(table,order){const all=[];for(let offset=0;;offset+=1000){const batch=await request(`/rest/v1/${table}?select=*&order=${order}.asc,id.asc&limit=1000&offset=${offset}`);all.push(...batch);if(batch.length<1000)return all;}}
async function request(path,{method='GET',body,headers={},anonymous=false}={}){
  if(!anonymous&&session?.refresh_token&&session.expires_at<Date.now()/1000+60){if(!refreshTask)refreshTask=request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token},anonymous:true}).then(value=>{session={...value,expires_at:Math.floor(Date.now()/1000)+value.expires_in};localStorage.setItem(SESSION_KEY,JSON.stringify(session));}).finally(()=>{refreshTask=null;});await refreshTask;}
  const response=await fetch(config.supabaseUrl.replace(/\/$/,'')+path,{method,headers:{apikey:config.supabaseKey,Authorization:`Bearer ${!anonymous&&session?.access_token?session.access_token:config.supabaseKey}`,'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  const raw=await response.text();let value;try{value=raw?JSON.parse(raw):null;}catch{throw new Error('服务器返回了无法识别的数据');}if(!response.ok)throw new Error(value?.error||value?.msg||value?.message||value?.error_description||'操作未获授权或连接失败');return value;
}

function viewData(){
 if(cloud||store.role==='admin')return data;
 return {...data,quotes:data.quotes.filter(q=>!q.deleted_at&&(q.status==='approved'||q.created_by===store.member.id||can(store.member,'can_review_quotes'))),deletionRequests:data.deletionRequests.filter(r=>r.requested_by===store.member.id),audit:[],members:[store.member]};
}

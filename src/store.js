import { config } from '../config.js';
import { createDemo } from './demo.js';

const DATA_KEY = 'hqt-data-v1';
const SESSION_KEY = 'hqt-session-v1';
const cloud = Boolean(config.supabaseUrl && config.supabaseKey);
let session;
try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { session = null; }
let data;
export const store = {
  cloud, role: cloud ? null : 'admin', user:null, discovery:null,
  async init() {
    if(Boolean(config.supabaseUrl)!==Boolean(config.supabaseKey)) throw new Error('共享数据库配置不完整，请同时填写 URL 和公钥');
    if (!cloud) {
      const saved = localStorage.getItem(DATA_KEY);
      try { data = saved ? JSON.parse(saved) : createDemo(); } catch { throw new Error('本机数据无法读取，请先备份浏览器存储，避免覆盖。'); }
      if (!Array.isArray(data?.quotes) || !Array.isArray(data?.products)) throw new Error('本机数据格式不正确');
      await mergeDiscovery();
      return data;
    }
    if (!session) return null;
    const user = await request('/auth/v1/user');
    this.user = user;
    const members = await request(`/rest/v1/members?id=eq.${encodeURIComponent(user.id)}&select=*`);
    this.role = members[0]?.role;
    if (!this.role) throw new Error('账号尚未获得访问授权，请联系管理员');
    return this.reload();
  },
  async reload() {
    if (!cloud) return data;
    const [products, quotes, leads] = await Promise.all([readAll('products','name'),readAll('quotes','created_at'),readAll('collection_items','fetched_at')]);
    data = {products,quotes,leads};
    return data;
  },
  async login(email, password) {
    session = await request('/auth/v1/token?grant_type=password', {method:'POST', body:{email,password}, anonymous:true});
    session.expires_at = Math.floor(Date.now()/1000)+session.expires_in;
    localStorage.setItem(SESSION_KEY,JSON.stringify(session));
    return this.init();
  },
  async logout() {
    try { if (cloud && session) await request('/auth/v1/logout',{method:'POST'}); }
    finally { session=null; data=null; this.user=null; this.role=null; localStorage.removeItem(SESSION_KEY); }
  },
  async saveQuote(quote) {
    if(cloud) {
      const existing = data.quotes.find(q=>q.id===quote.id);
      const body = {...quote};
      delete body.created_at; delete body.created_by; delete body.reviewed_by;
      const saved = await request('/rest/v1/quotes' + (existing?`?id=eq.${encodeURIComponent(quote.id)}`:''), {method:existing?'PATCH':'POST',body,headers:{Prefer:'return=representation'}});
      await this.reload();
      return saved[0];
    }
    const i = data.quotes.findIndex(q=>q.id===quote.id);
    const next = structuredClone(data);
    if(i<0) next.quotes.push(quote); else next.quotes[i]=quote;
    if(quote.collection_item_id) {
      if(data.quotes.some(q=>q.id!==quote.id && q.collection_item_id===quote.collection_item_id))throw new Error('该采集线索已经生成报价，请在审核列表处理');
      const lead=next.leads?.find(l=>l.id===quote.collection_item_id);
      if(!lead||lead.kind!=='supply')throw new Error('只有供货线索可以转成供货报价');
      lead.status='converted';
    }
    persist(next);
  },
  async dismissLead(id) {
    if(cloud){await request(`/rest/v1/collection_items?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{status:'dismissed'}});return this.reload();}
    const next=structuredClone(data);const lead=next.leads.find(l=>l.id===id);if(!lead)throw new Error('线索不存在');lead.status='dismissed';persist(next);return data;
  },
  async review(id,status) {
    if(cloud) { await request(`/rest/v1/quotes?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{status}}); return this.reload(); }
    const next=structuredClone(data); const q=next.quotes.find(q=>q.id===id); if(!q) throw new Error('报价不存在');
    q.status=status; q.reviewed_at=new Date().toISOString(); persist(next); return data;
  },
  async addProduct(product) {
    if(cloud) { await request('/rest/v1/products',{method:'POST',body:product}); return this.reload(); }
    const next=structuredClone(data); next.products.push(product); persist(next); return data;
  },
  async members() { return cloud?request('/rest/v1/members?select=*&order=created_at.asc'):[]; },
  async changeRole(id,role) { return request(`/rest/v1/members?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{role}}); },
  backup() { return JSON.stringify({version:1,exported_at:new Date().toISOString(),...data},null,2); },
};
async function mergeDiscovery() {
  data.leads=data.leads||[];
  try {
    const response=await fetch(new URL('../data/discovery.json',import.meta.url),{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('无法读取采集快照');
    const snapshot=await response.json();
    if(!Array.isArray(snapshot.items))throw new Error('采集快照格式错误');
    const states=new Map(data.leads.map(l=>[l.id,l.status]));
    const incoming=snapshot.items.map(l=>({...l,status:states.get(l.id)||'pending'}));
    const ids=new Set(incoming.map(l=>l.id));
    data.leads=[...incoming,...data.leads.filter(l=>!ids.has(l.id)&&l.status!=='pending')];
    store.discovery={fetched_at:snapshot.fetched_at,runs:snapshot.runs};
  }catch(e){store.discovery={error:e.message};}
}
function persist(next) {
  try { localStorage.setItem(DATA_KEY,JSON.stringify(next)); } catch { throw new Error('保存失败：浏览器存储空间不足，请导出备份'); }
  data=next;
}
async function readAll(table,order) {
  const all=[];
  for(let offset=0;;offset+=1000) {
    const batch=await request(`/rest/v1/${table}?select=*&order=${order}.asc,id.asc&limit=1000&offset=${offset}`);
    all.push(...batch); if(batch.length<1000) return all;
  }
}
async function request(path,{method='GET',body,headers={},anonymous=false}={}) {
  if(!anonymous && session?.refresh_token && session.expires_at < Date.now()/1000+60) {
    const refresh = await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token},anonymous:true});
    session={...refresh,expires_at:Math.floor(Date.now()/1000)+refresh.expires_in};
    localStorage.setItem(SESSION_KEY,JSON.stringify(session));
  }
  const response=await fetch(config.supabaseUrl.replace(/\/$/,'')+path,{method,headers:{apikey:config.supabaseKey,Authorization:`Bearer ${!anonymous&&session?.access_token?session.access_token:config.supabaseKey}`,'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
  const raw=await response.text(); let result;
  try {result=raw?JSON.parse(raw):null;} catch {throw new Error('服务器返回了无法识别的数据');}
  if(!response.ok) throw new Error(result?.msg||result?.message||result?.error_description||'请求失败，请检查连接或登录状态');
  return result;
}

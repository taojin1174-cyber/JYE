import test from 'node:test';
import assert from 'node:assert/strict';

// 云端模式下的备份导入：产品按「品类+名称+状态+规格」对齐，报价过滤未来日期后去重插入。
test('本机备份可合并进共享数据库，产品 id 自动对齐云端',async()=>{
  const memory=new Map();
  globalThis.localStorage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
  const calls=[];
  const reply=(value,status=200)=>({ok:status<400,status,text:async()=>JSON.stringify(value)});
  globalThis.fetch=async(url,opts={})=>{
    const target=String(url),method=(opts.method||'GET').toUpperCase();
    calls.push({target,method,body:opts.body?JSON.parse(opts.body):null});
    if(target.includes('/rest/v1/products?select='))return reply([{id:'chicken-fresh',category:'鸡',name:'白羽鸡',state:'鲜品',spec:'白条整鸡 · 1–1.5 kg/只'}]);
    if(target.includes('/rest/v1/members'))return reply([{id:'u1',email:'me@example.com',display_name:'管理员',role:'admin',active:true}]);
    if(target.includes('/rest/v1/rpc/member_role'))return reply('admin');
    if(method==='POST')return reply(null,201);
    return reply([]);
  };
  const {config}=await import('../config.js');
  config.supabaseUrl='https://demo.supabase.co';
  config.supabaseKey='sb_publishable_demo';
  const {store}=await import('../src/store.js');
  store.member={id:'u1',role:'admin',active:true};store.role='admin';store.user={id:'u1',email:'me@example.com'};

  const backup={
    products:[{id:'local-chicken',category:'鸡',name:'白羽鸡',state:'鲜品',spec:'白条整鸡 · 1–1.5 kg/只'}],
    quotes:[
      {id:'q-ok',product_id:'local-chicken',supplier:'甲供应商',province:'广东',city:'清远',price:12.5,basis:'factory',source:'manual',quoted_on:'2026-11-01',valid_until:'2026-11-30',status:'approved',deleted_at:null},
      {id:'q-future',product_id:'local-chicken',supplier:'乙供应商',province:'广东',price:13,basis:'factory',source:'manual',quoted_on:'2099-01-01',valid_until:'2099-01-31'},
      {id:'q-bad-basis',product_id:'local-chicken',supplier:'丙供应商',province:'广东',price:14,basis:'kilo',source:'manual',quoted_on:'2026-11-02',valid_until:'2026-11-30'},
    ],
  };
  const view=await store.importBackup(JSON.stringify(backup));
  assert.ok(Array.isArray(view.quotes),'导入后应返回视图数据');

  const productInsert=calls.filter(c=>c.method==='POST'&&c.target.endsWith('/rest/v1/products'));
  assert.equal(productInsert.length,0,'同组合产品已存在时不应重复插入');

  const quotePost=calls.filter(c=>c.method==='POST'&&c.target.includes('/rest/v1/quotes'));
  const rows=quotePost.flatMap(c=>c.body);
  assert.equal(rows.length,1,'只保留日期与口径合法的报价');
  assert.equal(rows[0].id,'q-ok');
  assert.equal(rows[0].product_id,'chicken-fresh','product_id 应对齐到云端已有 id');
  assert.equal(rows[0].deleted_at,undefined,'本机回收站字段不应写进共享库');
  assert.match(store.lastImportMessage,/产品 1 个、报价 1 条/);
});

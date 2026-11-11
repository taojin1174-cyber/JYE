import test from 'node:test';
import assert from 'node:assert/strict';

// 登录页只保留密码框：输入的口令按 config.loginPin → config.loginPassword 换算，
// 邮箱取自 config.loginEmail，调用方无需（也无法）再填邮箱。
test('登录只传口令时按配置换算成账号密码并提交',async()=>{
  const memory=new Map();
  globalThis.localStorage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
  const calls=[];
  const reply=(value,status=200)=>({ok:status<400,status,text:async()=>JSON.stringify(value)});
  globalThis.fetch=async(url,opts={})=>{
    const target=String(url),method=(opts.method||'GET').toUpperCase();
    calls.push({target,method,body:opts.body?JSON.parse(opts.body):null});
    if(target.includes('/auth/v1/token'))return reply({access_token:'token-demo',expires_in:3600,user:{id:'u1',email:'ops@example.com'}});
    if(target.includes('/auth/v1/user'))return reply({id:'u1',email:'ops@example.com'});
    if(target.includes('/rest/v1/members'))return reply([{id:'u1',email:'ops@example.com',display_name:'管理员',role:'admin',active:true,must_change_password:false}]);
    if(target.includes('/rest/v1/rpc/member_role'))return reply('admin');
    if(method==='POST')return reply(null,201);
    return reply([]);
  };

  const {config}=await import('../config.js');
  config.supabaseUrl='https://demo.supabase.co';
  config.supabaseKey='sb_publishable_demo';
  config.loginEmail='ops@example.com';
  config.loginPin='PIN-5';
  config.loginPassword='PIN-5-LONG';
  const {store}=await import('../src/store.js');

  await store.login('PIN-5');
  const first=calls.find(c=>c.target.includes('/auth/v1/token'));
  assert.equal(first.body.email,'ops@example.com','邮箱应取自配置，前端不再填写');
  assert.equal(first.body.password,'PIN-5-LONG','页面口令应换算成账号系统密码');

  store.clearSession();calls.length=0;
  await store.login('PIN-5-LONG');
  const second=calls.find(c=>c.target.includes('/auth/v1/token'));
  assert.equal(second.body.password,'PIN-5-LONG','直接输入账号密码也应可用');
});

test('口令与账号密码相同时原样提交',async()=>{
  const memory=new Map();
  globalThis.localStorage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
  const calls=[];
  const reply=(value,status=200)=>({ok:status<400,status,text:async()=>JSON.stringify(value)});
  globalThis.fetch=async(url,opts={})=>{
    const target=String(url),method=(opts.method||'GET').toUpperCase();
    calls.push({target,method,body:opts.body?JSON.parse(opts.body):null});
    if(target.includes('/auth/v1/token'))return reply({access_token:'t',expires_in:3600,user:{id:'u1'}});
    if(target.includes('/auth/v1/user'))return reply({id:'u1'});
    if(target.includes('/rest/v1/members'))return reply([{id:'u1',role:'admin',active:true}]);
    if(target.includes('/rest/v1/rpc/member_role'))return reply('admin');
    if(method==='POST')return reply(null,201);
    return reply([]);
  };
  const {config}=await import('../config.js');
  config.supabaseUrl='https://demo.supabase.co';
  config.supabaseKey='sb_publishable_demo';
  config.loginEmail='ops@example.com';
  config.loginPin='A1234';
  config.loginPassword='A1234';
  const {store}=await import('../src/store.js');
  await store.login('A1234');
  const call=calls.find(c=>c.target.includes('/auth/v1/token'));
  assert.equal(call.body.password,'A1234');
  assert.equal(call.body.email,'ops@example.com');
});

import test from 'node:test';
import assert from 'node:assert/strict';
test('个人试运行隔离旧演示存储，从空报价库启动',async()=>{
  const memory=new Map([['hqt-data-v1',JSON.stringify({quotes:[{id:'old-demo'}],products:[]})]]);
  globalThis.localStorage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
  globalThis.fetch=async()=>({ok:true,json:async()=>({items:[],runs:[]})});
  const {store}=await import('../src/store.js');
  const data=await store.init();
  assert.equal(data.quotes.length,0);assert.equal(data.products.length,10);assert.equal(store.trial,true);
  assert.equal(JSON.parse(memory.get('hqt-data-v1')).quotes[0].id,'old-demo');
});

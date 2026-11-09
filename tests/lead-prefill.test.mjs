import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leadPrefill } from '../src/lead-prefill.js';

test('核实入库带入原文产品及地区，不猜测鲜冻、规格、有效期和起订量',()=>{
 const {product,quote}=leadPrefill({title:'老鹅',category:'鹅',price_text:'18.50 元/公斤',region_text:'河南郑州市',published_on:'2026-11-09',source_name:'肉交所',url:'https://example.com/goose',details:'原文货量：1000 公斤（不是起订量）'});
 assert.deepEqual(product,{category:'鹅',name:'老鹅',state:'',spec:''});
 assert.equal(quote.price,18.5);assert.equal(quote.province,'河南');assert.equal(quote.city,'郑州市');
 for(const key of ['valid_until','min_order','basis','supplier'])assert.equal(quote[key],'');
 assert.equal(quote.status,'pending');assert.equal(quote.source_url,'https://example.com/goose');
});

test('明确标注的状态和规格保留；价格换算后仍可在表单修改',()=>{
 const {product,quote}=leadPrefill({title:'冻鹅掌',category:'鹅',spec:'10 kg/箱',price_text:'20 元/斤',region_text:'',city:'佛山'});
 assert.equal(product.state,'冻品');assert.equal(product.spec,'10 kg/箱');assert.equal(quote.price,40);assert.equal(quote.city,'佛山');
 assert.equal(leadPrefill({title:'鸡肉',price_text:'面议'}).quote.price,'');
});

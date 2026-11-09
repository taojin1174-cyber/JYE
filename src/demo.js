import { dayString, shiftDay } from './core.js';
export const defaultProducts = [
  {id:'chicken-fresh',category:'鸡',name:'白羽鸡',state:'鲜品',spec:'白条整鸡 · 1–1.5 kg/只'},
  {id:'chicken-frozen',category:'鸡',name:'白羽鸡',state:'冻品',spec:'白条整鸡 · 1–1.5 kg/只'},
  {id:'chicken-leg',category:'鸡',name:'鸡腿',state:'冻品',spec:'单冻琵琶腿 · 80–100 g/只'},
  {id:'pig-fresh',category:'猪',name:'猪肉',state:'鲜品',spec:'白条猪 · 一级'},
  {id:'pig-belly',category:'猪',name:'五花肉',state:'冻品',spec:'去骨带皮 · 标准块'},
  {id:'duck-frozen',category:'鸭',name:'白条鸭',state:'冻品',spec:'整鸭 · 1.5–2 kg/只'},
  {id:'duck-fresh',category:'鸭',name:'白条鸭',state:'鲜品',spec:'整鸭 · 1.5–2 kg/只'},
  {id:'goose-fresh',category:'鹅',name:'白条鹅',state:'鲜品',spec:'整鹅 · 3–4 kg/只'},
  {id:'lamb-fresh',category:'羊',name:'羊肉',state:'鲜品',spec:'胴体 · 绵羊 · 一级'},
  {id:'lamb-frozen',category:'羊',name:'羊腿',state:'冻品',spec:'带骨后腿 · 2–3 kg/只'},
];
export function createDemo() {
  const today = dayString();
  const locations = [['山东','潍坊'],['河南','郑州'],['江苏','徐州'],['安徽','宿州'],['河北','石家庄'],['广东','广州'],['四川','成都'],['湖北','武汉']];
  const prices = [13.4,12.1,14.8,22.6,24.8,12.8,14.5,33.6,58.2,47.5];
  const quotes = [];
  defaultProducts.forEach((p, pi) => {
    for (let d = 13; d >= 0; d--) {
      for (let s = 0; s < 6; s++) {
        const [province,city] = locations[(s+pi)%locations.length];
        const quoted_on = shiftDay(today,-d);
        quotes.push({id:`demo-${pi}-${d}-${s}`, product_id:p.id, supplier:`${city}${['农牧食品','禽业供销','肉联供应','生鲜批发','冷链食品','牧源食品'][s]}`, province,city,
          price:Math.round((prices[pi] + (s-2.5)*0.18 + Math.sin(d*0.7+pi)*0.27 + d*0.035)*100)/100,
          basis:'factory', source:s%3===0?'engine':'manual', source_name:s%3===0?'演示行情源':'电话询价（演示）', source_url:'',
          quoted_on,valid_until:shiftDay(quoted_on,2),status:'approved',min_order:'500 kg',freight:s%2===0?0.6:null,
          notes:'演示数据，仅用于体验界面，不代表真实市场价格。',created_at:`${quoted_on}T08:00:0${s}+08:00`,created_by:null,reviewed_by:null});
      }
    }
  });
  for(let i=0;i<5;i++) quotes.push({...quotes.find(q=>q.product_id===defaultProducts[i*2].id && q.quoted_on===today), id:`pending-${i}`, supplier:`待核验供应商 ${i+1}`, price:prices[i*2]-0.7, status:'pending', source:'engine',source_name:'演示采集源',notes:'请核对产品规格、供应商及计价口径后确认。'});
  return {products:structuredClone(defaultProducts),quotes};
}

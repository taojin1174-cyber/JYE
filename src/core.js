export const provinces = ['北京','天津','河北','山西','内蒙古','辽宁','吉林','黑龙江','上海','江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','广西','海南','重庆','四川','贵州','云南','西藏','陕西','甘肃','青海','宁夏','新疆','台湾','香港','澳门'];
export const bases = { factory: '出厂 · 含税 · 不含运', delivered: '到货 · 含税', untaxed: '出厂 · 未税 · 不含运' };
export const statuses = { approved: '已入库', pending: '待确认', rejected: '已忽略' };
export function dayString(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).format(date);
}
// 日期偏移使用中午，避免 UTC 切日。所有行情日期均为北京时间自然日。
export function shiftDay(day, delta) { return dayString(new Date(Date.parse(day + 'T12:00:00+08:00') + delta * 86400000)); }
export function normalizePrice(price, unit) {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) throw new Error('价格须大于 0');
  if (!['kg','jin','ton'].includes(unit)) throw new Error('不支持的计价单位');
  return Math.round(n * ({ kg:1, jin:2, ton:0.001 }[unit]) * 10000) / 10000;
}
export const money = value => value == null ? '—' : Number(value).toFixed(2);
export function matchesLeadCategory(lead,category) {
  return !category || lead.category===category || String(lead.title||'').includes(category);
}
export function isValidQuote(q, day = dayString()) {
  return !q.deleted_at && q.status === 'approved' && q.quoted_on <= day && q.valid_until >= day && Number.isFinite(Number(q.price)) && Number(q.price) > 0;
}
export function latestQuotes(quotes, {day = dayString(), days = 7, productId = '', category = '', products = [], province = '', basis = 'factory', source = ''} = {}) {
  const start = shiftDay(day, -(days - 1));
  const bySupplier = new Map();
  for (const q of quotes) {
    if (!isValidQuote(q, day) || q.quoted_on < start) continue;
    if (productId && q.product_id !== productId) continue;
    if (category && products.find(p => p.id === q.product_id)?.category !== category) continue;
    if (province && q.province !== province) continue;
    if (basis && q.basis !== basis) continue;
    if (source && q.source !== source) continue;
    const key = [q.product_id, q.supplier.trim().toLowerCase(), q.province, q.basis].join('|');
    const old = bySupplier.get(key);
    if (!old || q.quoted_on > old.quoted_on || (q.quoted_on === old.quoted_on && Date.parse(q.created_at) > Date.parse(old.created_at))) bySupplier.set(key, q);
  }
  return [...bySupplier.values()];
}
export function summarize(quotes) {
  if (!quotes.length) return { count:0, average:null, median:null, min:null, max:null, provinceCount:0, sparse:true };
  const values = quotes.map(q => Number(q.price)).sort((a,b) => a-b);
  const n = values.length;
  const provinceCount = new Set(quotes.map(q => q.province)).size;
  return { count:n, average:values.reduce((a,b) => a+b,0)/n, median:n%2 ? values[(n-1)/2] : (values[n/2-1]+values[n/2])/2, min:values[0], max:values[n-1], provinceCount, sparse:n<5 || provinceCount<3 };
}
export function trend(quotes, options, count = 7) {
  const end = options.day || dayString();
  return Array.from({length:count}, (_,i) => {
    const day = shiftDay(end, i-count+1);
    return { day, ...summarize(latestQuotes(quotes, {...options, day})) };
  });
}
export function validateQuote(q, products, today = dayString()) {
  if (!products.some(p => p.id === q.product_id)) throw new Error('请选择产品');
  if (!q.supplier?.trim()) throw new Error('请填写供应商或市场名称');
  if (!provinces.includes(q.province)) throw new Error('请选择省份');
  if (!bases[q.basis]) throw new Error('请选择价格口径');
  if (!['manual','engine'].includes(q.source)) throw new Error('来源类型无效');
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && dayString(new Date(value+'T12:00:00+08:00')) === value;
  if (!validDate(q.quoted_on) || q.quoted_on > today) throw new Error('请填写有效报价日，且不能晚于今天');
  if (!validDate(q.valid_until) || q.valid_until < q.quoted_on) throw new Error('有效期须为有效日期，且不能早于报价日');
  if (!Number.isFinite(Number(q.price)) || Number(q.price) <= 0) throw new Error('价格须大于 0');
  if (q.source_url && !/^https?:\/\//i.test(q.source_url)) throw new Error('来源链接须以 https:// 或 http:// 开头');
  if (q.freight != null && (!Number.isFinite(Number(q.freight)) || Number(q.freight)<0)) throw new Error('运费不能为负数');
  return q;
}
export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"','""') + '"';
}

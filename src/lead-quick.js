// 「核实入库」一键确认：把采集线索里已有的公开事实直接组装成一条完整报价。
// 原则：只带入原文事实；系统补全的部分（规格归类、计价口径、有效期、报价日）
// 一律写进备注并在确认卡上标出来，入库后仍可在报价详情里改，不静默编造。
import { dayString, shiftDay, provinces, bases, normalizePrice } from './core.js';

const FROZEN = {
  '清远鸡': { id: 'frozen-qingyuan-chicken', category: '鸡', name: '清远鸡' },
  '白条鹅': { id: 'frozen-white-goose', category: '鹅', name: '白条鹅' },
  '清远麻鸡': { id: 'frozen-qingyuan-ma-chicken', category: '鸡', name: '清远麻鸡' },
  '鸽子': { id: 'frozen-pigeon', category: '鸽', name: '鸽子' },
};
const SPEC = '冻品 · 规格待核实';
const pick = (details, key) => {
  const m = String(details || '').match(new RegExp(`${key}：([^；。]*)[；。]`));
  return m ? m[1].trim() : '';
};

export function buildQuickQuote(lead, products, today = dayString()) {
  const details = String(lead.details || '');
  const region = String(lead.region_text || '');
  const match = String(lead.price_text || '').match(/^(\d+(?:\.\d+)?)\s*元\s*\/\s*(公斤|千克|斤|吨)$/);
  const price = match ? normalizePrice(match[1], { '公斤': 'kg', '千克': 'kg', '斤': 'jin', '吨': 'ton' }[match[2]]) : '';
  const province = provinces.find(p => region.startsWith(p)) || '';
  const city = province ? region.slice(province.length) : region;

  const catLabel = pick(details, '品类').replace(/（[^）]*）$/, '');
  const preset = FROZEN[catLabel] || { id: 'frozen-other', category: lead.category || '其他', name: '其他冻品' };
  const hint = pick(details, '鲜冻线索');
  const state = /鲜/.test(hint) && !/冻/.test(hint) ? '鲜品' : '冻品';
  const draft = { category: preset.category, name: preset.name, state, spec: SPEC };
  const product = products.find(p => p.id === preset.id) || { id: preset.id, ...draft };

  const contact = pick(details, '联系人');
  const phone = pick(details, '电话').replace(/（.*$/, '');
  const specClue = pick(details, '规格/单个重量');
  const volume = pick(details, '原文货量');
  const supplierRegion = pick(details, '供应商地区');
  const originalDate = String(lead.published_on || '');
  const staleDays = /^\d{4}-\d{2}-\d{2}$/.test(originalDate)
    ? Math.round((Date.parse(`${today}T12:00:00+08:00`) - Date.parse(`${originalDate}T12:00:00+08:00`)) / 86400000)
    : null;
  const quoted_on = today;
  const valid_until = shiftDay(today, 7);
  const supplier = contact ? `${contact}（${lead.source_name || '肉交所'}）` : String(lead.title || '未注明供应商');

  const notes = [
    `原文产品：${lead.title || ''}；标价：${lead.price_text || '见原文'}；原文发布日期：${originalDate || '未注明'}（价格需向供货商复核）`,
    `仓库地区：${region || '未注明'}；供应商地区：${supplierRegion || '未注明'}；联系人：${contact || '未公开'}；电话：${phone || '未公开'}（平台脱敏）`,
    `规格/单个重量：${specClue || '待核实'}；原文货量：${volume || '未注明'}（发布量，不是起订量）`,
    `★ 系统补全（可修改）：产品规格按「${preset.category} / ${preset.name} / ${state} / 规格待核实」归类；计价口径暂按「${bases.factory}」记录，原文未注明税运条件；报价日按核实当天 ${quoted_on}，有效期默认 +7 天；起订量与运费待询。`,
  ].join('\n');

  const quote = {
    id: '',
    product_id: product.id,
    supplier,
    province,
    city,
    price,
    basis: 'factory',
    source: 'engine',
    source_name: lead.source_name || '',
    source_url: lead.url || '',
    quoted_on,
    valid_until,
    status: 'approved',
    min_order: '',
    freight: null,
    notes,
    collection_item_id: lead.id,
  };

  const reasons = [];
  if (!price) reasons.push('原文未给出可折算的单一单价（区间价 / 面议），需手工填写价格');
  if (!province) reasons.push('原文地区无法匹配到省份，需手工选择省份');
  if (!lead.url) reasons.push('缺少原文链接');

  const rows = [
    { label: '产品 / 规格', value: `${preset.category} · ${preset.name} · ${state} · 规格待核实`, note: '按品类自动归类' },
    { label: '供货价', value: price ? `¥ ${price} / kg` : '待填写', note: `原文 ${lead.price_text || '见原文'}` },
    { label: '供应商', value: supplier, note: contact ? '原文联系人' : '按原文标题暂记' },
    { label: '地区', value: `${province}${city ? ' · ' + city : ''}`, note: '原文仓库地址' },
    { label: '报价日 / 有效期', value: `${quoted_on} → ${valid_until}`, note: '今天 + 默认 7 天' },
    { label: '计价口径', value: bases.factory, note: '默认值，原文未注明' },
  ];

  return { ok: reasons.length === 0, reasons, quote, product, rows, contact, phone, specClue, originalDate, staleDays };
}

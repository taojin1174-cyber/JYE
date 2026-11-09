import { matchesLeadCategory } from './core.js';

export function filterExport(data, filters) {
  if (filters.from && filters.to && filters.from > filters.to) throw new Error('开始日期不能晚于结束日期');
  const leads = filters.type === 'leads';
  return (leads ? data.leads || [] : data.quotes || []).filter(row => {
    const product = data.products.find(p => p.id === row.product_id);
    const date = leads ? row.published_on : row.quoted_on;
    return !row.deleted_at
      && (!filters.category || (leads ? matchesLeadCategory(row, filters.category) : product?.category === filters.category))
      && (!filters.product || row.product_id === filters.product)
      && (!filters.province || row.province === filters.province)
      && (!filters.status || row.status === filters.status)
      && (!filters.source || row.source === filters.source)
      && (!filters.from || (date && date >= filters.from))
      && (!filters.to || (date && date <= filters.to));
  });
}

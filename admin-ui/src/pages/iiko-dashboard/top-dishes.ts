import { valueFor, type Report } from './model';

export interface TopDish {
  key: string;
  name: string;
  unit: string;
  quantity: number;
  revenue: number | null;
}

export function topDishes(rows: Report['rows']): TopDish[] {
  const products = new Map<string, TopDish>();
  rows.forEach((row, index) => {
    const quantity = valueFor(row, 'DishAmountInt');
    if (quantity === null) return;
    const unit = String(row.DishMeasureUnit ?? '').trim();
    const id = String(row.DishId ?? '').trim();
    // Missing IDs cannot safely identify products by name.
    const key = JSON.stringify(id ? ['product', id, unit] : ['row', index, unit]);
    const name = String(row.DishName ?? '').trim();
    const revenue = valueFor(row, 'DishDiscountSumInt');
    const product = products.get(key);
    if (product) {
      product.quantity += quantity;
      if (product.revenue !== null)
        product.revenue = revenue === null ? null : product.revenue + revenue;
      if (product.name === '—' && name) product.name = name;
    } else {
      products.set(key, { key, name: name || '—', unit, quantity, revenue });
    }
  });
  return [...products.values()]
    .filter((product) => product.quantity > 0)
    .sort(
      (a, b) =>
        b.quantity - a.quantity || a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
    )
    .slice(0, 10);
}

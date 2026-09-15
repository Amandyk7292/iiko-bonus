import { create } from 'qrcode';
import { productPublicUrl } from './product-qr';
import { buildPriceLabel, browserLabelMeasure, type PriceLabelDraft } from './price-label';
import {
  resolveIikoProductPrices,
  indexProductOverrides,
  indexCategoryOverrides,
  type IikoProduct,
  type ProductOverride,
  type CategoryOverride,
  type CustomProduct,
} from '../pages/menu/menu-page.shared';

export interface LabelMenu {
  profileKey?: string;
  rawMenu?: { products?: IikoProduct[]; isStale?: boolean };
  overrides?: {
    products?: ProductOverride[];
    categories?: CategoryOverride[];
    customProducts?: CustomProduct[];
  };
}
export interface LabelProduct extends Omit<PriceLabelDraft, 'background'> {
  id: string;
}
export function labelProducts(menu: LabelMenu): LabelProduct[] {
  const overrides = indexProductOverrides(menu.overrides?.products);
  const categories = indexCategoryOverrides(menu.overrides?.categories);
  const products: LabelProduct[] = [];
  for (const item of resolveIikoProductPrices(menu.rawMenu?.products)) {
    const extra = overrides[item.id];
    if (
      extra?.is_stop_listed ||
      extra?.is_hidden ||
      categories[extra?.custom_category_id || item.parentGroup || '']?.is_hidden
    )
      continue;
    products.push({
      id: item.id,
      nameRu: extra?.custom_name || item.name,
      nameKk: extra?.name_translations?.kk || '',
      price: String(extra?.custom_price ?? item.price ?? 0),
      ingredientsRu: extra?.ingredients || extra?.ingredients_translations?.ru || '',
      ingredientsKk: extra?.ingredients_translations?.kk || '',
    });
  }
  for (const item of menu.overrides?.customProducts || []) {
    if (!item.id || item.is_available === false) continue;
    products.push({
      id: item.id,
      nameRu: item.name,
      nameKk: '',
      price: String(item.price),
      ingredientsRu: item.ingredients || item.ingredients_translations?.ru || '',
      ingredientsKk: item.ingredients_translations?.kk || '',
    });
  }
  return products.sort((a, b) => a.nameRu.localeCompare(b.nameRu, 'ru'));
}

export function batchLabel(product: LabelProduct, background: string, includeQr: boolean) {
  const draft = { ...product, background };
  const qr = includeQr
    ? create(productPublicUrl(product.id), { errorCorrectionLevel: 'M' }).modules
    : undefined;
  const measure = browserLabelMeasure();
  let result = buildPriceLabel(draft, measure, qr, true);
  let shortened = false;
  // Do not change product data: shorten only overflowing composition on this printed copy.
  for (const field of ['ingredientsRu', 'ingredientsKk'] as const) {
    while (result.errors[field]?.includes('помещается') && draft[field].length > 2) {
      draft[field] = draft[field].replace(/…$/, '').slice(0, -8).trimEnd() + '…';
      shortened = true;
      result = buildPriceLabel(draft, measure, qr, true);
    }
  }
  if (!result.fits) throw new Error(`${product.nameRu}: ${Object.values(result.errors).join(' ')}`);
  return { svg: result.svg, shortened };
}

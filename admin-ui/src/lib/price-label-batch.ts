import { create } from 'qrcode';
import { productPublicUrl } from './product-qr';
import { buildPriceLabel, browserLabelMeasure, type PriceLabelDraft } from './price-label';
import {
  resolveIikoProductPrices,
  indexProductOverrides,
  indexCategoryOverrides,
  type IikoProduct,
  type IikoGroup,
  type ProductOverride,
  type CategoryOverride,
  type CustomProduct,
} from '../pages/menu/menu-page.shared';

export interface LabelMenu {
  profileKey?: string;
  rawMenu?: { products?: IikoProduct[]; groups?: IikoGroup[]; isStale?: boolean };
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
  const groups = menu.rawMenu?.groups || [];
  const hasExplicitIncludedGroups = groups.some((group) => group.isIncludedInMenu === true);
  const normalizedCategoryName = (value: string | undefined) =>
    String(value || '')
      .trim()
      .toLocaleLowerCase('ru-RU');
  const hiddenCategoryNames = new Set(
    groups
      .filter((group) => categories[group.id]?.is_hidden)
      .map((group) => normalizedCategoryName(group.name))
      .filter(Boolean),
  );
  const printableCategoryIds = new Set(
    groups
      .filter((group) => !hasExplicitIncludedGroups || group.isIncludedInMenu === true)
      .filter(
        (group) =>
          !categories[group.id]?.is_hidden &&
          !hiddenCategoryNames.has(normalizedCategoryName(group.name)),
      )
      .map((group) => group.id),
  );
  const products: LabelProduct[] = [];
  for (const item of resolveIikoProductPrices(menu.rawMenu?.products)) {
    const extra = overrides[item.id];
    const categoryId = extra?.custom_category_id || item.parentGroup || '';
    if (
      extra?.is_stop_listed ||
      extra?.is_hidden ||
      categories[categoryId]?.is_hidden ||
      (groups.length > 0 && !printableCategoryIds.has(categoryId))
    )
      continue;
    products.push({
      id: item.id,
      nameRu: extra?.custom_name || item.name,
      nameKk: extra?.name_translations?.kk || '',
      price: String(extra?.custom_price ?? item.price ?? 0),
      ingredientsRu:
        extra?.custom_description ||
        extra?.description_translations?.ru ||
        item.description ||
        extra?.ingredients ||
        extra?.ingredients_translations?.ru ||
        '',
      ingredientsKk:
        extra?.description_translations?.kk || extra?.ingredients_translations?.kk || '',
    });
  }
  for (const item of menu.overrides?.customProducts || []) {
    if (
      !item.id ||
      item.is_available === false ||
      hiddenCategoryNames.has(normalizedCategoryName(item.category_name))
    )
      continue;
    products.push({
      id: item.id,
      nameRu: item.name,
      nameKk: '',
      price: String(item.price),
      ingredientsRu:
        item.description ||
        item.description_translations?.ru ||
        item.ingredients ||
        item.ingredients_translations?.ru ||
        '',
      ingredientsKk: item.description_translations?.kk || item.ingredients_translations?.kk || '',
    });
  }
  return products.sort((a, b) => a.nameRu.localeCompare(b.nameRu, 'ru'));
}

export function batchLabel(
  product: LabelProduct,
  background: string,
  includeQr: boolean,
  textColor?: string,
) {
  const draft = { ...product, background };
  const qr = includeQr
    ? create(productPublicUrl(product.id), { errorCorrectionLevel: 'M' }).modules
    : undefined;
  const measure = browserLabelMeasure();
  const result = buildPriceLabel(draft, measure, qr, true, textColor);
  if (!result.fits) throw new Error(`${product.nameRu}: ${Object.values(result.errors).join(' ')}`);
  return { svg: result.svg };
}

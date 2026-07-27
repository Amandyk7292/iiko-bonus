const crypto = require('crypto');
const { supabase } = require('../config/supabase');

const optionError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const standardOptionTranslations = {
  size: { ru: 'Размер', kk: 'Өлшем', en: 'Size' },
  размер: { ru: 'Размер', kk: 'Өлшем', en: 'Size' },
  addons: { ru: 'Добавки', kk: 'Қоспалар', en: 'Add-ons' },
  добавки: { ru: 'Добавки', kk: 'Қоспалар', en: 'Add-ons' },
  packaging: { ru: 'Упаковка', kk: 'Қаптама', en: 'Packaging' },
  упаковка: { ru: 'Упаковка', kk: 'Қаптама', en: 'Packaging' },
  small: { ru: 'Маленький', kk: 'Кішкентай', en: 'Small' },
  маленький: { ru: 'Маленький', kk: 'Кішкентай', en: 'Small' },
  medium: { ru: 'Средний', kk: 'Орташа', en: 'Medium' },
  средний: { ru: 'Средний', kk: 'Орташа', en: 'Medium' },
  large: { ru: 'Большой', kk: 'Үлкен', en: 'Large' },
  большой: { ru: 'Большой', kk: 'Үлкен', en: 'Large' },
  standard: { ru: 'Стандартный', kk: 'Стандартты', en: 'Standard' },
  стандарт: { ru: 'Стандартный', kk: 'Стандартты', en: 'Standard' },
  стандартный: { ru: 'Стандартный', kk: 'Стандартты', en: 'Standard' },
  vanilla: { ru: 'Ванильная', kk: 'Ванильді', en: 'Vanilla' },
  ванильная: { ru: 'Ванильная', kk: 'Ванильді', en: 'Vanilla' },
  chocolate: { ru: 'Шоколадная', kk: 'Шоколадты', en: 'Chocolate' },
  шоколадная: { ru: 'Шоколадная', kk: 'Шоколадты', en: 'Chocolate' },
  red_velvet: { ru: 'Красный бархат', kk: 'Қызыл барқыт', en: 'Red velvet' },
  красный_бархат: { ru: 'Красный бархат', kk: 'Қызыл барқыт', en: 'Red velvet' },
  photo_print: { ru: 'Фотопечать', kk: 'Фотобаспа', en: 'Photo print' },
  фотопечать: { ru: 'Фотопечать', kk: 'Фотобаспа', en: 'Photo print' },
  berries: { ru: 'Ягоды', kk: 'Жидектер', en: 'Berries' },
  ягоды: { ru: 'Ягоды', kk: 'Жидектер', en: 'Berries' },
};

const optionTranslationKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

const localized = (translations, fallback = '') => {
  const source = translations && typeof translations === 'object' ? translations : {};
  const seed = String(source.ru || fallback || '').trim();
  const standard =
    standardOptionTranslations[optionTranslationKey(seed)] ||
    standardOptionTranslations[optionTranslationKey(fallback)];
  const ru = String(standard?.ru || seed).trim();
  const resolve = (language) => {
    const value = String(source[language] || '').trim();
    if (value && optionTranslationKey(value) !== optionTranslationKey(seed)) return value;
    return String(standard?.[language] || value || ru).trim();
  };
  return {
    ru,
    kk: resolve('kk'),
    en: resolve('en'),
  };
};

const normalizeBuilderOptions = (value) =>
  (Array.isArray(value) ? value : []).map((option) => ({
    ...option,
    title: localized(option?.title || option?.translations, option?.name || option?.code),
  }));

const normalizeConfiguration = (row) =>
  row
    ? {
        productId: String(row.product_id),
        productKind: row.product_kind,
        enabled: row.enabled !== false,
        allowInscription: row.allow_inscription === true,
        inscriptionMaxLength: Number(row.inscription_max_length || 80),
        allowCandles: row.allow_candles === true,
        allowReferenceUpload: row.allow_reference_upload === true,
        minLeadHours: Number(row.min_lead_hours || 0),
        maxAdvanceDays: Number(row.max_advance_days || 30),
        weightOptions: normalizeBuilderOptions(row.weight_options),
        fillingOptions: normalizeBuilderOptions(row.filling_options),
        designOptions: normalizeBuilderOptions(row.design_options),
      }
    : null;

const normalizeGroup = (row, options = []) => ({
  id: String(row.id),
  productId: String(row.product_id),
  code: row.code,
  title: localized(row.title_translations, row.code),
  selectionType: row.selection_type,
  required: row.required === true,
  minSelected: Number(row.min_selected || 0),
  maxSelected: Number(row.max_selected || 1),
  sortOrder: Number(row.sort_order || 0),
  options: options.map((option) => ({
    id: String(option.id),
    code: option.code,
    title: localized(option.title_translations, option.code),
    priceDelta: Number(option.price_delta || 0),
    isDefault: option.is_default === true,
    sortOrder: Number(option.sort_order || 0),
  })),
});

async function getProductOptions(productIds) {
  const ids = [...new Set((productIds || []).map(String).filter(Boolean))].slice(0, 200);
  if (!ids.length) return new Map();
  const [{ data: configs, error: configError }, { data: groups, error: groupError }] =
    await Promise.all([
      supabase.from('product_configurations').select('*').in('product_id', ids),
      supabase
        .from('product_modifier_groups')
        .select('*')
        .in('product_id', ids)
        .eq('active', true)
        .order('sort_order'),
    ]);
  if (configError) throw configError;
  if (groupError) throw groupError;
  const groupIds = (groups || []).map((group) => group.id);
  let options = [];
  if (groupIds.length) {
    const { data, error } = await supabase
      .from('product_modifier_options')
      .select('*')
      .in('group_id', groupIds)
      .eq('active', true)
      .order('sort_order');
    if (error) throw error;
    options = data || [];
  }
  const optionsByGroup = new Map();
  for (const option of options) {
    const list = optionsByGroup.get(String(option.group_id)) || [];
    list.push(option);
    optionsByGroup.set(String(option.group_id), list);
  }
  const result = new Map(ids.map((id) => [id, { configuration: null, modifierGroups: [] }]));
  for (const config of configs || []) {
    result.get(String(config.product_id)).configuration = normalizeConfiguration(config);
  }
  for (const group of groups || []) {
    result
      .get(String(group.product_id))
      .modifierGroups.push(normalizeGroup(group, optionsByGroup.get(String(group.id)) || []));
  }
  return result;
}

const optionByCode = (items, value) =>
  items.find((item) => String(item.code) === String(value) || String(item.id) === String(value));

function validateBuilder(configuration, submitted = {}) {
  if (!configuration?.enabled || configuration.productKind === 'standard') return null;
  const result = {};
  let priceDelta = 0;
  for (const [field, options] of [
    ['weight', configuration.weightOptions],
    ['filling', configuration.fillingOptions],
    ['design', configuration.designOptions],
  ]) {
    if (!options.length) continue;
    const selected = optionByCode(options, submitted[field]);
    if (!selected) throw optionError(`Выберите вариант: ${field}`);
    result[field] = {
      code: String(selected.code || selected.id),
      title: localized(selected.title || selected.translations, selected.name || selected.code),
      priceDelta: Number(selected.priceDelta ?? selected.price_delta ?? 0),
    };
    if (!Number.isFinite(result[field].priceDelta) || result[field].priceDelta < 0) {
      throw optionError('Вариант товара настроен некорректно');
    }
    priceDelta += result[field].priceDelta;
  }
  const inscription = String(submitted.inscription || '').trim();
  if (inscription && !configuration.allowInscription) throw optionError('Надпись недоступна');
  if (inscription.length > configuration.inscriptionMaxLength) {
    throw optionError(`Надпись не должна превышать ${configuration.inscriptionMaxLength} символов`);
  }
  const candles = Number(submitted.candles || 0);
  if (!Number.isInteger(candles) || candles < 0 || candles > 99) {
    throw optionError('Некорректное количество свечей');
  }
  if (candles && !configuration.allowCandles) throw optionError('Свечи недоступны');
  const referenceUrl = String(submitted.referenceUrl || '').trim();
  if (referenceUrl && !configuration.allowReferenceUpload) {
    throw optionError('Загрузка примера недоступна');
  }
  let readyAt = null;
  if (submitted.readyAt) {
    const requested = new Date(submitted.readyAt);
    if (Number.isNaN(requested.getTime())) throw optionError('Некорректная дата готовности');
    const now = Date.now();
    if (requested.getTime() < now + configuration.minLeadHours * 3600000) {
      throw optionError(
        `Для товара требуется минимум ${configuration.minLeadHours} ч. на приготовление`,
      );
    }
    if (requested.getTime() > now + configuration.maxAdvanceDays * 86400000) {
      throw optionError(`Заказать можно максимум за ${configuration.maxAdvanceDays} дн.`);
    }
    readyAt = requested.toISOString();
  }
  return {
    ...result,
    inscription: inscription || null,
    candles,
    referenceUrl: referenceUrl || null,
    readyAt,
    priceDelta,
  };
}

function validateModifierGroups(groups, submitted = []) {
  const values = Array.isArray(submitted) ? submitted : [];
  const byGroup = new Map(values.map((entry) => [String(entry.groupId || entry.code), entry]));
  let priceDelta = 0;
  const normalized = [];
  for (const group of groups) {
    const entry = byGroup.get(group.id) || byGroup.get(group.code) || {};
    const rawSelections = Array.isArray(entry.optionIds)
      ? entry.optionIds
      : entry.optionId
        ? [entry.optionId]
        : [];
    const unique = [...new Set(rawSelections.map(String))];
    const minimum = Math.max(group.required ? 1 : 0, group.minSelected);
    if (unique.length < minimum || unique.length > group.maxSelected) {
      throw optionError(
        `Выберите ${minimum === group.maxSelected ? minimum : `${minimum}–${group.maxSelected}`} в «${group.title.ru}»`,
      );
    }
    if (group.selectionType === 'single' && unique.length > 1) {
      throw optionError(`В «${group.title.ru}» можно выбрать только один вариант`);
    }
    const selected = unique.map((id) => {
      const option = optionByCode(group.options, id);
      if (!option) throw optionError(`Один из вариантов «${group.title.ru}» больше недоступен`);
      priceDelta += option.priceDelta;
      return option;
    });
    if (selected.length) normalized.push({ ...group, options: selected });
  }
  return { groups: normalized, priceDelta };
}

async function validateCartOptions(items) {
  const optionMap = await getProductOptions(items.map((item) => item.id));
  let subtotal = 0;
  const canonicalItems = items.map((item) => {
    const options = optionMap.get(String(item.id)) || { configuration: null, modifierGroups: [] };
    const builder = validateBuilder(options.configuration, item.configuration || {});
    const modifiers = validateModifierGroups(options.modifierGroups, item.modifiers || []);
    const unitPrice = Number(item.price) + Number(builder?.priceDelta || 0) + modifiers.priceDelta;
    if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0)
      throw optionError('Некорректная цена опций');
    subtotal += unitPrice * Number(item.quantity);
    const selectionPayload = {
      configuration: builder,
      modifiers: modifiers.groups,
    };
    const lineKey = crypto
      .createHash('sha256')
      .update(`${item.id}:${JSON.stringify(selectionPayload)}`)
      .digest('hex')
      .slice(0, 24);
    return {
      ...item,
      price: unitPrice,
      basePrice: Number(item.price),
      lineKey,
      ...selectionPayload,
    };
  });
  return { canonicalItems, subtotal };
}

async function saveProductOptions(productId, payload = {}) {
  const id = String(productId || '').trim();
  if (!id) throw optionError('Товар не найден');
  const config = payload.configuration || {};
  const configurationRecord = {
    product_id: id,
    product_kind: ['standard', 'cake', 'bakery'].includes(config.productKind)
      ? config.productKind
      : 'standard',
    enabled: config.enabled !== false,
    allow_inscription: config.allowInscription === true,
    inscription_max_length: Number(config.inscriptionMaxLength || 80),
    allow_candles: config.allowCandles === true,
    allow_reference_upload: config.allowReferenceUpload === true,
    min_lead_hours: Number(config.minLeadHours || 0),
    max_advance_days: Number(config.maxAdvanceDays || 30),
    weight_options: Array.isArray(config.weightOptions) ? config.weightOptions : [],
    filling_options: Array.isArray(config.fillingOptions) ? config.fillingOptions : [],
    design_options: Array.isArray(config.designOptions) ? config.designOptions : [],
    updated_at: new Date().toISOString(),
  };
  const { error: configError } = await supabase
    .from('product_configurations')
    .upsert(configurationRecord, { onConflict: 'product_id' });
  if (configError) throw configError;

  const { data: existing, error: readError } = await supabase
    .from('product_modifier_groups')
    .select('id')
    .eq('product_id', id);
  if (readError) throw readError;
  const oldIds = (existing || []).map((row) => row.id);
  if (oldIds.length) {
    const { error } = await supabase.from('product_modifier_groups').delete().in('id', oldIds);
    if (error) throw error;
  }
  for (const [groupIndex, group] of (payload.modifierGroups || []).entries()) {
    const groupRecord = {
      product_id: id,
      code: String(group.code || `group_${groupIndex + 1}`).trim(),
      title_translations: localized(group.title, group.name || `Опция ${groupIndex + 1}`),
      selection_type: group.selectionType === 'multiple' ? 'multiple' : 'single',
      required: group.required === true,
      min_selected: Number(group.minSelected ?? (group.required ? 1 : 0)),
      max_selected: Number(group.maxSelected ?? 1),
      sort_order: groupIndex,
      active: group.active !== false,
      updated_at: new Date().toISOString(),
    };
    const { data: savedGroup, error } = await supabase
      .from('product_modifier_groups')
      .insert(groupRecord)
      .select('id')
      .single();
    if (error) throw error;
    const records = (group.options || []).map((option, optionIndex) => ({
      group_id: savedGroup.id,
      code: String(option.code || `option_${optionIndex + 1}`).trim(),
      title_translations: localized(option.title, option.name || `Вариант ${optionIndex + 1}`),
      price_delta: Number(option.priceDelta || 0),
      is_default: option.isDefault === true,
      sort_order: optionIndex,
      active: option.active !== false,
      updated_at: new Date().toISOString(),
    }));
    if (records.length) {
      const { error: optionErrorResult } = await supabase
        .from('product_modifier_options')
        .insert(records);
      if (optionErrorResult) throw optionErrorResult;
    }
  }
  return (await getProductOptions([id])).get(id);
}

module.exports = {
  getProductOptions,
  normalizeOptionTranslations: localized,
  saveProductOptions,
  validateBuilder,
  validateCartOptions,
  validateModifierGroups,
};

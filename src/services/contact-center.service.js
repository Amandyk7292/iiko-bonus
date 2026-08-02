const { supabase } = require('../config/supabase');

const DISPLAY_MODES = new Set(['standard', 'compact']);
const ACTION_TYPES = new Set([
  'phone',
  'whatsapp',
  'telegram',
  'instagram',
  'vk',
  'email',
  'website',
  'online_chat',
  'custom_url',
]);
const ICON_KEYS = new Set([
  'bulka',
  'phone',
  'whatsapp',
  'telegram',
  'instagram',
  'vk',
  'email',
  'website',
  'chat',
  'link',
]);
const DEFAULT_ACTION_ICONS = {
  phone: 'phone',
  whatsapp: 'whatsapp',
  telegram: 'telegram',
  instagram: 'instagram',
  vk: 'vk',
  email: 'email',
  website: 'website',
  online_chat: 'chat',
  custom_url: 'link',
};
const CARD_SELECT = `
  id,display_mode,title_ru,title_kk,title_en,icon_key,sort_order,is_active,created_at,updated_at,
  contact_actions(id,card_id,action_type,label_ru,label_kk,label_en,target,icon_key,sort_order,is_active,created_at,updated_at)
`;

function contactError(message, statusCode = 400, code = 'CONTACT_VALIDATION_ERROR') {
  return Object.assign(new Error(message), { statusCode, code });
}

function normalizeLocalizedText(input, field, maxLength) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const result = {};
  for (const code of ['ru', 'kk', 'en']) {
    const value = String(source[code] || '').trim();
    if (!value || value.length > maxLength) {
      throw contactError(`${field} must contain three languages within ${maxLength} characters`);
    }
    result[code] = value;
  }
  return result;
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const normalized =
    digits.length === 11 && digits.startsWith('8') ? `7${digits.slice(1)}` : digits;
  if (normalized.length < 10 || normalized.length > 15) {
    throw contactError('Invalid phone target');
  }
  return `+${normalized}`;
}

function hasControlCharacters(value) {
  return [...String(value)].some((character) => {
    const code = character.codePointAt(0);
    return code !== undefined && (code < 32 || code === 127);
  });
}

function normalizeTarget(type, raw) {
  const target = String(raw || '').trim();
  if (type === 'phone') return normalizePhone(target);
  if (type === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target) || target.length > 254) {
      throw contactError('Invalid email target');
    }
    return target.toLowerCase();
  }

  let url;
  try {
    url = new URL(target);
  } catch {
    throw contactError('Target must be an HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || hasControlCharacters(target)) {
    throw contactError('Target must be a safe HTTPS URL');
  }
  return url.toString();
}

function normalizeContactCard(input = {}, { partial = false } = {}) {
  const result = {};

  if (!partial || input.displayMode !== undefined) {
    const mode = String(input.displayMode || 'standard');
    if (!DISPLAY_MODES.has(mode)) throw contactError('Unknown contact display mode');
    result.display_mode = mode;
  }

  if (!partial || input.titles !== undefined) {
    const titles = normalizeLocalizedText(input.titles, 'Card title', 120);
    result.title_ru = titles.ru;
    result.title_kk = titles.kk;
    result.title_en = titles.en;
  }

  if (!partial || input.iconKey !== undefined) {
    const icon = String(input.iconKey || 'bulka');
    if (!ICON_KEYS.has(icon)) throw contactError('Unknown contact icon');
    result.icon_key = icon;
  }

  if (!partial || input.isActive !== undefined) result.is_active = input.isActive === true;

  if (!partial || input.sortOrder !== undefined) {
    const sortOrder = Number(input.sortOrder || 0);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      throw contactError('Invalid contact sort order');
    }
    result.sort_order = sortOrder;
  }

  return result;
}

function normalizeContactAction(input = {}, { partial = false } = {}) {
  const result = {};
  const type = String(input.type || '');

  if (!partial || input.type !== undefined) {
    if (!ACTION_TYPES.has(type)) throw contactError('Unknown contact action type');
    result.action_type = type;
  }

  if (!partial || input.labels !== undefined) {
    const labels = normalizeLocalizedText(input.labels, 'Action label', 80);
    result.label_ru = labels.ru;
    result.label_kk = labels.kk;
    result.label_en = labels.en;
  }

  if (!partial || input.target !== undefined) {
    if (!type) throw contactError('Contact action type is required with target');
    result.target = normalizeTarget(type, input.target);
  }

  if (!partial || input.iconKey !== undefined) {
    const icon = String(input.iconKey || DEFAULT_ACTION_ICONS[type] || 'link');
    if (!ICON_KEYS.has(icon)) throw contactError('Unknown contact icon');
    result.icon_key = icon;
  }

  if (!partial || input.isActive !== undefined) result.is_active = input.isActive !== false;

  if (!partial || input.sortOrder !== undefined) {
    const sortOrder = Number(input.sortOrder || 0);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      throw contactError('Invalid contact sort order');
    }
    result.sort_order = sortOrder;
  }

  return result;
}

function projectPublicCards(rows = []) {
  return rows.map((row) => ({
    id: String(row.id),
    displayMode: row.display_mode,
    titles: { ru: row.title_ru, kk: row.title_kk, en: row.title_en },
    iconKey: row.icon_key,
    actions: (row.contact_actions || []).map((action) => ({
      id: String(action.id),
      type: action.action_type,
      labels: { ru: action.label_ru, kk: action.label_kk, en: action.label_en },
      target: action.target,
      iconKey: action.icon_key,
    })),
  }));
}

function isMissingContactSchema(error) {
  return ['42P01', 'PGRST205'].includes(String(error?.code || ''));
}

function normalizeReorderIds(requestedIds, existingIds) {
  const requested = Array.isArray(requestedIds) ? requestedIds.map(String) : [];
  const existing = Array.isArray(existingIds) ? existingIds.map(String) : [];
  const unique = new Set(requested);
  const sameIds =
    requested.length === existing.length &&
    unique.size === requested.length &&
    [...unique].every((id) => existing.includes(id));
  if (!sameIds) {
    throw contactError('Reorder must contain the complete unique id set');
  }
  return requested.map((id, sortOrder) => ({ id, sort_order: sortOrder }));
}

function validateCompactPublication({ displayMode, isActive, activeActionCount }) {
  if (displayMode === 'compact' && isActive === true && activeActionCount < 1) {
    throw contactError('Compact cards require at least one active action');
  }
}

function schemaUnavailable(error) {
  if (!isMissingContactSchema(error)) return error;
  return contactError('Contact center migration is not installed', 503, 'CONTACT_SCHEMA_MISSING');
}

function sortRows(rows = []) {
  return [...rows].sort(
    (first, second) =>
      Number(first.sort_order || 0) - Number(second.sort_order || 0) ||
      String(first.created_at || '').localeCompare(String(second.created_at || '')),
  );
}

function sortedActions(row, { activeOnly = false } = {}) {
  const actions = Array.isArray(row?.contact_actions) ? row.contact_actions : [];
  return sortRows(activeOnly ? actions.filter((action) => action.is_active !== false) : actions);
}

function adminActionFromRow(row) {
  return {
    id: String(row.id),
    cardId: String(row.card_id),
    type: row.action_type,
    labels: { ru: row.label_ru, kk: row.label_kk, en: row.label_en },
    target: row.target,
    iconKey: row.icon_key,
    sortOrder: Number(row.sort_order || 0),
    isActive: row.is_active !== false,
  };
}

function adminCardFromRow(row) {
  return {
    id: String(row.id),
    displayMode: row.display_mode,
    titles: { ru: row.title_ru, kk: row.title_kk, en: row.title_en },
    iconKey: row.icon_key,
    sortOrder: Number(row.sort_order || 0),
    isActive: row.is_active === true,
    actions: sortedActions(row).map(adminActionFromRow),
  };
}

function cardInputFromRow(row, overrides = {}) {
  return {
    displayMode: overrides.displayMode ?? row.display_mode,
    titles: overrides.titles ?? { ru: row.title_ru, kk: row.title_kk, en: row.title_en },
    iconKey: overrides.iconKey ?? row.icon_key,
    sortOrder: overrides.sortOrder ?? row.sort_order,
    isActive: overrides.isActive ?? row.is_active,
  };
}

function actionInputFromRow(row, overrides = {}) {
  return {
    type: overrides.type ?? row.action_type,
    labels: overrides.labels ?? { ru: row.label_ru, kk: row.label_kk, en: row.label_en },
    target: overrides.target ?? row.target,
    iconKey: overrides.iconKey ?? row.icon_key,
    sortOrder: overrides.sortOrder ?? row.sort_order,
    isActive: overrides.isActive ?? row.is_active,
  };
}

async function readCard(id, { db = supabase } = {}) {
  const { data, error } = await db
    .from('contact_cards')
    .select(CARD_SELECT)
    .eq('id', String(id || ''))
    .maybeSingle();
  if (error) throw schemaUnavailable(error);
  if (!data) throw contactError('Contact card not found', 404, 'CONTACT_NOT_FOUND');
  return data;
}

async function readAction(id, { db = supabase } = {}) {
  const { data, error } = await db
    .from('contact_actions')
    .select('*')
    .eq('id', String(id || ''))
    .maybeSingle();
  if (error) throw schemaUnavailable(error);
  if (!data) throw contactError('Contact action not found', 404, 'CONTACT_NOT_FOUND');
  return data;
}

async function listPublicContactCards({ db = supabase } = {}) {
  const { data, error } = await db
    .from('contact_cards')
    .select(CARD_SELECT)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingContactSchema(error)) return { cards: [], updatedAt: null };
    throw error;
  }

  const rows = sortRows(data || [])
    .map((card) => ({ ...card, contact_actions: sortedActions(card, { activeOnly: true }) }))
    .filter((card) => card.display_mode !== 'compact' || card.contact_actions.length > 0);
  const updatedAt = rows
    .flatMap((card) => [
      card.updated_at,
      ...card.contact_actions.map((action) => action.updated_at),
    ])
    .filter(Boolean)
    .sort()
    .at(-1);
  return { cards: projectPublicCards(rows), updatedAt: updatedAt || null };
}

async function listAdminContactCards({ db = supabase } = {}) {
  const { data, error } = await db
    .from('contact_cards')
    .select(CARD_SELECT)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw schemaUnavailable(error);
  return sortRows(data || []).map(adminCardFromRow);
}

async function createContactCard(input, { db = supabase } = {}) {
  const record = normalizeContactCard(input);
  validateCompactPublication({
    displayMode: record.display_mode,
    isActive: record.is_active,
    activeActionCount: 0,
  });
  const { data, error } = await db
    .from('contact_cards')
    .insert(record)
    .select(CARD_SELECT)
    .single();
  if (error) throw schemaUnavailable(error);
  return adminCardFromRow(data);
}

async function updateContactCard(id, input, { db = supabase } = {}) {
  const current = await readCard(id, { db });
  const record = normalizeContactCard(cardInputFromRow(current, input));
  validateCompactPublication({
    displayMode: record.display_mode,
    isActive: record.is_active,
    activeActionCount: sortedActions(current, { activeOnly: true }).length,
  });
  const { data, error } = await db
    .from('contact_cards')
    .update(record)
    .eq('id', current.id)
    .select(CARD_SELECT)
    .single();
  if (error) throw schemaUnavailable(error);
  return adminCardFromRow(data);
}

async function deleteContactCard(id, { db = supabase } = {}) {
  const current = await readCard(id, { db });
  const { error } = await db.from('contact_cards').delete().eq('id', current.id);
  if (error) throw schemaUnavailable(error);
}

async function reorderContactCards(ids, { db = supabase } = {}) {
  const current = await listAdminContactCards({ db });
  const orderedIds = normalizeReorderIds(
    ids,
    current.map((card) => card.id),
  ).map((row) => row.id);
  const { error } = await db.rpc('reorder_contact_cards', { p_ids: orderedIds });
  if (error) throw schemaUnavailable(error);
  return listAdminContactCards({ db });
}

async function createContactAction(cardId, input, { db = supabase } = {}) {
  const card = await readCard(cardId, { db });
  const record = normalizeContactAction(input);
  const activeActionCount =
    sortedActions(card, { activeOnly: true }).length + (record.is_active ? 1 : 0);
  validateCompactPublication({
    displayMode: card.display_mode,
    isActive: card.is_active,
    activeActionCount,
  });
  const { data, error } = await db
    .from('contact_actions')
    .insert({ ...record, card_id: card.id })
    .select('*')
    .single();
  if (error) throw schemaUnavailable(error);
  return adminActionFromRow(data);
}

async function updateContactAction(id, input, { db = supabase } = {}) {
  const current = await readAction(id, { db });
  const card = await readCard(current.card_id, { db });
  const record = normalizeContactAction(actionInputFromRow(current, input));
  const existingActive = sortedActions(card, { activeOnly: true }).length;
  const activeActionCount =
    existingActive - (current.is_active ? 1 : 0) + (record.is_active ? 1 : 0);
  validateCompactPublication({
    displayMode: card.display_mode,
    isActive: card.is_active,
    activeActionCount,
  });
  const { data, error } = await db
    .from('contact_actions')
    .update(record)
    .eq('id', current.id)
    .select('*')
    .single();
  if (error) throw schemaUnavailable(error);
  return adminActionFromRow(data);
}

async function deleteContactAction(id, { db = supabase } = {}) {
  const current = await readAction(id, { db });
  const card = await readCard(current.card_id, { db });
  const activeActionCount =
    sortedActions(card, { activeOnly: true }).length - (current.is_active ? 1 : 0);
  validateCompactPublication({
    displayMode: card.display_mode,
    isActive: card.is_active,
    activeActionCount,
  });
  const { error } = await db.from('contact_actions').delete().eq('id', current.id);
  if (error) throw schemaUnavailable(error);
}

async function reorderContactActions(cardId, ids, { db = supabase } = {}) {
  const card = await readCard(cardId, { db });
  const actions = sortedActions(card);
  const orderedIds = normalizeReorderIds(
    ids,
    actions.map((action) => String(action.id)),
  ).map((row) => row.id);
  const { error } = await db.rpc('reorder_contact_actions', {
    p_card_id: card.id,
    p_ids: orderedIds,
  });
  if (error) throw schemaUnavailable(error);
  const refreshed = await readCard(card.id, { db });
  return sortedActions(refreshed).map(adminActionFromRow);
}

module.exports = {
  ACTION_TYPES,
  DISPLAY_MODES,
  ICON_KEYS,
  CARD_SELECT,
  contactError,
  createContactAction,
  createContactCard,
  deleteContactAction,
  deleteContactCard,
  isMissingContactSchema,
  listAdminContactCards,
  listPublicContactCards,
  normalizeContactAction,
  normalizeContactCard,
  normalizeReorderIds,
  projectPublicCards,
  reorderContactActions,
  reorderContactCards,
  supabase,
  updateContactAction,
  updateContactCard,
  validateCompactPublication,
};

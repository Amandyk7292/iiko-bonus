const { supabase } = require('../config/supabase');

function normalizeNewsI18n(rawI18n, fallback = {}) {
  const i18n = rawI18n && typeof rawI18n === 'object' ? rawI18n : {};
  const kazakh = i18n.kz || i18n.kk || {};
  return {
    ru: {
      title: i18n.ru?.title || fallback.title || '',
      description: i18n.ru?.description || fallback.description || '',
      imageUrl: i18n.ru?.imageUrl || fallback.imageUrl || '',
    },
    kz: {
      title: kazakh.title || '',
      description: kazakh.description || '',
      imageUrl: kazakh.imageUrl || '',
    },
    en: {
      title: i18n.en?.title || '',
      description: i18n.en?.description || '',
      imageUrl: i18n.en?.imageUrl || '',
    },
  };
}

function parseNewsDescription(rawDescription, fallback = {}) {
  let description = rawDescription || fallback.description || '';
  let rawI18n = fallback.i18n;
  if (typeof rawDescription === 'string' && rawDescription.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(rawDescription);
      if (parsed && (parsed.i18n || parsed.text !== undefined)) {
        description = parsed.text || parsed.i18n?.ru?.description || '';
        rawI18n = parsed.i18n;
      }
    } catch {
      // Keep legacy plain-text descriptions unchanged.
    }
  }
  return {
    description,
    i18n: normalizeNewsI18n(rawI18n, { ...fallback, description }),
  };
}

function serializeNewsDescription(description, i18n) {
  return JSON.stringify({
    text: description || i18n.ru.description || '',
    i18n,
  });
}

function normalizeNews(row, fallback = {}) {
  const image = row.imageurl || row.imageUrl || row.image_url || fallback.imageUrl || '';
  const title = row.title || fallback.title || '';
  const parsed = parseNewsDescription(row.description, {
    ...fallback,
    title,
    imageUrl: image,
  });
  return {
    id: row.id || fallback.id,
    title,
    imageUrl: image,
    imageurl: image,
    description: parsed.description,
    i18n: parsed.i18n,
    created_at: row.created_at || fallback.created_at || null,
  };
}

async function getNews() {
  const { data, error } = await supabase
    .from('news')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading news from Supabase DB:', error.message);
    return [];
  }
  return (data || []).map((row) => normalizeNews(row));
}

async function addNews(item) {
  const i18n = normalizeNewsI18n(item.i18n, item);
  const newItem = {
    title: i18n.ru.title || item.title || 'Новость',
    imageurl: i18n.ru.imageUrl || item.imageUrl || item.imageurl || '',
    description: serializeNewsDescription(item.description, i18n),
  };

  const { data, error } = await supabase.from('news').insert([newItem]).select().single();

  if (error) throw new Error(error.message);
  return normalizeNews(data, { ...item, ...newItem, i18n });
}

async function updateNews(id, item) {
  const i18n = normalizeNewsI18n(item.i18n, item);
  const updatedItem = {
    title: i18n.ru.title || item.title || 'Новость',
    imageurl: i18n.ru.imageUrl || item.imageUrl || item.imageurl || '',
    description: serializeNewsDescription(item.description, i18n),
  };

  const { data, error } = await supabase
    .from('news')
    .update(updatedItem)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return normalizeNews(data, { ...item, ...updatedItem, id, i18n });
}

async function deleteNews(id) {
  const { data, error } = await supabase.from('news').delete().eq('id', id).select('id');

  if (error) throw new Error(error.message);
  return { deleted: (data || []).length };
}

module.exports = {
  addNews,
  deleteNews,
  getNews,
  normalizeNewsI18n,
  parseNewsDescription,
  serializeNewsDescription,
  updateNews,
};

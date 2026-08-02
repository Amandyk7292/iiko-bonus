const { supabase } = require('../config/supabase');

const PROMO_TYPES = new Set(['discount', 'promotion', 'subscription']);

function stringValue(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function nullableString(value) {
  const normalized = stringValue(value).trim();
  return normalized || null;
}

function normalizePromoType(value) {
  return PROMO_TYPES.has(value) ? value : 'promotion';
}

function normalizeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeRemaining(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeI18n(rawI18n, fallbackStory = {}) {
  const i18n = rawI18n && typeof rawI18n === 'object' ? rawI18n : {};
  const kazakh = i18n.kz || i18n.kk || {};
  const ruCover = fallbackStory.coverUrl || fallbackStory.coverurl || '';
  const ruContent = fallbackStory.contentUrl || fallbackStory.contenturl || ruCover;

  return {
    ru: {
      title: stringValue(i18n.ru?.title) || fallbackStory.title || '',
      description: stringValue(i18n.ru?.description) || fallbackStory.description || '',
      details: stringValue(i18n.ru?.details) || fallbackStory.details || '',
      coverUrl: stringValue(i18n.ru?.coverUrl) || ruCover,
      contentUrl: stringValue(i18n.ru?.contentUrl) || ruContent,
    },
    kz: {
      title: stringValue(kazakh.title),
      description: stringValue(kazakh.description),
      details: stringValue(kazakh.details),
      coverUrl: stringValue(kazakh.coverUrl),
      contentUrl: stringValue(kazakh.contentUrl),
    },
    en: {
      title: stringValue(i18n.en?.title),
      description: stringValue(i18n.en?.description),
      details: stringValue(i18n.en?.details),
      coverUrl: stringValue(i18n.en?.coverUrl),
      contentUrl: stringValue(i18n.en?.contentUrl),
    },
  };
}

function parseDescription(descRaw, fallbackStory = {}) {
  let text = stringValue(descRaw);
  let rawI18n = null;
  let metadata = {};

  if (typeof descRaw === 'string' && descRaw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(descRaw);
      if (
        parsed &&
        typeof parsed === 'object' &&
        (parsed.i18n ||
          parsed.text !== undefined ||
          parsed.promoType !== undefined ||
          parsed.details !== undefined)
      ) {
        metadata = parsed;
        rawI18n = parsed.i18n;
        text = stringValue(parsed.text) || parsed.i18n?.ru?.description || '';
      }
    } catch {
      // Legacy rows store the short description as plain text.
    }
  }

  const details =
    stringValue(metadata.details) || rawI18n?.ru?.details || fallbackStory.details || '';
  const i18n = normalizeI18n(rawI18n, {
    ...fallbackStory,
    description: text,
    details,
  });
  const createdAt =
    normalizeDate(fallbackStory.createdAt || fallbackStory.created_at) ||
    normalizeDate(metadata.createdAt);

  return {
    text,
    details,
    i18n,
    promoType: normalizePromoType(metadata.promoType),
    startsAt: normalizeDate(metadata.startsAt),
    endsAt: normalizeDate(metadata.endsAt),
    remaining: normalizeRemaining(metadata.remaining),
    qrValue: nullableString(metadata.qrValue),
    createdAt,
  };
}

function serializeDescription(text, rawI18n, metadata = {}) {
  const i18n = normalizeI18n(rawI18n, {
    description: text,
    details: metadata.details,
  });
  const details = stringValue(metadata.details) || i18n.ru.details;

  return JSON.stringify({
    version: 2,
    text: stringValue(text) || i18n.ru.description,
    details,
    promoType: normalizePromoType(metadata.promoType),
    startsAt: normalizeDate(metadata.startsAt),
    endsAt: normalizeDate(metadata.endsAt),
    remaining: normalizeRemaining(metadata.remaining),
    qrValue: nullableString(metadata.qrValue),
    createdAt: normalizeDate(metadata.createdAt),
    i18n,
  });
}

function normalizeStory(row, fallback = {}) {
  const cover =
    row.coverurl || row.coverUrl || row.cover_url || fallback.coverUrl || fallback.coverurl || '';
  const content =
    row.contenturl ||
    row.contentUrl ||
    row.content_url ||
    fallback.contentUrl ||
    fallback.contenturl ||
    cover;
  const title = row.title || fallback.title || '';
  const groupTitle =
    row.group_title || row.grouptitle || row.groupTitle || fallback.groupTitle || title;
  const groupId = String(
    row.group_id || row.groupid || row.groupId || fallback.groupId || row.id || fallback.id,
  );
  const groupCover =
    row.group_coverurl ||
    row.groupCoverUrl ||
    row.group_cover_url ||
    fallback.groupCoverUrl ||
    cover;
  const parsed = parseDescription(row.description ?? fallback.description, {
    title,
    coverUrl: cover,
    contentUrl: content,
    createdAt: row.created_at || row.createdAt || fallback.createdAt || fallback.created_at,
  });

  return {
    id: row.id || fallback.id,
    title,
    coverUrl: cover,
    contentUrl: content,
    coverurl: cover,
    contenturl: content,
    groupId,
    groupTitle,
    groupCoverUrl: groupCover,
    group_id: groupId,
    group_title: groupTitle,
    group_coverurl: groupCover,
    description: parsed.text,
    details: parsed.details,
    i18n: parsed.i18n,
    promoType: parsed.promoType,
    startsAt: parsed.startsAt,
    endsAt: parsed.endsAt,
    remaining: parsed.remaining,
    qrValue: parsed.qrValue,
    createdAt: parsed.createdAt,
    duration: Number(row.duration ?? fallback.duration) || 15,
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? fallback.sortOrder) || 0,
  };
}

function storyWriteModel(story, fallbackTitle) {
  const i18n = normalizeI18n(story.i18n, story);
  const ruTitle = i18n.ru.title || story.title || fallbackTitle;
  const cover =
    i18n.ru.coverUrl ||
    story.coverUrl ||
    story.coverurl ||
    'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=500&q=80';
  const content = i18n.ru.contentUrl || story.contentUrl || story.contenturl || cover;
  const groupTitle = story.groupTitle || story.group_title || ruTitle;
  const groupId = String(story.groupId || story.group_id || groupTitle)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
  const groupCover = story.groupCoverUrl || story.group_coverurl || story.group_cover_url || cover;
  const description = serializeDescription(story.description, i18n, {
    details: story.details,
    promoType: story.promoType,
    startsAt: story.startsAt,
    endsAt: story.endsAt,
    remaining: story.remaining,
    qrValue: story.qrValue,
    createdAt: story.createdAt,
  });

  return {
    title: ruTitle,
    coverurl: cover,
    contenturl: content,
    group_id: groupId,
    group_title: groupTitle,
    group_coverurl: groupCover,
    description,
    duration: Number(story.duration) || 15,
    sort_order: Number(story.sortOrder ?? story.sort_order) || 0,
  };
}

async function getStories() {
  try {
    const { data, error } = await supabase
      .from('stories')
      .select('*')
      .order('id', { ascending: true });

    if (error) {
      console.error('Error loading stories from Supabase DB:', error.message);
      return [];
    }
    return (data || []).map((story) => normalizeStory(story));
  } catch (err) {
    console.error('Exception loading stories from Supabase DB:', err.message);
    return [];
  }
}

async function addStory(story) {
  const writeModel = storyWriteModel(story, 'Новая история');
  const newStory = { id: Date.now(), ...writeModel };

  try {
    const { data, error } = await supabase.from('stories').insert([newStory]).select().single();

    if (error) {
      console.error('Error saving story to Supabase DB:', error.message);
      throw new Error(error.message);
    }
    return normalizeStory(data || newStory, {
      ...story,
      ...newStory,
      createdAt: story.createdAt || new Date(newStory.id).toISOString(),
    });
  } catch (err) {
    console.error('Error inserting story into Supabase:', err.message);
    throw err;
  }
}

async function deleteStory(id) {
  try {
    const { error } = await supabase.from('stories').delete().eq('id', id);

    if (error) {
      console.error('Error deleting story from Supabase DB:', error.message);
      throw new Error(error.message);
    }
    return true;
  } catch (err) {
    console.error('Error deleting from Supabase:', err.message);
    throw err;
  }
}

async function updateStory(id, story) {
  const updatedData = storyWriteModel(story, 'Обновленная история');

  try {
    const { data, error } = await supabase
      .from('stories')
      .update(updatedData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating story in Supabase DB:', error.message);
      throw new Error(error.message);
    }
    return normalizeStory(data || { id, ...updatedData }, {
      ...story,
      ...updatedData,
      id,
    });
  } catch (err) {
    console.error('Error updating story in Supabase:', err.message);
    throw err;
  }
}

module.exports = { getStories, addStory, updateStory, deleteStory };

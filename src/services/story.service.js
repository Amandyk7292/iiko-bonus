const { supabase } = require('../config/supabase');

function parseDescription(descRaw, fallbackStory = {}) {
  let text = descRaw || '';
  let i18n = null;

  if (typeof descRaw === 'string' && descRaw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(descRaw);
      if (parsed && (parsed.i18n || parsed.text !== undefined)) {
        text = parsed.text || parsed.i18n?.ru?.description || '';
        i18n = parsed.i18n;
      }
    } catch (e) {}
  }

  const ruCover = fallbackStory.coverUrl || fallbackStory.coverurl || '';
  const ruContent = fallbackStory.contentUrl || fallbackStory.contenturl || ruCover;
  const ruTitle = fallbackStory.title || '';

  const defaultI18n = {
    ru: {
      title: i18n?.ru?.title || ruTitle,
      description: i18n?.ru?.description || text,
      coverUrl: i18n?.ru?.coverUrl || ruCover,
      contentUrl: i18n?.ru?.contentUrl || ruContent,
    },
    kz: {
      title: i18n?.kz?.title || '',
      description: i18n?.kz?.description || '',
      coverUrl: i18n?.kz?.coverUrl || '',
      contentUrl: i18n?.kz?.contentUrl || '',
    },
    en: {
      title: i18n?.en?.title || '',
      description: i18n?.en?.description || '',
      coverUrl: i18n?.en?.coverUrl || '',
      contentUrl: i18n?.en?.contentUrl || '',
    }
  };

  return { text, i18n: defaultI18n };
}

function serializeDescription(text, i18n) {
  if (!i18n) return text || '';
  return JSON.stringify({
    text: text || i18n.ru?.description || '',
    i18n
  });
}

const DEFAULT_STORIES = [
  {
    id: 1,
    title: 'Свежая выпечка каждое утро',
    coverUrl: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&q=80',
    contentUrl: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&q=80',
    coverurl: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&q=80',
    contenturl: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&q=80',
    groupId: 'fresh-bakery',
    groupTitle: 'Свежая выпечка',
    groupCoverUrl: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&q=80',
    group_id: 'fresh-bakery',
    group_title: 'Свежая выпечка',
    group_coverurl: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&q=80',
    description: 'Горячие хрустящие круассаны, багеты и булочки из печи каждое утро с 7:30!',
    i18n: {
      ru: {
        title: 'Свежая выпечка каждое утро',
        description: 'Горячие хрустящие круассаны, багеты и булочки из печи каждое утро с 7:30!',
        coverUrl: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&q=80',
        contentUrl: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&q=80'
      },
      kz: {
        title: 'Күн сайын таңертең жаңа піскен нан өнімдері',
        description: 'Таңғы 7:30-дан бастап пештен жаңа шыққан қытырлақ круассандар мен багеттер!',
        coverUrl: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&q=80',
        contentUrl: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&q=80'
      },
      en: {
        title: 'Fresh bakery every morning',
        description: 'Warm crispy croissants and freshly baked pastries every morning from 7:30 AM!',
        coverUrl: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&q=80',
        contentUrl: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&q=80'
      }
    },
    duration: 15,
    sortOrder: 1
  },
  {
    id: 2,
    title: 'Кешбэк бонусами до 10%',
    coverUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80',
    contentUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80',
    coverurl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80',
    contenturl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80',
    groupId: 'bonuses',
    groupTitle: 'Бонусы Bulka',
    groupCoverUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80',
    group_id: 'bonuses',
    group_title: 'Бонусы Bulka',
    group_coverurl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80',
    description: 'Копите баллы с каждой покупки и оплачивайте ими до 50% чека в любой пекарне Bulka.',
    i18n: {
      ru: {
        title: 'Кешбэк бонусами до 10%',
        description: 'Копите баллы с каждой покупки и оплачивайте ими до 50% чека в любой пекарне Bulka.',
        coverUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80',
        contentUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80'
      },
      kz: {
        title: '10%-ға дейін бонустық кэшбэк',
        description: 'Әрбір саудаңыздан бонус жинап, чек сомасының 50%-на дейін төлеңіз.',
        coverUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80',
        contentUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80'
      },
      en: {
        title: 'Cashback up to 10%',
        description: 'Collect bonus points from every purchase and pay up to 50% of your bill.',
        coverUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80',
        contentUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80'
      }
    },
    duration: 15,
    sortOrder: 2
  },
  {
    id: 3,
    title: 'Авторский кофе и десерты',
    coverUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&q=80',
    contentUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&q=80',
    coverurl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&q=80',
    contenturl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&q=80',
    groupId: 'coffee',
    groupTitle: 'Вкусный кофе',
    groupCoverUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&q=80',
    group_id: 'coffee',
    group_title: 'Вкусный кофе',
    group_coverurl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&q=80',
    description: 'Попробуйте наш ароматный капучино, латте или флэт уайт на 100% арабике вместе со свежими десертами.',
    i18n: {
      ru: {
        title: 'Авторский кофе и десерты',
        description: 'Попробуйте наш ароматный капучино, латте или флэт уайт на 100% арабике вместе со свежими десертами.',
        coverUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&q=80',
        contentUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&q=80'
      },
      kz: {
        title: 'Арнайы кофе және десерттер',
        description: '100% арабика дәнінен дайындалған хош иісті капучино мен латтені дәмі тіл үйіретін десерттермен татыңыз.',
        coverUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&q=80',
        contentUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&q=80'
      },
      en: {
        title: 'Specialty coffee and pastries',
        description: 'Enjoy aromatic cappuccino, latte or flat white made with 100% arabica beans paired with fresh pastries.',
        coverUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&q=80',
        contentUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&q=80'
      }
    },
    duration: 15,
    sortOrder: 3
  }
];

async function getStories() {
  try {
    const { data, error } = await supabase
      .from('stories')
      .select('*')
      .order('id', { ascending: true });
      
    if (error || !data || data.length === 0) {
      if (error) console.error('Error loading stories from Supabase DB:', error.message);
      return DEFAULT_STORIES;
    }
    return data.map(s => {
      const cover = s.coverurl || s.coverUrl || s.cover_url || '';
      const content = s.contenturl || s.contentUrl || s.content_url || cover;
      const groupTitle = s.group_title || s.grouptitle || s.groupTitle || s.title || '';
      const groupId = String(s.group_id || s.groupid || s.groupId || s.id);
      const groupCover = s.group_coverurl || s.groupCoverUrl || s.group_cover_url || cover;
      
      const { text, i18n } = parseDescription(s.description, { title: s.title, coverUrl: cover, contentUrl: content });

      return {
        id: s.id,
        title: s.title || '',
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
        description: text,
        i18n,
        duration: Number(s.duration) || 15,
        sortOrder: Number(s.sort_order || s.sortOrder) || 0
      };
    });
  } catch (err) {
    console.error('Exception loading stories from Supabase DB:', err.message);
    return DEFAULT_STORIES;
  }
}

async function addStory(story) {
  const ruTitle = story.i18n?.ru?.title || story.title || "Новая история";
  const cover = story.i18n?.ru?.coverUrl || story.coverUrl || story.coverurl || "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=500&q=80";
  const content = story.i18n?.ru?.contentUrl || story.contentUrl || story.contenturl || cover;
  const groupTitle = story.groupTitle || story.group_title || ruTitle;
  const groupId = String(story.groupId || story.group_id || groupTitle).trim().toLowerCase().replace(/\s+/g, '-');
  const groupCover = story.groupCoverUrl || story.group_coverurl || story.group_cover_url || cover;
  
  const descStr = serializeDescription(story.description, story.i18n);

  const newStory = {
    id: Date.now(),
    title: ruTitle,
    coverurl: cover,
    contenturl: content,
    group_id: groupId,
    group_title: groupTitle,
    group_coverurl: groupCover,
    description: descStr,
    duration: Number(story.duration) || 15,
    sort_order: Number(story.sortOrder || story.sort_order) || 0
  };

  try {
    const { data, error } = await supabase
      .from('stories')
      .insert([newStory])
      .select()
      .single();
      
    if (error) {
      console.error('Error saving story to Supabase DB:', error.message);
      throw new Error(error.message);
    }
    const saved = data || newStory;
    const finalCover = saved.coverurl || saved.coverUrl || cover;
    const finalContent = saved.contenturl || saved.contentUrl || content;
    const finalGroupTitle = saved.group_title || saved.groupTitle || groupTitle;
    const finalGroupId = String(saved.group_id || saved.groupId || groupId);
    const finalGroupCover = saved.group_coverurl || saved.groupCoverUrl || groupCover;
    
    const { text, i18n } = parseDescription(saved.description, { title: saved.title, coverUrl: finalCover, contentUrl: finalContent });

    return {
      id: saved.id,
      title: saved.title || ruTitle,
      coverUrl: finalCover,
      contentUrl: finalContent,
      coverurl: finalCover,
      contenturl: finalContent,
      groupId: finalGroupId,
      groupTitle: finalGroupTitle,
      groupCoverUrl: finalGroupCover,
      group_id: finalGroupId,
      group_title: finalGroupTitle,
      group_coverurl: finalGroupCover,
      description: text,
      i18n,
      duration: saved.duration || 15,
      sortOrder: Number(saved.sort_order || saved.sortOrder) || 0
    };
  } catch (err) {
    console.error('Error inserting story into Supabase:', err.message);
    throw err;
  }
}

async function deleteStory(id) {
  try {
    const { error } = await supabase
      .from('stories')
      .delete()
      .eq('id', id);
      
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
  const ruTitle = story.i18n?.ru?.title || story.title || "Обновленная история";
  const cover = story.i18n?.ru?.coverUrl || story.coverUrl || story.coverurl || "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=500&q=80";
  const content = story.i18n?.ru?.contentUrl || story.contentUrl || story.contenturl || cover;
  const groupTitle = story.groupTitle || story.group_title || ruTitle;
  const groupId = String(story.groupId || story.group_id || groupTitle).trim().toLowerCase().replace(/\s+/g, '-');
  const groupCover = story.groupCoverUrl || story.group_coverurl || story.group_cover_url || cover;
  
  const descStr = serializeDescription(story.description, story.i18n);

  const updatedData = {
    title: ruTitle,
    coverurl: cover,
    contenturl: content,
    group_id: groupId,
    group_title: groupTitle,
    group_coverurl: groupCover,
    description: descStr,
    duration: Number(story.duration) || 15,
    sort_order: Number(story.sortOrder || story.sort_order) || 0
  };

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
    const saved = data || updatedData;
    const finalCover = saved.coverurl || saved.coverUrl || cover;
    const finalContent = saved.contenturl || saved.contentUrl || content;
    const finalGroupTitle = saved.group_title || saved.groupTitle || groupTitle;
    const finalGroupId = String(saved.group_id || saved.groupId || groupId);
    const finalGroupCover = saved.group_coverurl || saved.groupCoverUrl || groupCover;
    
    const { text, i18n } = parseDescription(saved.description, { title: saved.title, coverUrl: finalCover, contentUrl: finalContent });

    return {
      id: saved.id || id,
      title: saved.title || updatedData.title,
      coverUrl: finalCover,
      contentUrl: finalContent,
      coverurl: finalCover,
      contenturl: finalContent,
      groupId: finalGroupId,
      groupTitle: finalGroupTitle,
      groupCoverUrl: finalGroupCover,
      group_id: finalGroupId,
      group_title: finalGroupTitle,
      group_coverurl: finalGroupCover,
      description: text,
      i18n,
      duration: saved.duration || 15,
      sortOrder: Number(saved.sort_order || saved.sortOrder) || 0
    };
  } catch (err) {
    console.error('Error updating story in Supabase:', err.message);
    throw err;
  }
}

module.exports = { getStories, addStory, updateStory, deleteStory };

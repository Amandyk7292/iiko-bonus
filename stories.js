const { supabase } = require('./supabase');

let memoryStories = [
  {
    id: 1,
    title: "СЕЗОННЫЙ ФРАППЕ",
    coverUrl: "https://images.unsplash.com/photo-1572490122747-3968b75bf699?w=500&q=80",
    contentUrl: "https://images.unsplash.com/photo-1572490122747-3968b75bf699?w=1000&q=80",
    description: "Попробуй наш новый летний кофейный напиток с карамелью и льдом! Освежает и заряжает бодростью на весь день.",
    duration: 15
  },
  {
    id: 2,
    title: "НОВИНКА",
    coverUrl: "https://images.unsplash.com/photo-1497935586351-b67a49e012bf?w=500&q=80",
    contentUrl: "https://images.unsplash.com/photo-1497935586351-b67a49e012bf?w=1000&q=80",
    description: "Свежая выпечка каждое утро в Bulka! Хрустящие круассаны и ароматный эспрессо уже ждут тебя.",
    duration: 15
  },
  {
    id: 3,
    title: "ПЛЮШКИ ЗА ДРУГА",
    coverUrl: "https://images.unsplash.com/photo-1559525839-b184a4d698c7?w=500&q=80",
    contentUrl: "https://images.unsplash.com/photo-1559525839-b184a4d698c7?w=1000&q=80",
    description: "Приглашай друзей в нашу бонусную программу! Получай 500 подарочных баллов за каждого нового друга.",
    duration: 15
  }
];

async function getStories() {
  try {
    const { data, error } = await supabase.from('stories').select('*').order('id', { ascending: true });
    if (!error && data && data.length > 0) {
      return data;
    }
  } catch (err) {
    console.warn('Could not load stories from DB, using memory:', err.message);
  }
  return memoryStories;
}

async function addStory(story) {
  const newStory = {
    id: Date.now(),
    title: story.title || "Новая история",
    coverUrl: story.coverUrl || "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=500&q=80",
    contentUrl: story.contentUrl || story.coverUrl || "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=1000&q=80",
    description: story.description || "",
    duration: Number(story.duration) || 15
  };

  try {
    const { error } = await supabase.from('stories').insert([newStory]);
    if (error) {
      console.warn('Could not save story to DB, saving to memory:', error.message);
    }
  } catch (err) {
    console.warn('Error inserting story:', err.message);
  }
  memoryStories.push(newStory);
  return newStory;
}

async function deleteStory(id) {
  const numId = Number(id);
  memoryStories = memoryStories.filter(s => s.id !== numId && String(s.id) !== String(id));
  try {
    await supabase.from('stories').delete().eq('id', id);
  } catch (err) {
    console.warn('Error deleting from DB:', err.message);
  }
  return true;
}

module.exports = { getStories, addStory, deleteStory };

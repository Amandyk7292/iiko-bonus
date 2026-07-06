const { supabase } = require('./supabase');

function normalizeNews(row, fallback = {}) {
  const image = row.imageurl || row.imageUrl || row.image_url || fallback.imageUrl || '';
  return {
    id: row.id || fallback.id,
    title: row.title || fallback.title || '',
    imageUrl: image,
    imageurl: image,
    description: row.description || fallback.description || '',
    created_at: row.created_at || fallback.created_at || null
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
  return (data || []).map(row => normalizeNews(row));
}

async function addNews(item) {
  const newItem = {
    title: item.title || 'Новость',
    imageurl: item.imageUrl || item.imageurl || '',
    description: item.description || ''
  };

  const { data, error } = await supabase
    .from('news')
    .insert([newItem])
    .select()
    .single();

  if (error) throw new Error(error.message);
  return normalizeNews(data, newItem);
}

async function updateNews(id, item) {
  const updatedItem = {
    title: item.title || 'Новость',
    imageurl: item.imageUrl || item.imageurl || '',
    description: item.description || ''
  };

  const { data, error } = await supabase
    .from('news')
    .update(updatedItem)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return normalizeNews(data, { ...updatedItem, id });
}

async function deleteNews(id) {
  const { data, error } = await supabase
    .from('news')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) throw new Error(error.message);
  return { deleted: (data || []).length };
}

module.exports = { getNews, addNews, updateNews, deleteNews };

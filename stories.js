const { supabase } = require('./supabase');

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
    return data || [];
  } catch (err) {
    console.error('Exception loading stories from Supabase DB:', err.message);
    return [];
  }
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
    const { data, error } = await supabase
      .from('stories')
      .insert([newStory])
      .select()
      .single();
      
    if (error) {
      console.error('Error saving story to Supabase DB:', error.message);
      throw new Error(error.message);
    }
    return data || newStory;
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

module.exports = { getStories, addStory, deleteStory };

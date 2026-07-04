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
    return (data || []).map(s => {
      const cover = s.coverurl || s.coverUrl || s.cover_url || '';
      const content = s.contenturl || s.contentUrl || s.content_url || cover;
      return {
        id: s.id,
        title: s.title || '',
        coverUrl: cover,
        contentUrl: content,
        coverurl: cover,
        contenturl: content,
        description: s.description || '',
        duration: Number(s.duration) || 15
      };
    });
  } catch (err) {
    console.error('Exception loading stories from Supabase DB:', err.message);
    return [];
  }
}

async function addStory(story) {
  const cover = story.coverUrl || story.coverurl || "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=500&q=80";
  const content = story.contentUrl || story.contenturl || cover;
  const newStory = {
    id: Date.now(),
    title: story.title || "Новая история",
    coverurl: cover,
    contenturl: content,
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
    const saved = data || newStory;
    const finalCover = saved.coverurl || saved.coverUrl || cover;
    const finalContent = saved.contenturl || saved.contentUrl || content;
    return {
      id: saved.id,
      title: saved.title || newStory.title,
      coverUrl: finalCover,
      contentUrl: finalContent,
      coverurl: finalCover,
      contenturl: finalContent,
      description: saved.description || '',
      duration: saved.duration || 15
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
  const cover = story.coverUrl || story.coverurl || "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=500&q=80";
  const content = story.contentUrl || story.contenturl || cover;
  const updatedData = {
    title: story.title || "Обновленная история",
    coverurl: cover,
    contenturl: content,
    description: story.description || "",
    duration: Number(story.duration) || 15
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
    return {
      id: saved.id || id,
      title: saved.title || updatedData.title,
      coverUrl: finalCover,
      contentUrl: finalContent,
      coverurl: finalCover,
      contenturl: finalContent,
      description: saved.description || '',
      duration: saved.duration || 15
    };
  } catch (err) {
    console.error('Error updating story in Supabase:', err.message);
    throw err;
  }
}

module.exports = { getStories, addStory, updateStory, deleteStory };


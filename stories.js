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
      const groupTitle = s.group_title || s.grouptitle || s.groupTitle || s.title || '';
      const groupId = String(s.group_id || s.groupid || s.groupId || s.id);
      const groupCover = s.group_coverurl || s.groupCoverUrl || s.group_cover_url || cover;
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
        description: s.description || '',
        duration: Number(s.duration) || 15,
        sortOrder: Number(s.sort_order || s.sortOrder) || 0
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
  const groupTitle = story.groupTitle || story.group_title || story.title || "Новая тема";
  const groupId = String(story.groupId || story.group_id || groupTitle).trim().toLowerCase().replace(/\s+/g, '-');
  const groupCover = story.groupCoverUrl || story.group_coverurl || story.group_cover_url || cover;
  const newStory = {
    id: Date.now(),
    title: story.title || "Новая история",
    coverurl: cover,
    contenturl: content,
    group_id: groupId,
    group_title: groupTitle,
    group_coverurl: groupCover,
    description: story.description || "",
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
    return {
      id: saved.id,
      title: saved.title || newStory.title,
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
      description: saved.description || '',
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
  const cover = story.coverUrl || story.coverurl || "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=500&q=80";
  const content = story.contentUrl || story.contenturl || cover;
  const groupTitle = story.groupTitle || story.group_title || story.title || "Тема";
  const groupId = String(story.groupId || story.group_id || groupTitle).trim().toLowerCase().replace(/\s+/g, '-');
  const groupCover = story.groupCoverUrl || story.group_coverurl || story.group_cover_url || cover;
  const updatedData = {
    title: story.title || "Обновленная история",
    coverurl: cover,
    contenturl: content,
    group_id: groupId,
    group_title: groupTitle,
    group_coverurl: groupCover,
    description: story.description || "",
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
      description: saved.description || '',
      duration: saved.duration || 15,
      sortOrder: Number(saved.sort_order || saved.sortOrder) || 0
    };
  } catch (err) {
    console.error('Error updating story in Supabase:', err.message);
    throw err;
  }
}

module.exports = { getStories, addStory, updateStory, deleteStory };

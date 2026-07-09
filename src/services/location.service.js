const { supabase } = require('../config/supabase');

function normalizeLocation(row, fallback = {}) {
  return {
    id: row.id || fallback.id,
    name: row.name || fallback.name || '',
    address: row.address || fallback.address || '',
    city: row.city || fallback.city || '',
    created_at: row.created_at || fallback.created_at || null
  };
}

async function getAdminLocations() {
  const { data, error } = await supabase
    .from('bulka_locations')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading locations from Supabase DB:', error.message);
    return [];
  }
  return (data || []).map(row => normalizeLocation(row));
}

async function addLocation(item) {
  const newItem = {
    name: item.name || '',
    address: item.address || '',
    city: item.city || ''
  };

  const { data, error } = await supabase
    .from('bulka_locations')
    .insert([newItem])
    .select()
    .single();

  if (error) throw new Error(error.message);
  return normalizeLocation(data, newItem);
}

async function updateLocation(id, item) {
  const updatedItem = {
    name: item.name || '',
    address: item.address || '',
    city: item.city || ''
  };

  const { data, error } = await supabase
    .from('bulka_locations')
    .update(updatedItem)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return normalizeLocation(data, { ...updatedItem, id });
}

async function deleteLocation(id) {
  const { error } = await supabase
    .from('bulka_locations')
    .delete()
    .eq('id', id);

  if (error) throw new Error(error.message);
  return { success: true };
}

module.exports = {
  getAdminLocations,
  addLocation,
  updateLocation,
  deleteLocation
};

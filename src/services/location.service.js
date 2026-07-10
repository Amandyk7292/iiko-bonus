const { supabase } = require('../config/supabase');

async function getCitiesWithPoints() {
  const { data, error } = await supabase
    .from('cities')
    .select(
      `
      *,
      points (*)
    `,
    )
    .order('name', { ascending: true });

  if (error) {
    console.error('Error loading cities:', error.message);
    return [];
  }
  return data || [];
}

async function createCity(name, i18n) {
  const { data, error } = await supabase.from('cities').insert([{ name, i18n }]).select().single();

  if (error) throw new Error(error.message);
  return data;
}

async function updateCity(id, name, i18n) {
  const { data, error } = await supabase
    .from('cities')
    .update({ name, i18n })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function deleteCity(id) {
  const { error } = await supabase.from('cities').delete().eq('id', id);

  if (error) throw new Error(error.message);
}

async function createPoint(cityId, name, address, latitude, longitude, i18n) {
  const { data, error } = await supabase
    .from('points')
    .insert([{ city_id: cityId, name, address, latitude, longitude, i18n }])
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function updatePoint(id, name, address, latitude, longitude, i18n) {
  const updates = { name, address };
  if (latitude !== undefined) updates.latitude = latitude;
  if (longitude !== undefined) updates.longitude = longitude;
  if (i18n !== undefined) updates.i18n = i18n;

  const { data, error } = await supabase
    .from('points')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function deletePoint(id) {
  const { error } = await supabase.from('points').delete().eq('id', id);

  if (error) throw new Error(error.message);
}

module.exports = {
  getCitiesWithPoints,
  createCity,
  updateCity,
  deleteCity,
  createPoint,
  updatePoint,
  deletePoint,
};

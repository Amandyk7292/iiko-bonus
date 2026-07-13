const { supabase } = require('../config/supabase');

const addressError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const cleanText = (value, maximum) =>
  String(value || '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);

const normalizeUuid = (value) => {
  const id = String(value || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw addressError('Некорректный идентификатор адреса');
  }
  return id;
};

const normalizeAddressInput = (payload = {}) => {
  const address = cleanText(payload.address, 500);
  const city = cleanText(payload.city || 'Актау', 100);
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  if (address.length < 3) throw addressError('Укажите полный адрес');
  if (!city) throw addressError('Укажите город');
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw addressError('Укажите адрес на карте');
  }
  if (payload.isDefault !== undefined && typeof payload.isDefault !== 'boolean') {
    throw addressError('Поле isDefault должно быть логическим');
  }
  return {
    label: cleanText(payload.label, 120) || null,
    address,
    city,
    latitude,
    longitude,
    entrance: cleanText(payload.entrance, 30) || null,
    floor: cleanText(payload.floor, 20) || null,
    apartment: cleanText(payload.apartment, 30) || null,
    comment: cleanText(payload.comment ?? payload.courierComment, 300) || null,
    isDefault: payload.isDefault,
  };
};

const normalizeAddress = (row) => ({
  id: String(row.id),
  label: row.label || null,
  address: row.address,
  city: row.city,
  latitude: Number(row.latitude),
  longitude: Number(row.longitude),
  entrance: row.entrance || null,
  floor: row.floor || null,
  apartment: row.apartment || null,
  comment: row.comment || null,
  isDefault: row.is_default === true,
});

const rpcError = (error) => {
  const message = String(error?.message || 'Не удалось сохранить адрес');
  if (message.includes('address limit reached'))
    return addressError('Можно сохранить не более 10 адресов', 409);
  if (message.includes('address not found')) return addressError('Адрес не найден', 404);
  if (message.includes('invalid customer address')) return addressError('Некорректный адрес');
  return error;
};

async function listCustomerAddresses(customerId) {
  const { data, error } = await supabase
    .from('customer_addresses')
    .select('id,label,address,city,latitude,longitude,entrance,floor,apartment,comment,is_default')
    .eq('customer_id', customerId)
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(normalizeAddress);
}

async function saveCustomerAddress(customerId, payload, addressId = null) {
  const input = normalizeAddressInput(payload);
  const { data, error } = await supabase.rpc('save_customer_address', {
    p_customer_id: customerId,
    p_address_id: addressId ? normalizeUuid(addressId) : null,
    p_label: input.label,
    p_address: input.address,
    p_city: input.city,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_entrance: input.entrance,
    p_floor: input.floor,
    p_apartment: input.apartment,
    p_comment: input.comment,
    p_is_default: input.isDefault ?? null,
  });
  if (error) throw rpcError(error);
  return normalizeAddress(data);
}

async function setDefaultCustomerAddress(customerId, addressId) {
  const { data, error } = await supabase.rpc('set_customer_address_default', {
    p_customer_id: customerId,
    p_address_id: normalizeUuid(addressId),
  });
  if (error) throw rpcError(error);
  return normalizeAddress(data);
}

async function deleteCustomerAddress(customerId, addressId) {
  const { error } = await supabase.rpc('delete_customer_address', {
    p_customer_id: customerId,
    p_address_id: normalizeUuid(addressId),
  });
  if (error) throw rpcError(error);
}

module.exports = {
  deleteCustomerAddress,
  listCustomerAddresses,
  normalizeAddressInput,
  saveCustomerAddress,
  setDefaultCustomerAddress,
};

const { supabase } = require('../config/supabase');
const { service: reporting } = require('./iiko-dashboard.service');
const { list } = require('./iiko-dashboard-barters');
const { normalizeCityName, isAstana } = require('./iiko-city-profile.service');

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const productionError = (code, message, statusCode = 409) =>
  Object.assign(new Error(message), { code, statusCode });
const publicBinding = (row) =>
  row
    ? {
        serverId: row.server_id,
        departmentId: row.department_id,
        sourceStoreId: row.source_store_id,
        targetStoreId: row.target_store_id,
        enabled: row.enabled,
        postImmediately: row.post_immediately,
      }
    : null;
const cityKey = (city) =>
  isAstana(city) ? 'astana' : ['актау', 'aktau'].includes(normalizeCityName(city)) ? 'aktau' : null;

async function readBindingRow(branchId, { db = supabase } = {}) {
  const { data, error } = await db
    .from('cashier_iiko_production_bindings')
    .select('*')
    .eq('branch_id', branchId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
async function readProductionBinding(branchId, options) {
  return publicBinding(await readBindingRow(branchId, options));
}
async function productionServer(branchId, serverId, { db = supabase, reports = reporting } = {}) {
  const { data: branch, error } = await db
    .from('bulka_locations')
    .select('id,name,address,city,active')
    .eq('id', branchId)
    .maybeSingle();
  if (error) throw error;
  if (!branch || !branch.active)
    throw productionError('IIKO_PRODUCTION_BRANCH_UNAVAILABLE', 'Точка недоступна', 404);
  const server = (await reports.listServers()).find((s) => s.id === serverId);
  if (!server?.active || !server.configured)
    throw productionError('IIKO_PRODUCTION_SERVER_UNAVAILABLE', 'Сервер iiko недоступен');
  if (!cityKey(branch.city) || cityKey(branch.city) !== server.city)
    throw productionError(
      'IIKO_PRODUCTION_CITY_MISMATCH',
      'Сервер iiko относится к другому городу',
    );
  return { branch, server };
}
async function loadProductionDirectory(serverId, { reports = reporting } = {}) {
  return reports.client.withSession(serverId, async (request) => {
    const rows = async (path) => {
      const xml = await request(path, undefined, 'xml');
      if (!Object.hasOwn(xml || {}, 'corporateItemDtoes'))
        throw productionError(
          'IIKO_PRODUCTION_DIRECTORY_INVALID',
          'Нет подтверждённого справочника iiko',
        );
      return list(xml.corporateItemDtoes?.corporateItemDto)
        .filter((r) => ![true, 'true'].includes(r.deleted) && ![false, 'false'].includes(r.active))
        .map((r) => {
          if (!guid.test(r.id) || !String(r.name || '').trim())
            throw productionError(
              'IIKO_PRODUCTION_DIRECTORY_INVALID',
              'Некорректный справочник iiko',
            );
          return {
            id: String(r.id).toLowerCase(),
            name: String(r.name).trim(),
            ...(r.parentId ? { parentId: String(r.parentId).toLowerCase() } : {}),
          };
        });
    };
    const departments = await rows('corporation/departments');
    const stores = await rows('corporation/stores');
    return { departments, stores };
  });
}
function validateDirectoryBinding(binding, directory) {
  if (
    !directory.departments.some((r) => r.id === binding.departmentId) ||
    !directory.stores.some(
      (r) => r.id === binding.sourceStoreId && r.parentId === binding.departmentId,
    ) ||
    !directory.stores.some(
      (r) => r.id === binding.targetStoreId && r.parentId === binding.departmentId,
    )
  )
    throw productionError('IIKO_PRODUCTION_STORE_MISMATCH', 'Выберите склады этой точки в iiko');
}
async function saveProductionBinding(
  branchId,
  input,
  { db = supabase, reports = reporting, actor = 'admin' } = {},
) {
  const binding = {
    ...input,
    departmentId: String(input.departmentId).toLowerCase(),
    sourceStoreId: String(input.sourceStoreId).toLowerCase(),
    targetStoreId: String(input.targetStoreId).toLowerCase(),
  };
  if (
    ![binding.departmentId, binding.sourceStoreId, binding.targetStoreId].every((id) =>
      guid.test(id),
    ) ||
    typeof binding.postImmediately !== 'boolean' ||
    typeof binding.enabled !== 'boolean'
  )
    throw productionError('IIKO_PRODUCTION_BINDING_INVALID', 'Некорректная настройка акта');
  await productionServer(branchId, binding.serverId, { db, reports });
  validateDirectoryBinding(binding, await loadProductionDirectory(binding.serverId, { reports }));
  const { data, error } = await db
    .from('cashier_iiko_production_bindings')
    .upsert(
      {
        branch_id: branchId,
        server_id: binding.serverId,
        department_id: binding.departmentId,
        source_store_id: binding.sourceStoreId,
        target_store_id: binding.targetStoreId,
        enabled: binding.enabled === true,
        post_immediately: binding.postImmediately,
        updated_by: String(actor).slice(0, 160),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'branch_id' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return publicBinding(data);
}

module.exports = {
  readProductionBinding,
  saveProductionBinding,
  loadProductionDirectory,
  readBindingRow,
  productionServer,
  validateDirectoryBinding,
  productionError,
  guid,
};

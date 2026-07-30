const { supabase } = require('../config/supabase');
const { getIikoClientForCity } = require('./iiko-city-profile.service');

const inventoryError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const DEFAULT_RESERVATION_TTL_MINUTES = 20;
const MAX_RESERVATION_TTL_MINUTES = 24 * 60 + 5;
const COMMITTED_RESERVATION_STATUSES = new Set(['committed', 'already_committed']);

const normalizedKey = (value) =>
  String(value || '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/\s+/g, ' ');

const parseTerminalMappings = () => {
  try {
    const parsed = JSON.parse(process.env.IIKO_TERMINAL_GROUPS_JSON || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return Object.entries(parsed)
      .map(([key, value]) => ({
        key: normalizedKey(key),
        terminalGroupId: String(
          typeof value === 'string'
            ? value
            : value?.terminalGroupId || value?.terminal_group_id || value?.id || '',
        ).trim(),
        branchId: String(
          typeof value === 'object' ? value?.branchId || value?.branch_id || '' : '',
        ).trim(),
      }))
      .filter((item) => item.terminalGroupId);
  } catch (error) {
    console.error('IIKO_TERMINAL_GROUPS_JSON is invalid:', error.message);
    return [];
  }
};

const locationKeys = (location) =>
  [
    location?.id,
    location?.name,
    location?.address,
    [location?.name, location?.address].filter(Boolean).join(', '),
  ]
    .map(normalizedKey)
    .filter(Boolean);

const terminalGroupForLocation = (location, snapshot) => {
  const groups = Array.isArray(snapshot?.groups) ? snapshot.groups : [];
  const mappings = parseTerminalMappings();
  const keys = locationKeys(location);
  const mapping = mappings.find(
    (item) =>
      (item.branchId && item.branchId === String(location?.id || '')) || keys.includes(item.key),
  );
  if (mapping) {
    const group = groups.find((item) => item.terminalGroupId === mapping.terminalGroupId);
    if (group) return group;
  }
  const defaultTerminal = String(process.env.IIKO_TERMINAL_GROUP_ID || '').trim();
  if (defaultTerminal) {
    const group = groups.find((item) => item.terminalGroupId === defaultTerminal);
    if (group) return group;
  }
  return groups.length === 1 ? groups[0] : null;
};

async function readLocation(branchId) {
  const { data, error } = await supabase
    .from('bulka_locations')
    .select('id,name,address,city,active')
    .eq('id', branchId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.active === false) throw inventoryError('Филиал больше недоступен', 404);
  return data;
}

async function syncBranchInventory(
  branchId,
  { strict = false, products = [], iikoClient = null } = {},
) {
  if (!branchId) return { tracked: false, balances: new Map(), stopIds: new Set() };
  try {
    const location = await readLocation(branchId);
    const selectedIikoApi = iikoClient || getIikoClientForCity(location.city);
    const snapshot = await selectedIikoApi.getStopListSnapshot(undefined, { strict: true });
    const group = terminalGroupForLocation(location, snapshot);
    if (!group) {
      return {
        tracked: false,
        balances: new Map(),
        stopIds: snapshot.stopIds || new Set(),
      };
    }

    const normalizedProducts = Array.isArray(products) ? products : [];
    const publicProductByIikoId = new Map(
      normalizedProducts.map((product) => [
        String(product?.iikoProductId || product?.id || ''),
        String(product?.id || ''),
      ]),
    );
    const productNames = new Map(
      normalizedProducts.map((product) => [
        String(product?.id || ''),
        String(product?.name || '').slice(0, 160) || null,
      ]),
    );
    const balances = new Map();
    const rows = [];
    for (const item of group.items || []) {
      const quantity = Math.max(0, Math.floor(Number(item.balance)));
      const publicProductId = publicProductByIikoId.get(item.productId) || item.productId;
      balances.set(publicProductId, quantity);
      rows.push({
        branch_id: String(branchId),
        product_id: publicProductId,
        product_name: productNames.get(publicProductId) || null,
        source_quantity: quantity,
        source: 'iiko',
        last_synced_at: snapshot.fetchedAt || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    if (rows.length > 0) {
      const { error } = await supabase
        .from('branch_product_inventory')
        .upsert(rows, { onConflict: 'branch_id,product_id' });
      if (error) throw error;
      const { notifyAvailableStock } = require('./stock-subscription.service');
      await notifyAvailableStock(
        String(branchId),
        rows.map((row) => row.product_id),
      ).catch((notificationError) =>
        console.error('Не удалось уведомить о появлении товара:', notificationError.message),
      );
    }
    return { tracked: true, balances, stopIds: snapshot.stopIds || new Set(), group };
  } catch (error) {
    if (strict) throw error;
    console.error(`Не удалось синхронизировать остатки филиала ${branchId}:`, error.message);
    return { tracked: false, balances: new Map(), stopIds: new Set() };
  }
}

async function getBranchAvailability(
  branchId,
  { sync = false, products = [], strict = false, iikoClient = null } = {},
) {
  if (!branchId) return new Map();
  if (sync) await syncBranchInventory(branchId, { strict, products, iikoClient });
  const now = new Date().toISOString();
  const [inventoryResult, reservationsResult] = await Promise.all([
    supabase
      .from('branch_product_inventory')
      .select(
        'product_id,product_name,source_quantity,manual_stop,source,last_synced_at,preparation_minutes',
      )
      .eq('branch_id', branchId),
    supabase
      .from('inventory_reservations')
      .select('product_id,quantity,status,expires_at')
      .eq('branch_id', branchId)
      .in('status', ['active', 'committed']),
  ]);
  if (inventoryResult.error) {
    if (strict) throw inventoryResult.error;
    return new Map();
  }
  if (reservationsResult.error) {
    if (strict) throw reservationsResult.error;
    return new Map();
  }
  const held = new Map();
  for (const item of reservationsResult.data || []) {
    if (item.status === 'active' && String(item.expires_at) <= now) continue;
    held.set(item.product_id, (held.get(item.product_id) || 0) + Number(item.quantity || 0));
  }
  return new Map(
    (inventoryResult.data || []).map((item) => {
      const sourceQuantity = item.source_quantity == null ? null : Number(item.source_quantity);
      const reserved = held.get(item.product_id) || 0;
      return [
        String(item.product_id),
        {
          productName: item.product_name || null,
          sourceQuantity,
          reserved,
          availableQuantity: sourceQuantity == null ? null : Math.max(0, sourceQuantity - reserved),
          isAvailable:
            item.manual_stop !== true && (sourceQuantity == null || sourceQuantity > reserved),
          manualStop: item.manual_stop === true,
          source: item.source,
          lastSyncedAt: item.last_synced_at,
          preparationMinutes:
            item.preparation_minutes == null ? null : Number(item.preparation_minutes),
        },
      ];
    }),
  );
}

const normalizeReservationExpiry = (
  { reservationExpiresAt = null, reservationTtlMinutes, ttlMinutes } = {},
  now = new Date(),
) => {
  const normalizedTtlMinutes = Number(
    ttlMinutes ?? reservationTtlMinutes ?? DEFAULT_RESERVATION_TTL_MINUTES,
  );
  if (
    !Number.isInteger(normalizedTtlMinutes) ||
    normalizedTtlMinutes < 5 ||
    normalizedTtlMinutes > MAX_RESERVATION_TTL_MINUTES
  ) {
    throw inventoryError(`Срок резерва должен быть от 5 до ${MAX_RESERVATION_TTL_MINUTES} минут`);
  }
  if (reservationExpiresAt == null || reservationExpiresAt === '') {
    return { expiresAt: null, ttlMinutes: normalizedTtlMinutes };
  }
  const expiresAtMs = Date.parse(String(reservationExpiresAt));
  const nowMs = now.getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    throw inventoryError('Срок оплаты уже истёк');
  }
  if (expiresAtMs - nowMs > MAX_RESERVATION_TTL_MINUTES * 60 * 1000) {
    throw inventoryError('Срок оплаты превышает допустимый срок резерва');
  }
  return { expiresAt: new Date(expiresAtMs).toISOString(), ttlMinutes: normalizedTtlMinutes };
};

async function reserveCheckout({
  customerId,
  requestId,
  branchId,
  items,
  orderType,
  scheduledAt,
  reservationExpiresAt = null,
  reservationTtlMinutes,
  ttlMinutes,
}) {
  const reservation = normalizeReservationExpiry({
    reservationExpiresAt,
    reservationTtlMinutes,
    ttlMinutes,
  });
  const { data: inventory, error: inventoryRpcError } = await supabase.rpc(
    'reserve_order_inventory',
    {
      p_customer_id: customerId,
      p_request_id: requestId,
      p_branch_id: branchId,
      p_items: items,
      p_ttl_minutes: reservation.ttlMinutes,
      p_expires_at: reservation.expiresAt,
    },
  );
  if (inventoryRpcError) throw inventoryError(inventoryRpcError.message, 409);

  const { data: slot, error: slotRpcError } = await supabase.rpc('reserve_fulfillment_slot', {
    p_customer_id: customerId,
    p_request_id: requestId,
    p_branch_id: branchId,
    p_fulfillment_type: orderType,
    p_scheduled_at: scheduledAt,
    p_ttl_minutes: reservation.ttlMinutes,
    p_expires_at: reservation.expiresAt,
  });
  if (slotRpcError) {
    await releaseCheckoutRequest(customerId, requestId).catch(() => undefined);
    throw inventoryError(slotRpcError.message, 409);
  }
  return { inventory, slot };
}

async function releaseCheckoutRequest(customerId, requestId) {
  const now = new Date().toISOString();
  const [inventoryResult, slotResult] = await Promise.all([
    supabase
      .from('inventory_reservations')
      .update({ status: 'released', updated_at: now })
      .eq('customer_id', customerId)
      .eq('client_request_id', requestId)
      .eq('status', 'active'),
    supabase
      .from('fulfillment_slot_reservations')
      .update({ status: 'released', updated_at: now })
      .eq('customer_id', customerId)
      .eq('client_request_id', requestId)
      .eq('status', 'active'),
  ]);
  if (inventoryResult.error) throw inventoryResult.error;
  if (slotResult.error) throw slotResult.error;
}

async function attachOrderReservations(customerId, requestId, orderId) {
  const { data, error } = await supabase.rpc('attach_order_reservations', {
    p_customer_id: customerId,
    p_request_id: requestId,
    p_order_id: orderId,
  });
  if (error) throw error;
  if (String(data?.status || '') !== 'attached') {
    throw inventoryError('Не удалось связать резерв с заказом. Повторите оформление.', 409);
  }
  return data;
}

const normalizeReservationCommitResult = (data) => {
  const source = Array.isArray(data) ? data[0] : data;
  const result = source && typeof source === 'object' ? source : {};
  const number = (key) => Math.max(0, Number(result[key]) || 0);
  return {
    status: String(result.status || 'unknown'),
    inventoryRequested: number('inventoryRequested'),
    inventoryCommitted: number('inventoryCommitted'),
    inventoryUnitsRequested: number('inventoryUnitsRequested'),
    inventoryUnitsCommitted: number('inventoryUnitsCommitted'),
    slotRequested: number('slotRequested'),
    slotCommitted: number('slotCommitted'),
    reacquired: result.reacquired === true,
    reason: result.reason ? String(result.reason) : null,
    productId: result.productId ? String(result.productId) : null,
  };
};

async function commitOrReacquireOrderReservations(orderId, { allowReacquire = false } = {}) {
  const { data, error } = await supabase.rpc('commit_order_reservations', {
    p_order_id: orderId,
    p_allow_reacquire: allowReacquire === true,
  });
  if (error) throw error;
  return normalizeReservationCommitResult(data);
}

async function commitOrderReservations(orderId, options = {}) {
  const result = await commitOrReacquireOrderReservations(orderId, options);
  if (COMMITTED_RESERVATION_STATUSES.has(result.status)) return result;

  const errorDetails = {
    expired: ['Срок резерва заказа истёк', 'RESERVATION_EXPIRED'],
    released: ['Резерв заказа уже освобождён', 'RESERVATION_RELEASED'],
    unavailable: ['Остаток или время заказа больше недоступны', 'RESERVATION_UNAVAILABLE'],
    not_found: ['Резерв заказа не найден', 'RESERVATION_NOT_FOUND'],
    unknown: ['Не удалось подтвердить резерв заказа', 'RESERVATION_COMMIT_UNKNOWN'],
  };
  const [message, code] = errorDetails[result.status] || errorDetails.unknown;
  const error = inventoryError(message, 409);
  error.code = code;
  error.reservation = result;
  throw error;
}

async function releaseOrderReservations(orderId) {
  const { error } = await supabase.rpc('release_order_reservations', { p_order_id: orderId });
  if (error) throw error;
}

async function listInventory({ branchId = '', branchIds = [] } = {}) {
  let query = supabase
    .from('branch_product_inventory')
    .select(
      'branch_id,product_id,product_name,source_quantity,manual_stop,source,last_synced_at,updated_at,preparation_minutes,bulka_locations(name,address)',
    )
    .order('product_name', { ascending: true });
  if (branchId) query = query.eq('branch_id', branchId);
  else if (Array.isArray(branchIds) && branchIds.length) query = query.in('branch_id', branchIds);
  const { data, error } = await query.limit(5000);
  if (error) throw error;
  return data || [];
}

async function updateInventory(branchId, productId, payload = {}) {
  const quantity = payload.sourceQuantity;
  if (quantity !== null && quantity !== undefined) {
    const numeric = Number(quantity);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 100000) {
      throw inventoryError('Остаток должен быть целым числом от 0 до 100000');
    }
  }
  if (payload.manualStop !== undefined && typeof payload.manualStop !== 'boolean') {
    throw inventoryError('Некорректный стоп-лист');
  }
  if (payload.preparationMinutes !== undefined && payload.preparationMinutes !== null) {
    const minutes = Number(payload.preparationMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
      throw inventoryError('Время приготовления должно быть от 1 до 240 минут');
    }
  }
  const row = {
    branch_id: branchId,
    product_id: String(productId || '')
      .trim()
      .slice(0, 100),
    product_name:
      String(payload.productName || '')
        .trim()
        .slice(0, 160) || null,
    source_quantity: quantity == null ? null : Number(quantity),
    manual_stop: payload.manualStop === true,
    preparation_minutes:
      payload.preparationMinutes == null ? null : Number(payload.preparationMinutes),
    source: 'admin',
    updated_at: new Date().toISOString(),
  };
  if (!row.product_id) throw inventoryError('Не указан товар');
  const { data, error } = await supabase
    .from('branch_product_inventory')
    .upsert(row, { onConflict: 'branch_id,product_id' })
    .select()
    .single();
  if (error) throw error;
  const { notifyAvailableStock } = require('./stock-subscription.service');
  await notifyAvailableStock(String(branchId), [row.product_id]).catch((notificationError) =>
    console.error('Не удалось уведомить о появлении товара:', notificationError.message),
  );
  return data;
}

async function syncAllBranchInventory({ strict = false, products = [], branchIds = [] } = {}) {
  let locationsQuery = supabase.from('bulka_locations').select('id,city').eq('active', true);
  if (Array.isArray(branchIds) && branchIds.length)
    locationsQuery = locationsQuery.in('id', branchIds);
  const { data: locations, error } = await locationsQuery;
  if (error) throw error;
  const results = [];
  for (const location of locations || []) {
    const selectedIikoApi = getIikoClientForCity(location.city);
    const selectedMenu =
      Array.isArray(products) && products.length > 0 && selectedIikoApi.profileKey === 'default'
        ? { products }
        : await selectedIikoApi.getMenu({ strict });
    const result = await syncBranchInventory(location.id, {
      strict,
      products: selectedMenu.products || [],
      iikoClient: selectedIikoApi,
    });
    results.push({ branchId: location.id, tracked: result.tracked, count: result.balances.size });
  }
  return results;
}

module.exports = {
  attachOrderReservations,
  commitOrReacquireOrderReservations,
  commitOrderReservations,
  getBranchAvailability,
  listInventory,
  parseTerminalMappings,
  releaseCheckoutRequest,
  releaseOrderReservations,
  reserveCheckout,
  normalizeReservationCommitResult,
  normalizeReservationExpiry,
  syncAllBranchInventory,
  syncBranchInventory,
  terminalGroupForLocation,
  updateInventory,
};

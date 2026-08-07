const { supabase } = require('../config/supabase');
const { assignCourier } = require('./courier.service');
const { distanceKm, refreshOrderEta } = require('./eta.service');
const yandexDelivery = require('./yandex-delivery.service');

const dispatchError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const etaMinutesForKm = (kilometers, preparationMinutes = 0) =>
  Math.max(5, Math.ceil((Number(kilometers || 0) / 24) * 60 + Number(preparationMinutes || 0) + 5));

async function listDispatchState({ branchIds = [] } = {}) {
  let ordersQuery = supabase
    .from('kaspi_orders')
    .select(
      'id,order_number,branch_id,branch_name,fulfillment_type,preorder_fulfillment_type,delivery_latitude,delivery_longitude,delivery_address,courier_id,delivery_status,estimated_delivery_at,eta_min_at,eta_max_at,eta_confidence,route_distance_km,kitchen_status,promised_ready_at,created_at,amount,courier_dispatch_status,courier_dispatch_provider,courier_dispatch_requested_at,courier_dispatch_error,iiko_sync_status,iiko_sync_error,iiko_delivery_status,bulka_locations(latitude,longitude,name,address)',
    )
    .eq('status', 'paid')
    .or(
      'fulfillment_type.eq.delivery,and(fulfillment_type.eq.preorder,preorder_fulfillment_type.eq.delivery)',
    )
    .not('delivery_status', 'in', '(delivered,cancelled)')
    .order('created_at');
  if (Array.isArray(branchIds) && branchIds.length)
    ordersQuery = ordersQuery.in('branch_id', branchIds);
  const [{ data: couriers, error: courierError }, { data: orders, error: orderError }] =
    await Promise.all([supabase.from('couriers').select('*').order('name'), ordersQuery]);
  if (courierError) throw courierError;
  if (orderError) throw orderError;
  const externalJobs = await yandexDelivery.listJobsForOrders(
    (orders || []).map((order) => order.id),
  );
  const workload = new Map();
  for (const order of orders || []) {
    if (order.courier_id)
      workload.set(String(order.courier_id), (workload.get(String(order.courier_id)) || 0) + 1);
  }
  return {
    yandexDelivery: yandexDelivery.getConfigurationStatus(),
    couriers: (couriers || []).map((courier) => ({
      id: String(courier.id),
      name: courier.name,
      phone: courier.phone,
      vehicle: courier.vehicle || null,
      transportType: courier.transport_type || 'car',
      active: courier.active !== false,
      availabilityStatus: courier.availability_status || 'offline',
      latitude: courier.current_latitude == null ? null : Number(courier.current_latitude),
      longitude: courier.current_longitude == null ? null : Number(courier.current_longitude),
      locationUpdatedAt: courier.location_updated_at || null,
      activeOrders: workload.get(String(courier.id)) || 0,
      maxActiveOrders: Number(courier.max_active_orders || 3),
    })),
    orders: (orders || []).map((order) => {
      const branch = order.bulka_locations || {};
      const routeDistance =
        order.route_distance_km == null
          ? distanceKm(
              branch.latitude,
              branch.longitude,
              order.delivery_latitude,
              order.delivery_longitude,
            )
          : Number(order.route_distance_km);
      return {
        id: String(order.id),
        number: Number(order.order_number || 0),
        branchId: order.branch_id,
        branchName: order.branch_name || branch.name || '',
        branchLatitude: branch.latitude == null ? null : Number(branch.latitude),
        branchLongitude: branch.longitude == null ? null : Number(branch.longitude),
        deliveryLatitude: order.delivery_latitude == null ? null : Number(order.delivery_latitude),
        deliveryLongitude:
          order.delivery_longitude == null ? null : Number(order.delivery_longitude),
        deliveryAddress:
          order.delivery_address && typeof order.delivery_address === 'object'
            ? order.delivery_address.address || order.delivery_address.fullname || null
            : order.delivery_address || null,
        courierId: order.courier_id || null,
        deliveryStatus: order.delivery_status,
        kitchenStatus: order.kitchen_status,
        courierDispatchStatus: order.courier_dispatch_status || null,
        courierDispatchProvider: order.courier_dispatch_provider || null,
        courierDispatchRequestedAt: order.courier_dispatch_requested_at || null,
        courierDispatchError: order.courier_dispatch_error || null,
        iikoSyncStatus: order.iiko_sync_status || null,
        iikoSyncError: order.iiko_sync_error || null,
        iikoDeliveryStatus: order.iiko_delivery_status || null,
        estimatedDeliveryAt: order.estimated_delivery_at,
        etaMinAt: order.eta_min_at || null,
        etaMaxAt: order.eta_max_at || null,
        etaConfidence: order.eta_confidence || null,
        routeDistanceKm: routeDistance == null ? null : Math.round(routeDistance * 10) / 10,
        routeEtaMinutes: routeDistance == null ? null : etaMinutesForKm(routeDistance),
        amount: Number(order.amount || 0),
        externalDelivery: externalJobs.get(String(order.id)) || null,
      };
    }),
  };
}

async function findNearestCourier(orderId, { branchIds = [] } = {}) {
  const state = await listDispatchState({ branchIds });
  const order = state.orders.find((candidate) => candidate.id === String(orderId));
  if (!order) throw dispatchError('Заказ доставки не найден', 404);
  if (order.courierId) throw dispatchError('Курьер уже назначен', 409);
  const now = Date.now();
  const candidates = state.couriers
    .filter(
      (courier) =>
        courier.active &&
        courier.transportType === 'car' &&
        courier.availabilityStatus === 'available' &&
        courier.activeOrders < courier.maxActiveOrders &&
        courier.latitude != null &&
        courier.longitude != null &&
        (!courier.locationUpdatedAt ||
          now - new Date(courier.locationUpdatedAt).getTime() < 15 * 60000),
    )
    .map((courier) => ({
      ...courier,
      distanceToBranchKm: distanceKm(
        courier.latitude,
        courier.longitude,
        order.branchLatitude,
        order.branchLongitude,
      ),
    }))
    .filter((courier) => courier.distanceToBranchKm != null)
    .sort(
      (left, right) =>
        left.distanceToBranchKm +
          left.activeOrders * 2 -
          (right.distanceToBranchKm + right.activeOrders * 2) ||
        left.name.localeCompare(right.name),
    );
  return { order, courier: candidates[0] || null, candidates };
}

async function autoAssignOrder(orderId, { branchIds = [] } = {}) {
  const match = await findNearestCourier(orderId, { branchIds });
  if (match.order.externalDelivery?.claimId && !match.order.externalDelivery.terminal) {
    throw dispatchError('Сначала отмените активную заявку Яндекс.Доставки', 409);
  }
  if (!match.courier) throw dispatchError('Нет свободного курьера с актуальной геопозицией', 409);
  const totalDistance =
    Number(match.courier.distanceToBranchKm || 0) + Number(match.order.routeDistanceKm || 0);
  const eta = new Date(Date.now() + etaMinutesForKm(totalDistance) * 60000).toISOString();
  const order = await assignCourier(orderId, match.courier.id, eta);
  const refreshed = await refreshOrderEta(order).catch((etaError) => {
    console.error('Dispatch ETA refresh failed:', etaError.message);
    return order;
  });
  await supabase
    .from('couriers')
    .update({ last_assigned_at: new Date().toISOString() })
    .eq('id', match.courier.id);
  return {
    order: refreshed,
    courier: match.courier,
    eta: refreshed.estimated_delivery_at || eta,
    totalDistanceKm: Math.round(totalDistance * 10) / 10,
  };
}

async function updateCourierAvailability(courierId, status) {
  if (!['offline', 'available', 'busy', 'break'].includes(status)) {
    throw dispatchError('Некорректный статус курьера');
  }
  const { data, error } = await supabase
    .from('couriers')
    .update({ availability_status: status, updated_at: new Date().toISOString() })
    .eq('id', courierId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw dispatchError('Курьер не найден', 404);
  return data;
}

module.exports = {
  autoAssignOrder,
  distanceKm,
  etaMinutesForKm,
  findNearestCourier,
  listDispatchState,
  updateCourierAvailability,
};

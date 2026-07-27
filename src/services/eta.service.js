const { supabase } = require('../config/supabase');

const ETA_VERSION = 'eta-v3';
const MINUTE_MS = 60 * 1000;

const finite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function distanceKm(latitude1, longitude1, latitude2, longitude2) {
  const values = [latitude1, longitude1, latitude2, longitude2].map(finite);
  if (values.some((value) => value === null)) return null;
  const radians = (value) => (value * Math.PI) / 180;
  const [firstLatitude, firstLongitude, secondLatitude, secondLongitude] = values.map(radians);
  const latitudeDelta = secondLatitude - firstLatitude;
  const longitudeDelta = secondLongitude - firstLongitude;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function percentile(values, ratio) {
  const sorted = values
    .map(finite)
    .filter((value) => value !== null)
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  const position = clamp(Number(ratio) || 0, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

const durationMinutes = (from, to) => {
  const start = Date.parse(from || '');
  const end = Date.parse(to || '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return (end - start) / MINUTE_MS;
};

const localHour = (date) => {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone: process.env.BULKA_TIMEZONE || 'Asia/Aqtau',
  });
  return Number(formatter.format(date));
};

const daypart = (date) => {
  const hour = localHour(date);
  if (hour < 11) return 'morning';
  if (hour < 15) return 'lunch';
  if (hour < 18) return 'afternoon';
  return 'evening';
};

const trafficMultiplier = (date, activeDeliveries = 0, availableCouriers = 0) => {
  const hour = localHour(date);
  const rush = (hour >= 11 && hour < 14) || (hour >= 17 && hour < 21) ? 1.2 : 1;
  const fleetLoad = availableCouriers > 0 ? activeDeliveries / availableCouriers : activeDeliveries;
  return clamp(rush + Math.min(0.35, Math.max(0, fleetLoad - 1) * 0.08), 1, 1.55);
};

function buildEtaForecast({
  now = new Date(),
  orderType = 'pickup',
  scheduledAt = null,
  preparationMinutes = 15,
  prepSamples = [],
  travelSpeedSamples = [],
  activeKitchenOrders = [],
  kitchenCapacity = 3,
  directDistanceKm = null,
  courierToPickupKm = 0,
  courierToDestinationKm = null,
  activeDeliveries = 0,
  availableCouriers = 0,
  kitchenStatus = 'queued',
  kitchenStartedAt = null,
  deliveryStatus = 'unassigned',
} = {}) {
  const instant = now instanceof Date ? now : new Date(now);
  const nowMs = Number.isFinite(instant.getTime()) ? instant.getTime() : Date.now();
  const configuredPrep = clamp(Math.round(finite(preparationMinutes) || 15), 1, 240);
  const historicalPrep = percentile(prepSamples, 0.5);
  const learnedPrep = clamp(Math.round(historicalPrep || configuredPrep), 1, 240);
  const capacity = clamp(Math.round(finite(kitchenCapacity) || 3), 1, 100);
  const activeWork = activeKitchenOrders.reduce((total, order) => {
    if (order?.kitchen_status === 'ready' || order?.kitchen_status === 'handed_over') return total;
    const minutes = clamp(finite(order?.preparation_minutes) || learnedPrep, 1, 240);
    if (order?.kitchen_status === 'preparing') {
      const elapsed = durationMinutes(order.kitchen_started_at, new Date(nowMs).toISOString()) || 0;
      return total + Math.max(2, minutes - elapsed);
    }
    return total + minutes;
  }, 0);
  const queueMinutes = clamp(Math.ceil(activeWork / capacity), 0, 180);

  let remainingPrep = learnedPrep + queueMinutes;
  if (kitchenStatus === 'preparing') {
    const elapsed = durationMinutes(kitchenStartedAt, new Date(nowMs).toISOString()) || 0;
    remainingPrep = Math.max(2, learnedPrep - elapsed);
  }
  if (['ready', 'handed_over'].includes(kitchenStatus)) remainingPrep = 0;

  const courierDestinationDistance = finite(courierToDestinationKm);
  const deliveryInTransit = ['picked_up', 'en_route'].includes(deliveryStatus);
  const directDistance = clamp(
    (deliveryInTransit && courierDestinationDistance !== null
      ? courierDestinationDistance
      : finite(directDistanceKm)) || 0,
    0,
    1000,
  );
  const routeDistance = directDistance > 0 ? directDistance * 1.25 : 0;
  const historicalSpeed = percentile(travelSpeedSamples, 0.5);
  const speedKmh = clamp(historicalSpeed || 24, 10, 55);
  const traffic = trafficMultiplier(instant, activeDeliveries, availableCouriers);
  const pickupTravel = clamp(finite(courierToPickupKm) || 0, 0, 1000);
  const courierPositioningMinutes =
    orderType === 'delivery' &&
    !['picked_up', 'en_route', 'delivered', 'cancelled'].includes(deliveryStatus)
      ? (pickupTravel / speedKmh) * 60 * traffic
      : 0;
  const deliveryTravelMinutes =
    orderType === 'delivery' ? (routeDistance / speedKmh) * 60 * traffic : 0;
  const handoffMinutes = orderType === 'delivery' ? 6 : 0;
  const pointMinutes = Math.max(
    1,
    Math.ceil(remainingPrep + courierPositioningMinutes + handoffMinutes + deliveryTravelMinutes),
  );

  const prepHistoryCount = prepSamples.length;
  const travelHistoryCount = travelSpeedSamples.length;
  const historyCount = prepHistoryCount + travelHistoryCount;
  const confidence =
    orderType === 'delivery'
      ? prepHistoryCount >= 15 && travelHistoryCount >= 15 && directDistance > 0
        ? 'high'
        : prepHistoryCount >= 8 && travelHistoryCount >= 5 && directDistance > 0
          ? 'medium'
          : 'low'
      : prepHistoryCount >= 30
        ? 'high'
        : prepHistoryCount >= 8
          ? 'medium'
          : 'low';
  const spreadRatio = confidence === 'high' ? 0.14 : confidence === 'medium' ? 0.22 : 0.32;
  const minimumSpread = orderType === 'delivery' ? 5 : 3;
  const spread = Math.max(minimumSpread, Math.ceil(pointMinutes * spreadRatio));
  const scheduleMs = Date.parse(scheduledAt || '');
  const hasFutureSchedule = Number.isFinite(scheduleMs) && scheduleMs > nowMs + 5 * MINUTE_MS;

  let etaMinMs;
  let etaMaxMs;
  let estimatedMs;
  if (hasFutureSchedule) {
    etaMinMs = scheduleMs;
    etaMaxMs = scheduleMs + 10 * MINUTE_MS;
    estimatedMs = scheduleMs + 5 * MINUTE_MS;
  } else {
    etaMinMs = nowMs + Math.max(1, pointMinutes - spread) * MINUTE_MS;
    etaMaxMs = nowMs + (pointMinutes + spread) * MINUTE_MS;
    estimatedMs = nowMs + pointMinutes * MINUTE_MS;
  }

  const travelAndHandoff = courierPositioningMinutes + handoffMinutes + deliveryTravelMinutes;
  const readyPointMs =
    orderType === 'delivery' ? estimatedMs - travelAndHandoff * MINUTE_MS : estimatedMs;
  const readySpread = Math.max(3, Math.ceil(spread * 0.6));
  return {
    minAt: new Date(etaMinMs).toISOString(),
    maxAt: new Date(etaMaxMs).toISOString(),
    estimatedAt: new Date(estimatedMs).toISOString(),
    readyMinAt: new Date(Math.max(nowMs, readyPointMs - readySpread * MINUTE_MS)).toISOString(),
    readyMaxAt: new Date(Math.max(nowMs, readyPointMs + readySpread * MINUTE_MS)).toISOString(),
    minMinutes: Math.max(1, Math.round((etaMinMs - nowMs) / MINUTE_MS)),
    maxMinutes: Math.max(1, Math.round((etaMaxMs - nowMs) / MINUTE_MS)),
    confidence,
    version: ETA_VERSION,
    routeDistanceKm: routeDistance > 0 ? Math.round(routeDistance * 100) / 100 : null,
    components: {
      preparationMinutes: Math.round(remainingPrep),
      queueMinutes,
      travelMinutes: Math.round(deliveryTravelMinutes + courierPositioningMinutes),
      trafficMultiplier: Math.round(traffic * 100) / 100,
      historySamples: historyCount,
      preparationHistorySamples: prepHistoryCount,
      travelHistorySamples: travelHistoryCount,
      routeSource:
        directDistance > 0
          ? deliveryInTransit && courierDestinationDistance !== null
            ? 'courier-gps-road-factor'
            : 'historical-road-factor'
          : 'unavailable',
      scheduled: hasFutureSchedule,
    },
  };
}

const safeData = (result) =>
  result && !result.error && Array.isArray(result.data) ? result.data : [];

async function forecastOrderEta({
  branchId,
  orderType = 'pickup',
  scheduledAt = null,
  preparationMinutes = 15,
  deliveryAddress = null,
  deliveryZone = null,
  order = null,
  now = new Date(),
} = {}) {
  const parsedNow = now instanceof Date ? now : new Date(now);
  const instant = Number.isFinite(parsedNow.getTime()) ? parsedNow : new Date();
  const cutoff = new Date(instant.getTime() - 90 * 24 * 60 * MINUTE_MS).toISOString();
  try {
    const [
      branchResult,
      historyResult,
      activeResult,
      courierResult,
      fleetResult,
      deliveryLoadResult,
    ] = await Promise.all([
      branchId
        ? supabase
            .from('bulka_locations')
            .select('latitude,longitude,kitchen_parallel_capacity')
            .eq('id', branchId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      branchId
        ? supabase
            .from('kaspi_orders')
            .select(
              'created_at,kitchen_started_at,kitchen_ready_at,out_for_delivery_at,delivered_at,delivery_latitude,delivery_longitude',
            )
            .eq('branch_id', branchId)
            .gte('created_at', cutoff)
            .order('created_at', { ascending: false })
            .limit(250)
        : Promise.resolve({ data: [] }),
      branchId
        ? supabase
            .from('kaspi_orders')
            .select(
              'id,kitchen_status,preparation_minutes,kitchen_started_at,delivery_status,courier_id',
            )
            .eq('branch_id', branchId)
            .eq('status', 'paid')
            .in('kitchen_status', ['queued', 'preparing', 'ready'])
            .limit(200)
        : Promise.resolve({ data: [] }),
      order?.courier_id
        ? supabase
            .from('couriers')
            .select('current_latitude,current_longitude,location_updated_at')
            .eq('id', order.courier_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      orderType === 'delivery'
        ? supabase
            .from('couriers')
            .select('id,availability_status')
            .eq('active', true)
            .in('availability_status', ['available', 'busy'])
            .limit(200)
        : Promise.resolve({ data: [] }),
      branchId && orderType === 'delivery'
        ? supabase
            .from('kaspi_orders')
            .select('id')
            .eq('branch_id', branchId)
            .eq('status', 'paid')
            .eq('fulfillment_type', 'delivery')
            .in('delivery_status', ['unassigned', 'assigned', 'picked_up', 'en_route'])
            .limit(200)
        : Promise.resolve({ data: [] }),
    ]);

    const branch = branchResult?.error ? null : branchResult?.data;
    const history = safeData(historyResult);
    const active = safeData(activeResult);
    const currentDaypart = daypart(instant);
    const allPrepSamples = history
      .map((item) => ({
        value: durationMinutes(item.kitchen_started_at || item.created_at, item.kitchen_ready_at),
        date: new Date(item.created_at),
      }))
      .filter(({ value }) => value !== null && value >= 1 && value <= 240);
    const sameDaypart = allPrepSamples.filter(({ date }) => daypart(date) === currentDaypart);
    const prepSamples = (sameDaypart.length >= 8 ? sameDaypart : allPrepSamples).map(
      ({ value }) => value,
    );
    const travelSpeedSamples = history
      .map((item) => {
        const minutes = durationMinutes(item.out_for_delivery_at, item.delivered_at);
        const direct = distanceKm(
          branch?.latitude,
          branch?.longitude,
          item.delivery_latitude,
          item.delivery_longitude,
        );
        return minutes && direct ? (direct * 1.25 * 60) / minutes : null;
      })
      .filter((speed) => speed !== null && speed >= 5 && speed <= 80);
    const directDistance =
      finite(deliveryZone?.distanceKm) ??
      distanceKm(
        branch?.latitude,
        branch?.longitude,
        deliveryAddress?.latitude ?? order?.delivery_latitude,
        deliveryAddress?.longitude ?? order?.delivery_longitude,
      );
    const courier = courierResult?.error ? null : courierResult?.data;
    const courierLocationFresh =
      courier &&
      (!courier.location_updated_at ||
        instant.getTime() - Date.parse(courier.location_updated_at) <= 15 * MINUTE_MS);
    const courierToPickupKm = courierLocationFresh
      ? distanceKm(
          courier.current_latitude,
          courier.current_longitude,
          branch?.latitude,
          branch?.longitude,
        )
      : 0;
    const courierToDestinationKm = courierLocationFresh
      ? distanceKm(
          courier.current_latitude,
          courier.current_longitude,
          deliveryAddress?.latitude ?? order?.delivery_latitude,
          deliveryAddress?.longitude ?? order?.delivery_longitude,
        )
      : null;
    const activeDeliveries = safeData(deliveryLoadResult).length;
    const activeFleet = safeData(fleetResult).length;

    return buildEtaForecast({
      now: instant,
      orderType,
      scheduledAt,
      preparationMinutes,
      prepSamples,
      travelSpeedSamples,
      activeKitchenOrders: active.filter(
        (item) => String(item.id || '') !== String(order?.id || ''),
      ),
      kitchenCapacity: branch?.kitchen_parallel_capacity,
      directDistanceKm: directDistance,
      courierToPickupKm,
      courierToDestinationKm,
      activeDeliveries,
      availableCouriers: activeFleet,
      kitchenStatus: order?.kitchen_status,
      kitchenStartedAt: order?.kitchen_started_at,
      deliveryStatus: order?.delivery_status,
    });
  } catch (error) {
    console.error('ETA forecast fallback:', error.message);
    return buildEtaForecast({
      now: instant,
      orderType,
      scheduledAt,
      preparationMinutes,
      directDistanceKm: deliveryZone?.distanceKm,
      kitchenStatus: order?.kitchen_status,
      kitchenStartedAt: order?.kitchen_started_at,
      deliveryStatus: order?.delivery_status,
    });
  }
}

const etaDatabaseFields = (eta, orderType = 'pickup') => ({
  eta_min_at: eta.minAt,
  eta_max_at: eta.maxAt,
  eta_confidence: eta.confidence,
  eta_version: eta.version,
  eta_components: eta.components,
  eta_updated_at: new Date().toISOString(),
  route_distance_km: eta.routeDistanceKm,
  promised_ready_at: eta.readyMaxAt,
  estimated_delivery_at: orderType === 'delivery' ? eta.estimatedAt : null,
});

async function refreshOrderEta(orderOrId) {
  let order = orderOrId;
  if (!order || typeof order !== 'object') {
    const { data, error } = await supabase
      .from('kaspi_orders')
      .select('*,couriers(name)')
      .eq('id', orderOrId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    order = data;
  }
  const eta = await forecastOrderEta({
    branchId: order.branch_id,
    orderType: order.fulfillment_type || 'pickup',
    scheduledAt: order.scheduled_at,
    preparationMinutes: order.preparation_minutes,
    deliveryAddress: order.delivery_address,
    order,
  });
  const { data, error } = await supabase
    .from('kaspi_orders')
    .update(etaDatabaseFields(eta, order.fulfillment_type || 'pickup'))
    .eq('id', order.id)
    .select('*,couriers(name)')
    .maybeSingle();
  if (error) throw error;
  return data
    ? { ...order, ...data }
    : { ...order, ...etaDatabaseFields(eta, order.fulfillment_type || 'pickup') };
}

module.exports = {
  ETA_VERSION,
  buildEtaForecast,
  distanceKm,
  etaDatabaseFields,
  forecastOrderEta,
  percentile,
  refreshOrderEta,
};

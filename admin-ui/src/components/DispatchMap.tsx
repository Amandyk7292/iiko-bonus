import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useI18n } from '../lib/i18n';

type DispatchCourier = {
  id: string;
  name: string;
  phone?: string;
  latitude?: number | null;
  longitude?: number | null;
  availabilityStatus?: string;
  activeOrders?: number;
};

type DispatchOrder = {
  id: string;
  number: number;
  branchId?: string | null;
  branchName?: string | null;
  branchLatitude?: number | null;
  branchLongitude?: number | null;
  deliveryLatitude?: number | null;
  deliveryLongitude?: number | null;
  deliveryAddress?: string | null;
  courierId?: string | null;
  deliveryStatus?: string | null;
  externalDelivery?: {
    courier?: {
      name?: string | null;
      phone?: string | null;
      vehicle?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      locationUpdatedAt?: string | null;
    } | null;
    trackingUrl?: string | null;
  } | null;
};

export default function DispatchMap({
  couriers,
  orders,
}: {
  couriers: DispatchCourier[];
  orders: DispatchOrder[];
}) {
  const { t } = useI18n();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const center = useMemo(() => {
    const point = orders.find(
      (order) => order.branchLatitude != null && order.branchLongitude != null,
    );
    if (point) return [Number(point.branchLatitude), Number(point.branchLongitude)];
    const courier = couriers.find((item) => item.latitude != null && item.longitude != null);
    return courier ? [Number(courier.latitude), Number(courier.longitude)] : [43.6532, 51.1975];
  }, [couriers, orders]);
  const branches = useMemo(
    () =>
      Array.from(
        new Map(
          orders
            .filter((order) => order.branchLatitude != null && order.branchLongitude != null)
            .map((order) => [
              String(order.branchId || `branch-${order.id}`),
              {
                id: order.branchId || `branch-${order.id}`,
                name: order.branchName || 'Bulka',
                point: [Number(order.branchLatitude), Number(order.branchLongitude)],
                active: true,
                deliveryEnabled: false,
                zones: [],
              },
            ]),
        ).values(),
      ),
    [orders],
  );

  const sendState = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      JSON.stringify({
        type: 'state',
        mode: 'dispatch',
        center,
        zoom: 12,
        branches,
        couriers,
        deliveryOrders: orders,
      }),
      window.location.origin,
    );
  }, [branches, center, couriers, orders]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frameRef.current?.contentWindow
      )
        return;
      let message: unknown = event.data;
      if (typeof message === 'string') {
        try {
          message = JSON.parse(message);
        } catch {
          return;
        }
      }
      if ((message as { type?: string })?.type === 'ready') sendState();
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [sendState]);

  useEffect(() => {
    sendState();
  }, [sendState]);

  return (
    <iframe
      ref={frameRef}
      className="dispatch-map-frame"
      src="/maps/yandex?mode=dispatch"
      title={t('dispatch.mapTitle')}
      loading="eager"
      onLoad={sendState}
    />
  );
}

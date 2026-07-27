import { useCallback, useEffect, useRef } from 'react';

export type DeliveryMapZone = {
  id: string;
  radiusKm: number;
  fee: number;
  minOrder: number;
  color: string;
};

export type MapPointDetails = {
  address?: string;
  city?: string;
  source?: string;
};

type Props = {
  name: string;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  centerLatitude?: number | null;
  centerLongitude?: number | null;
  zoom?: number;
  title?: string;
  zones: DeliveryMapZone[];
  onPointChange: (
    latitude: number,
    longitude: number,
    details?: MapPointDetails,
  ) => void;
};

export default function YandexLocationMap({
  name,
  address,
  latitude,
  longitude,
  centerLatitude,
  centerLongitude,
  zoom = 13,
  title = 'Карта филиала и зон доставки',
  zones,
  onPointChange,
}: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  const sendState = useCallback(() => {
    const frame = frameRef.current;
    if (!frame?.contentWindow) return;
    const hasPoint =
      latitude != null &&
      longitude != null &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude);
    const hasCenter =
      centerLatitude != null &&
      centerLongitude != null &&
      Number.isFinite(centerLatitude) &&
      Number.isFinite(centerLongitude);
    const center = hasPoint
      ? [Number(latitude), Number(longitude)]
      : hasCenter
        ? [Number(centerLatitude), Number(centerLongitude)]
        : [48.0196, 66.9237];
    frame.contentWindow.postMessage(JSON.stringify({
      type: 'state',
      mode: 'admin',
      center,
      selected: hasPoint ? [Number(latitude), Number(longitude)] : null,
      zoom,
      branches: hasPoint ? [{
        id: 'editing',
        name,
        address,
        point: [Number(latitude), Number(longitude)],
        active: true,
        deliveryEnabled: true,
        zones,
      }] : [],
    }), window.location.origin);
  }, [
    address,
    centerLatitude,
    centerLongitude,
    latitude,
    longitude,
    name,
    zones,
    zoom,
  ]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      let message: unknown = event.data;
      if (typeof message === 'string') {
        try { message = JSON.parse(message); } catch { return; }
      }
      if (!message || typeof message !== 'object') return;
      const payload = message as Record<string, unknown>;
      if (payload.type === 'ready') sendState();
      if (payload.type === 'point' || payload.type === 'geocode') {
        const nextLatitude = Number(payload.latitude);
        const nextLongitude = Number(payload.longitude);
        if (Number.isFinite(nextLatitude) && Number.isFinite(nextLongitude)) {
          onPointChange(nextLatitude, nextLongitude, {
            ...(typeof payload.address === 'string' && { address: payload.address }),
            ...(typeof payload.city === 'string' && { city: payload.city }),
            ...(typeof payload.source === 'string' && { source: payload.source }),
          });
        }
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onPointChange, sendState]);

  useEffect(() => { sendState(); }, [sendState]);

  return <iframe
    ref={frameRef}
    className="yandex-location-map"
    src="/maps/yandex?mode=admin"
    title={title}
    loading="eager"
    onLoad={sendState}
  />;
}

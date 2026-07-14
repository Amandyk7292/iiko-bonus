import { useCallback, useEffect, useRef } from 'react';

export type DeliveryMapZone = {
  id: string;
  radiusKm: number;
  fee: number;
  minOrder: number;
  color: string;
};

type Props = {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  zones: DeliveryMapZone[];
  onPointChange: (latitude: number, longitude: number) => void;
};

export default function YandexLocationMap({
  name,
  address,
  latitude,
  longitude,
  zones,
  onPointChange,
}: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  const sendState = useCallback(() => {
    const frame = frameRef.current;
    if (!frame?.contentWindow || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    frame.contentWindow.postMessage(JSON.stringify({
      type: 'state',
      mode: 'admin',
      center: [latitude, longitude],
      selected: [latitude, longitude],
      zoom: 13,
      branches: [{
        id: 'editing',
        name,
        address,
        point: [latitude, longitude],
        active: true,
        deliveryEnabled: true,
        zones,
      }],
    }), window.location.origin);
  }, [address, latitude, longitude, name, zones]);

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
      if (payload.type === 'point') {
        const nextLatitude = Number(payload.latitude);
        const nextLongitude = Number(payload.longitude);
        if (Number.isFinite(nextLatitude) && Number.isFinite(nextLongitude)) {
          onPointChange(nextLatitude, nextLongitude);
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
    title="Карта филиала и зон доставки"
    loading="eager"
    onLoad={sendState}
  />;
}

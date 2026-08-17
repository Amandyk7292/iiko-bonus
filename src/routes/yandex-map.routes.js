const express = require('express');

const router = express.Router();

const apiKeyPattern = /^[a-zA-Z0-9_-]{20,200}$/;

router.get('/maps/yandex', (_req, res) => {
  const nonce = res.locals.cspNonce;
  const apiKey = String(process.env.YANDEX_MAPS_API_KEY || '').trim();
  if (!apiKeyPattern.test(apiKey)) {
    return res
      .status(503)
      .type('html')
      .send(
        '<!doctype html><meta charset="utf-8"><link rel="icon" type="image/png" sizes="48x48" href="/favicon.png?v=20260730-1"><p>Яндекс Карты временно недоступны.</p>',
      );
  }

  res.set('Cache-Control', 'private, no-store');
  res.set('Permissions-Policy', 'geolocation=(self)');
  res.type('html').send(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <link rel="icon" type="image/png" sizes="48x48" href="/favicon.png?v=20260730-1">
  <title>Карта доставки Bulka</title>
  <style nonce="${nonce}">
    html,body,#map{width:100%;height:100%;margin:0;overflow:hidden;background:#f7f2e8}
    body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
    #error{display:none;position:absolute;z-index:20;inset:16px auto auto 16px;max-width:calc(100% - 32px);padding:12px 14px;border-radius:14px;background:#fff;color:#6a351d;box-shadow:0 12px 36px rgba(60,34,23,.18);font-size:14px}
    #controls{position:absolute;z-index:40;right:16px;bottom:76px;display:flex;flex-direction:column;gap:9px;pointer-events:none}
    .map-control{width:50px;height:50px;padding:0;border:0;border-radius:50%;display:grid;place-items:center;background:#fff;color:#532814;box-shadow:0 8px 24px rgba(60,34,23,.22);pointer-events:auto;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
    .map-control:active{transform:scale(.96)}
    .map-control svg{width:25px;height:25px;fill:none;stroke:currentColor;stroke-width:2.25;stroke-linecap:round;stroke-linejoin:round}
    #locate{width:58px;height:58px;background:#532814;color:#fff}
    #locate.loading svg{animation:pulse .85s ease-in-out infinite alternate}
    #map [class*="-copyright"],
    #map [class*="-map-copyrights-promo"],
    #map [class*="-gotoymaps"],
    #map [class*="-gototech"]{display:none!important}
    @keyframes pulse{to{opacity:.35;transform:scale(.82)}}
  </style>
  <script nonce="${nonce}" src="https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU"></script>
</head>
<body>
  <div id="map" aria-label="Карта зон доставки Bulka"></div>
  <div id="error" role="alert">Не удалось загрузить Яндекс Карты. Проверьте подключение и настройки API-ключа.</div>
  <div id="controls" aria-label="Управление картой">
    <button id="zoom-in" class="map-control" type="button" aria-label="Приблизить"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
    <button id="zoom-out" class="map-control" type="button" aria-label="Отдалить"><svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button>
    <button id="locate" class="map-control" type="button" aria-label="Определить моё местоположение"><svg viewBox="0 0 24 24"><path d="m20 4-7.4 16-2.1-6.5L4 11.4 20 4Z"/></svg></button>
  </div>
  <script nonce="${nonce}">
    (() => {
      'use strict';
      const requestedMode = new URLSearchParams(location.search).get('mode');
      const defaults = { center:[43.6532,51.1975], selected:[43.6532,51.1975], zoom:13, mode:['admin','dispatch'].includes(requestedMode) ? requestedMode : 'customer', branches:[], couriers:[], deliveryOrders:[] };
      let state = {...defaults};
      let map = null;
      let activeBranchId = null;
      let cameraTimer = 0;
      let markerRenderTimer = 0;
      let renderedMarkerBand = -1;
      let geocodeSequence = 0;
      const errorBox = document.getElementById('error');
      const controls = document.getElementById('controls');
      const locateButton = document.getElementById('locate');

      const parse = value => {
        if (typeof value === 'string') { try { return JSON.parse(value); } catch { return null; } }
        return value && typeof value === 'object' ? value : null;
      };
      const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
      const point = value => Array.isArray(value) && number(value[0]) !== null && number(value[1]) !== null
        ? [number(value[0]), number(value[1])] : null;
      const escapeHtml = value => String(value || '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
      const emit = message => {
        const payload = JSON.stringify(message);
        try { if (window.parent !== window) window.parent.postMessage(payload, location.origin); } catch {}
        try { if (window.BulkaMap && typeof window.BulkaMap.postMessage === 'function') window.BulkaMap.postMessage(payload); } catch {}
      };
      const geocodeDetails = geoObject => {
        if (!geoObject) return {};
        const localities = typeof geoObject.getLocalities === 'function' ? geoObject.getLocalities() : [];
        const administrative = typeof geoObject.getAdministrativeAreas === 'function' ? geoObject.getAdministrativeAreas() : [];
        return {
          address:typeof geoObject.getAddressLine === 'function' ? String(geoObject.getAddressLine() || '') : '',
          city:String(localities[0] || administrative[administrative.length - 1] || '')
        };
      };
      const emitSelectedPoint = (coordinates, source = 'map', geoObject = null, extra = {}) => {
        emit({type:'point',latitude:coordinates[0],longitude:coordinates[1],source,...extra});
        if (state.mode !== 'admin') return;
        if (geoObject) {
          emit({type:'geocode',latitude:coordinates[0],longitude:coordinates[1],source,...geocodeDetails(geoObject)});
          return;
        }
        const sequence = ++geocodeSequence;
        if (!window.ymaps || typeof ymaps.geocode !== 'function') return;
        ymaps.geocode(coordinates,{results:1}).then(result => {
          if (sequence !== geocodeSequence) return;
          const first = result.geoObjects.get(0);
          if (first) emit({type:'geocode',latitude:coordinates[0],longitude:coordinates[1],source,...geocodeDetails(first)});
        }, () => {});
      };
      const showError = message => {
        errorBox.textContent = message;
        errorBox.style.display = 'block';
        window.clearTimeout(showError.timer);
        showError.timer = window.setTimeout(() => { errorBox.style.display = 'none'; }, 5000);
      };
      const haversine = (first, second) => {
        const radians = degrees => degrees * Math.PI / 180;
        const latitudeDelta = radians(second[0] - first[0]);
        const longitudeDelta = radians(second[1] - first[1]);
        const value = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(first[0])) * Math.cos(radians(second[0])) * Math.sin(longitudeDelta / 2) ** 2;
        return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
      };
      const normalizedBranches = () => (Array.isArray(state.branches) ? state.branches : []).map((branch, branchIndex) => ({
        id:String(branch.id || branchIndex),
        name:String(branch.name || 'Bulka'),
        address:String(branch.address || ''),
        point:point(branch.point),
        active:branch.active !== false,
        deliveryEnabled:branch.deliveryEnabled !== false,
        zones:(Array.isArray(branch.zones) ? branch.zones : []).map((zone, zoneIndex) => ({
          id:String(zone.id || zoneIndex), radiusKm:number(zone.radiusKm), fee:number(zone.fee), minOrder:number(zone.minOrder),
          color:/^#[0-9a-f]{6}$/i.test(String(zone.color || '')) ? String(zone.color).toUpperCase() : ['#66BB6A','#29B6F6','#FFD54F','#EC407A','#7E57C2'][zoneIndex % 5]
        })).filter(zone => zone.radiusKm > 0).sort((a,b) => a.radiusKm - b.radiusKm)
      })).filter(branch => branch.point && branch.active);
      const normalizedCouriers = () => (Array.isArray(state.couriers) ? state.couriers : []).map((courier, index) => ({
        id:String(courier.id || index), name:String(courier.name || 'Курьер'), phone:String(courier.phone || ''),
        point:point([courier.latitude,courier.longitude]), status:String(courier.availabilityStatus || 'offline'),
        activeOrders:Number(courier.activeOrders) || 0
      })).filter(courier => courier.point);
      const normalizedDeliveryOrders = () => (Array.isArray(state.deliveryOrders) ? state.deliveryOrders : []).map((order, index) => ({
        id:String(order.id || index), number:Number(order.number) || 0, address:String(order.deliveryAddress || ''),
        courierId:order.courierId ? String(order.courierId) : null,
        point:point([order.deliveryLatitude,order.deliveryLongitude]),
        courierPoint:point([
          order.externalDelivery?.courier?.latitude,
          order.externalDelivery?.courier?.longitude
        ]),
        courierName:String(order.externalDelivery?.courier?.name || ''),
        courierPhone:String(order.externalDelivery?.courier?.phone || ''),
        courierVehicle:String(order.externalDelivery?.courier?.vehicle || ''),
        trackingUrl:String(order.externalDelivery?.trackingUrl || '')
      })).filter(order => order.point);
      const selectedBranch = branches => {
        const selected = point(state.selected) || point(state.center) || defaults.center;
        const explicit = branches.find(branch => branch.id === activeBranchId);
        if (explicit) return explicit;
        return branches.filter(branch => branch.deliveryEnabled && branch.zones.length)
          .map(branch => ({branch,distance:haversine(selected,branch.point)}))
          .sort((a,b) => a.distance - b.distance)[0]?.branch || branches[0] || null;
      };
      const zoneLabel = zone => {
        const fee = zone.fee === null ? '—' : new Intl.NumberFormat('ru-RU').format(zone.fee) + ' ₸';
        return 'До ' + zone.radiusKm + ' км · ' + fee;
      };
      const markerBand = zoom => {
        const value = number(zoom) || defaults.zoom;
        if (value <= 10) return 0;
        if (value <= 11) return 1;
        if (value <= 12) return 2;
        if (value <= 13) return 3;
        if (value <= 14) return 4;
        return 5;
      };
      const markerSize = (zoom, isActive) => {
        const compactSizes = [18,22,28,36,46,56];
        return compactSizes[markerBand(zoom)] + (isActive ? 4 : 0);
      };
      const render = () => {
        if (!map) return;
        map.geoObjects.removeAll();
        const currentZoom = map.getZoom();
        renderedMarkerBand = markerBand(currentZoom);
        const branches = normalizedBranches();
        const active = selectedBranch(branches);
        if (active) activeBranchId = active.id;

        if (active) {
          [...active.zones].sort((a,b) => b.radiusKm - a.radiusKm).forEach(zone => {
            const circle = new ymaps.Circle([active.point, zone.radiusKm * 1000], {
              hintContent:zoneLabel(zone),
              balloonContent:'<strong>' + escapeHtml(zoneLabel(zone)) + '</strong><br>Минимальный заказ: ' + new Intl.NumberFormat('ru-RU').format(zone.minOrder || 0) + ' ₸'
            }, {
              fillColor:zone.color + '2E', strokeColor:zone.color, strokeOpacity:.9, strokeWidth:2,
              interactivityModel:'default#transparent', zIndex:100
            });
            map.geoObjects.add(circle);
          });
        }

        branches.forEach(branch => {
          const isAdmin = state.mode === 'admin';
          const isActive = branch.id === activeBranchId;
          const size = markerSize(currentZoom, isActive);
          const placemark = new ymaps.Placemark(branch.point, {
            hintContent:[branch.name,branch.address].filter(Boolean).join(' · '),
            balloonContent:'<strong>' + escapeHtml(branch.name) + '</strong><br>' + escapeHtml(branch.address)
          }, {
            iconLayout:'default#image',
            iconImageHref:'/assets/bulka-map-marker.png',
            iconImageSize:[size,size],
            iconImageOffset:[-size / 2,-size * .9],
            draggable:isAdmin,
            zIndex:isActive ? 450 : 400
          });
          placemark.events.add('click', () => {
            activeBranchId = branch.id;
            window.setTimeout(render, 0);
            emit({type:'branch',id:branch.id});
          });
          if (isAdmin) placemark.events.add('dragend', () => {
            const coordinates = placemark.geometry.getCoordinates();
            branch.point = coordinates;
            emitSelectedPoint(coordinates,'drag');
          });
          map.geoObjects.add(placemark);
        });

        if (state.mode === 'dispatch') {
          normalizedDeliveryOrders().forEach(order => {
            const placemark = new ymaps.Placemark(order.point, {
              iconContent:String(order.number || ''),
              hintContent:'Заказ №' + order.number + (order.address ? ' · ' + order.address : ''),
              balloonContent:'<strong>Заказ №' + order.number + '</strong><br>' + escapeHtml(order.address) + '<br>' + (order.courierId ? 'Курьер назначен' : 'Ожидает курьера')
            }, { preset:order.courierId ? 'islands#orangeStretchyIcon' : 'islands#redStretchyIcon', zIndex:520 });
            map.geoObjects.add(placemark);
            if (order.courierPoint) {
              const courierLabel = order.courierName || 'Курьер Яндекс.Доставки';
              const courierDetails = [courierLabel, order.courierVehicle, order.courierPhone].filter(Boolean).join(' · ');
              const trackingLink = String(order.trackingUrl).toLowerCase().startsWith('https://') ? '<br><a href="' + escapeHtml(order.trackingUrl) + '" target="_blank" rel="noopener">Открыть отслеживание</a>' : '';
              const courierPlacemark = new ymaps.Placemark(order.courierPoint, {
                hintContent:courierDetails,
                balloonContent:'<strong>' + escapeHtml(courierLabel) + '</strong><br>' + escapeHtml(order.courierVehicle || '') + (order.courierPhone ? '<br>' + escapeHtml(order.courierPhone) : '') + trackingLink
              }, { preset:'islands#blueCircleDotIcon', zIndex:700 });
              map.geoObjects.add(courierPlacemark);
            }
          });
          normalizedCouriers().forEach(courier => {
            const preset = courier.status === 'available' ? 'islands#greenCircleDotIcon' : courier.status === 'busy' ? 'islands#orangeCircleDotIcon' : 'islands#grayCircleDotIcon';
            const placemark = new ymaps.Placemark(courier.point, {
              hintContent:courier.name + ' · ' + courier.activeOrders + ' заказов',
              balloonContent:'<strong>' + escapeHtml(courier.name) + '</strong><br>' + escapeHtml(courier.phone) + '<br>' + escapeHtml(courier.status)
            }, { preset, zIndex:650 });
            map.geoObjects.add(placemark);
          });
        }

        const selected = point(state.selected);
        if (selected && state.mode !== 'admin') {
          map.geoObjects.add(new ymaps.Placemark(selected, {hintContent:'Адрес доставки'}, {
            preset:'islands#blackCircleDotIcon', zIndex:600
          }));
        }
      };
      const applyState = next => {
        state = {...state,...next};
        controls.style.display = state.showControls === false ? 'none' : 'flex';
        const center = point(state.center) || point(state.selected) || defaults.center;
        const minimumZoom = state.mode === 'admin' ? 4 : 9;
        const zoom = Math.max(minimumZoom,Math.min(19,number(state.zoom) || 13));
        if (map) {
          map.setCenter(center,zoom,{duration:220});
          render();
        }
      };
      window.addEventListener('message', event => {
        if (event.origin && event.origin !== location.origin && event.origin !== 'null') return;
        const message = parse(event.data);
        if (!message) return;
        if (message.type === 'state') applyState(message);
        if (message.type === 'move') applyState({center:message.center,selected:message.selected || state.selected,zoom:message.zoom || state.zoom});
        if (message.type === 'zoom' && map) map.setZoom(Math.max(state.mode === 'admin' ? 4 : 9,Math.min(19,map.getZoom() + Number(message.delta || 0))),{duration:180});
      });
      document.getElementById('zoom-in').addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (map) map.setZoom(Math.min(19,map.getZoom() + 1),{duration:180});
      });
      document.getElementById('zoom-out').addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (map) map.setZoom(Math.max(state.mode === 'admin' ? 4 : 9,map.getZoom() - 1),{duration:180});
      });
      locateButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (!navigator.geolocation) {
          showError('Определение местоположения не поддерживается браузером.');
          return;
        }
        locateButton.classList.add('loading');
        locateButton.disabled = true;
        navigator.geolocation.getCurrentPosition(position => {
          const coordinates = [position.coords.latitude,position.coords.longitude];
          state.selected = coordinates;
          state.center = coordinates;
          if (map) map.setCenter(coordinates,16,{duration:250});
          render();
          emitSelectedPoint(coordinates,'gps',null,{accuracy:position.coords.accuracy});
          locateButton.classList.remove('loading');
          locateButton.disabled = false;
        }, error => {
          const message = error.code === 1
            ? 'Разрешите точную геопозицию для bulka.com.kz в настройках Safari.'
            : error.code === 3
              ? 'Не удалось быстро определить геопозицию. Попробуйте ещё раз на открытом месте.'
              : 'Не удалось определить местоположение. Проверьте GPS и интернет.';
          showError(message);
          emit({type:'geo-error',code:error.code,message});
          locateButton.classList.remove('loading');
          locateButton.disabled = false;
        }, {enableHighAccuracy:true,maximumAge:0,timeout:20000});
      });
      const init = () => {
        map = new ymaps.Map('map',{center:defaults.center,zoom:defaults.zoom,controls:[],type:'yandex#map'},{suppressMapOpenBlock:true});
        map.behaviors.enable(['drag','dblClickZoom','multiTouch']);
        if (defaults.mode === 'admin') {
          const searchControl = new ymaps.control.SearchControl({
            options:{
              noPlacemark:true,
              provider:'yandex#search',
              placeholderContent:'Найти город или адрес',
              size:'large',
              float:'left'
            }
          });
          map.controls.add(searchControl,{float:'left'});
          searchControl.events.add('resultselect', event => {
            searchControl.getResult(event.get('index')).then(geoObject => {
              const coordinates = geoObject?.geometry?.getCoordinates();
              if (!coordinates) return;
              state.selected = coordinates;
              state.center = coordinates;
              map.setCenter(coordinates,14,{duration:250});
              emitSelectedPoint(coordinates,'search',geoObject);
              render();
            }, () => showError('Не удалось выбрать найденный адрес.'));
          });
        }
        map.events.add('click', event => {
          const coordinates = event.get('coords');
          if (state.mode === 'admin') {
            const branches = normalizedBranches();
            if (branches[0]) branches[0].point = coordinates;
          } else {
            state.selected = coordinates;
          }
          emitSelectedPoint(coordinates,'map');
          render();
        });
        map.events.add('boundschange', event => {
          window.clearTimeout(cameraTimer);
          cameraTimer = window.setTimeout(() => {
            const center = event.get('newCenter');
            emit({type:'camera',latitude:center[0],longitude:center[1],zoom:event.get('newZoom')});
          },120);
          const nextBand = markerBand(event.get('newZoom') ?? map.getZoom());
          if (nextBand !== renderedMarkerBand) {
            window.clearTimeout(markerRenderTimer);
            markerRenderTimer = window.setTimeout(render,80);
          }
        });
        render();
        emit({type:'ready'});
      };
      if (window.ymaps) ymaps.ready(init); else document.getElementById('error').style.display='block';
    })();
  </script>
</body>
</html>`);
});

module.exports = router;

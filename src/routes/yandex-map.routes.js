const express = require('express');
const path = require('node:path');

const router = express.Router();

const apiKeyPattern = /^[a-zA-Z0-9_-]{20,200}$/;

router.get('/assets/map-:kind.svg', (req, res) => {
  if (!['courier', 'pickup', 'recipient'].includes(req.params.kind)) return res.sendStatus(404);
  return res.sendFile(path.join(__dirname, '../../public/assets', `map-${req.params.kind}.svg`), {
    maxAge: '1h',
  });
});

router.get('/maps/yandex', (req, res) => {
  const isDirectory = req.query.mode === 'directory';
  const hideLocate = isDirectory || req.query.mode === 'tracking';
  const language = ['ru', 'kk', 'en'].includes(req.query.lang) ? req.query.lang : 'ru';
  // JS API 2.1 does not offer Kazakh basemap labels; local controls remain translated.
  const mapLocale = language === 'en' ? 'en_RU' : 'ru_RU';
  const copy = {
    ru: [
      'Карта Bulka',
      'Управление картой',
      'Приблизить',
      'Отдалить',
      'Моё местоположение',
      'Яндекс Карты временно недоступны.',
      'Разрешите доступ к геопозиции в настройках браузера.',
      'Не удалось определить местоположение. Попробуйте ещё раз.',
      'Адрес доставки',
    ],
    kk: [
      'Bulka картасы',
      'Картаны басқару',
      'Жақындату',
      'Алыстату',
      'Менің орналасқан жерім',
      'Яндекс Карталары уақытша қолжетімсіз.',
      'Браузер параметрлерінде геолокацияға рұқсат беріңіз.',
      'Орналасқан жерді анықтау мүмкін болмады. Қайталап көріңіз.',
      'Жеткізу мекенжайы',
    ],
    en: [
      'Bulka map',
      'Map controls',
      'Zoom in',
      'Zoom out',
      'My location',
      'Yandex Maps is temporarily unavailable.',
      'Allow location access in your browser settings.',
      'Could not determine your location. Please try again.',
      'Delivery address',
    ],
  }[language];
  const nonce = res.locals.cspNonce;
  const apiKey = String(process.env.YANDEX_MAPS_API_KEY || '').trim();
  if (!apiKeyPattern.test(apiKey)) {
    return res
      .status(503)
      .type('html')
      .send(
        `<!doctype html><meta charset="utf-8"><link rel="icon" type="image/png" sizes="48x48" href="/favicon.png?v=20260908-transparent"><p>${copy[5]}</p>`,
      );
  }

  res.set('Cache-Control', 'private, no-store');
  res.set('Permissions-Policy', isDirectory ? 'geolocation=()' : 'geolocation=(self)');
  res.type('html').send(`<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <link rel="icon" type="image/png" sizes="48x48" href="/favicon.png?v=20260908-transparent">
  <title>${copy[0]}</title>
  <link rel="stylesheet" href="/assets/brand/bulka-controls.css?v=bulka-premium-1">
  <style nonce="${nonce}">
    html,body,#map{width:100%;height:100%;margin:0;overflow:hidden;background:#fff}
    body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
    #error{display:none;position:absolute;z-index:20;inset:16px auto auto 16px;max-width:calc(100% - 32px);padding:12px 14px;border-radius:14px;background:#fff;color:#6a351d;box-shadow:0 12px 36px rgba(60,34,23,.18);font-size:14px}
    #controls{position:absolute;z-index:40;right:16px;bottom:76px;display:flex;flex-direction:column;gap:9px;pointer-events:none}
    .map-control{width:50px;height:50px;padding:0;border:0;border-radius:50%;display:grid;place-items:center;background:var(--bulka-ivory-finish);color:#532814;border:1px solid #e6d7bf;box-shadow:0 8px 24px rgba(60,34,23,.22);pointer-events:auto;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
    .map-control:active{transform:scale(.96)}
    .map-control svg{width:25px;height:25px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
    #locate{width:58px;height:58px;background:var(--bulka-cocoa-finish);color:#fff8e7}
    @font-face{font-family:BulkaMontserrat;src:url("/app/assets/assets/fonts/Montserrat-Medium-subset.ttf") format("truetype");font-weight:500;font-display:swap}
    #city-picker{display:none;position:absolute;z-index:45;top:12px;left:50%;transform:translateX(-50%);max-width:calc(100% - 100px);min-width:180px;height:44px;padding:0 18px;border:0;box-shadow:0 5px 18px rgba(83,40,20,.16);border-radius:24px;background:var(--bulka-primary-finish);border:1px solid #dba337;color:#492512;font:500 17px BulkaMontserrat,system-ui,-apple-system,"Segoe UI",sans-serif;align-items:center;justify-content:center;gap:10px;cursor:pointer;touch-action:manipulation}
    #city-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #city-picker svg{flex:none;width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.75}
    .directory #controls{right:12px;bottom:16px;gap:10px}
    .directory .map-control{position:relative;width:38px;height:38px;box-shadow:0 4px 14px rgba(60,34,23,.16)}
    .directory .map-control::after{content:"";position:absolute;inset:-3px;border-radius:50%}
    .directory .map-control svg{width:20px;height:20px}
    .directory #locate{display:none}
    #locate.loading svg{animation:pulse .85s ease-in-out infinite alternate}
    #map [class*="-copyright"],
    #map [class*="-map-copyrights-promo"],
    #map [class*="-gotoymaps"],
    #map [class*="-gototech"]{display:none!important}
    @keyframes pulse{to{opacity:.35;transform:scale(.82)}}
  </style>
  <script nonce="${nonce}" src="https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=${mapLocale}"></script>
</head>
<body>
  <div id="map" aria-label="${copy[0]}"></div>
  <button id="city-picker" type="button" aria-haspopup="dialog"><span id="city-label"></span><svg class="bulka-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="/assets/brand/bulka-icons.svg?v=bulka-premium-1#ChevronDown" /></svg></button>
  <div id="error" role="alert">${copy[5]}</div>
  <div id="controls" aria-label="${copy[1]}">
    <button id="zoom-in" class="map-control" type="button" aria-label="${copy[2]}"><svg class="bulka-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="/assets/brand/bulka-icons.svg?v=bulka-premium-1#Plus" /></svg></button>
    <button id="zoom-out" class="map-control" type="button" aria-label="${copy[3]}"><svg class="bulka-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="/assets/brand/bulka-icons.svg?v=bulka-premium-1#Minus" /></svg></button>
    ${hideLocate ? '' : `<button id="locate" class="map-control" type="button" aria-label="${copy[4]}"><svg class="bulka-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="/assets/brand/bulka-icons.svg?v=bulka-premium-1#Navigation" /></svg></button>`}
  </div>
  <script nonce="${nonce}">
    (() => {
      'use strict';
      const requestedMode = new URLSearchParams(location.search).get('mode');
      const defaults = { center:[43.6532,51.1975], selected:null, zoom:13, mode:['admin','dispatch','directory','tracking'].includes(requestedMode) ? requestedMode : 'customer', branches:[], couriers:[], deliveryOrders:[] };
      let state = {...defaults};
      let map = null;
      let activeBranchId = null;
      let cameraTimer = 0;
      let markerRenderTimer = 0;
      let renderedMarkerBand = -1;
      let geocodeSequence = 0;
      let pointerGesture = null;
      let customerPan = false;
      // GPS belongs to the viewer, not to the selected delivery address. Keep it
      // across Flutter state refreshes, city filters and marker redraws.
      let userLocation = null;
      let fittedTrackingKey = '';
      const errorBox = document.getElementById('error');
      const controls = document.getElementById('controls');
      const locateButton = document.getElementById('locate');
      if (requestedMode === 'directory') document.body.classList.add('directory');
      const cityPicker = document.getElementById('city-picker');
      // A center supplied by Flutter or a zoom animation is not an address choice.
      // Only dragging the map surface can turn a new center into the visible pin.
      const mapSurface = document.getElementById('map');
      mapSurface.addEventListener('pointerdown', event => {
        customerPan = false;
        pointerGesture = event.isPrimary === false ? null : {
          id:event.pointerId, x:event.clientX, y:event.clientY
        };
      },true);
      mapSurface.addEventListener('pointermove', event => {
        if (!pointerGesture || pointerGesture.id !== event.pointerId) return;
        if (Math.hypot(event.clientX - pointerGesture.x,event.clientY - pointerGesture.y) >= 6) {
          customerPan = true;
        }
      },true);
      mapSurface.addEventListener('pointerup', () => { pointerGesture = null; },true);
      mapSurface.addEventListener('pointercancel', () => {
        pointerGesture = null;
        customerPan = false;
      },true);
      mapSurface.addEventListener('wheel', () => { customerPan = false; },true);

      const parse = value => {
        if (typeof value === 'string') { try { return JSON.parse(value); } catch { return null; } }
        return value && typeof value === 'object' ? value : null;
      };
      const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
      const point = value => Array.isArray(value) && number(value[0]) !== null && number(value[1]) !== null
        ? [number(value[0]), number(value[1])] : null;
      const escapeHtml = value => String(value || '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
      const emit = message => {
        const payload = JSON.stringify(message);
        try { if (window.parent !== window) window.parent.postMessage(payload, location.origin); } catch {}
        try { if (window.BulkaMap && typeof window.BulkaMap.postMessage === 'function') window.BulkaMap.postMessage(payload); } catch {}
      };
      cityPicker.addEventListener('click', () => emit({type:'city'}));
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

      })).filter(branch => branch.point && branch.active);
      const normalizedCouriers = () => (Array.isArray(state.couriers) ? state.couriers : []).map((courier, index) => ({
        id:String(courier.id || index), name:String(courier.name || 'Курьер'), phone:String(courier.phone || ''),
        point:point([courier.latitude,courier.longitude]), status:String(courier.availabilityStatus || 'offline'),
        activeOrders:Number(courier.activeOrders) || 0
      })).filter(courier => courier.point);
      const trackingPoints = () => (Array.isArray(state.trackingPoints) ? state.trackingPoints : [])
        .map(item => ({kind:String(item?.kind), point:point(item?.point), label:String(item?.label || ''), address:String(item?.address || '')}))
        .filter(item => ['courier','pickup','recipient'].includes(item.kind) && item.point && Math.abs(item.point[0]) <= 90 && Math.abs(item.point[1]) <= 180 && (item.point[0] !== 0 || item.point[1] !== 0));
      const fitTrackingPoints = () => {
        const points = trackingPoints().map(item => item.point);
        if (!map || !points.length) return;
        if (points.length === 1) { map.setCenter(points[0],15,{duration:220}); return; }
        map.setBounds([
          [Math.min(...points.map(p => p[0])),Math.min(...points.map(p => p[1]))],
          [Math.max(...points.map(p => p[0])),Math.max(...points.map(p => p[1]))]
        ], {checkZoomRange:true,zoomMargin:[52,48,32,48],duration:220});
      };
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
        return branches.filter(branch => branch.deliveryEnabled)
          .map(branch => ({branch,distance:haversine(selected,branch.point)}))
          .sort((a,b) => a.distance - b.distance)[0]?.branch || branches[0] || null;
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

        if (state.mode === 'tracking') trackingPoints().forEach(item => {
          const courier = item.kind === 'courier';
          const marker = new ymaps.Placemark(item.point, {
            hintContent:item.label,
            balloonContent:'<strong>' + escapeHtml(item.label) + '</strong><br>' + escapeHtml(item.address)
          }, {iconLayout:'default#image',iconImageHref:'/assets/map-' + item.kind + '.svg',
            iconImageSize:courier ? [44,44] : [40,47],iconImageOffset:courier ? [-22,-22] : [-20,-47],zIndex:courier ? 800 : 650});
          map.geoObjects.add(marker);
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
        if (selected && !['admin','directory','tracking'].includes(state.mode)) {
          map.geoObjects.add(new ymaps.Placemark(selected, {hintContent:${JSON.stringify(copy[8])}}, {
            preset:'islands#blackCircleDotIcon', zIndex:600
          }));
        }
        if (userLocation) {
          if (userLocation.accuracy > 0) {
            map.geoObjects.add(new ymaps.Circle([userLocation.coordinates,userLocation.accuracy], {}, {
              fillColor:'#2F80ED20', strokeColor:'#2F80ED60', strokeWidth:1,
              interactivityModel:'default#transparent', zIndex:200
            }));
          }
          map.geoObjects.add(new ymaps.Placemark(userLocation.coordinates, {
            hintContent:${JSON.stringify(copy[4])}, balloonContent:${JSON.stringify(copy[4])}
          }, {preset:'islands#blueCircleDotIcon', zIndex:900}));
        }
      };
      const applyState = next => {
        customerPan = false;
        window.clearTimeout(cameraTimer);
        state = {...state,...next};
        const cityLabel = typeof state.cityLabel === 'string' ? state.cityLabel : '';
        document.getElementById('city-label').textContent = cityLabel;
        cityPicker.style.display = state.mode === 'directory' && cityLabel ? 'flex' : 'none';
        controls.style.display = state.showControls === false ? 'none' : 'flex';
        if (locateButton) locateButton.style.display = ['directory','tracking'].includes(state.mode) ? 'none' : '';
        const center = point(state.center) || point(state.selected) || defaults.center;
        const minimumZoom = state.mode === 'admin' ? 4 : 9;
        const zoom = Math.max(minimumZoom,Math.min(19,number(state.zoom) || 13));
        if (map) {
          if (state.mode !== 'tracking') map.setCenter(center,zoom,{duration:220});
          render();
          if (state.mode === 'tracking') {
            const key = trackingPoints().map(item => item.kind === 'courier' ? item.kind : [item.kind,...item.point].join(':')).join('|');
            if (key !== fittedTrackingKey) { fittedTrackingKey = key; fitTrackingPoints(); }
          }
        }
      };
      window.addEventListener('message', event => {
        if (event.origin && event.origin !== location.origin && event.origin !== 'null') return;
        const message = parse(event.data);
        if (!message) return;
        if (message.type === 'state') applyState(message);
        if (message.type === 'fit-tracking') fitTrackingPoints();
        if (message.type === 'move') applyState({center:message.center,selected:Object.prototype.hasOwnProperty.call(message,'selected') ? message.selected : state.selected,zoom:message.zoom || state.zoom});
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
      locateButton?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (state.mode === 'directory') return;
        if (!navigator.geolocation) {
          showError(${JSON.stringify(copy[7])});
          return;
        }
        locateButton.classList.add('loading');
        locateButton.disabled = true;
        navigator.geolocation.getCurrentPosition(position => {
          const coordinates = [position.coords.latitude,position.coords.longitude];
          userLocation = {coordinates,accuracy:Math.max(0,number(position.coords.accuracy) || 0)};
          state.selected = coordinates;
          state.center = coordinates;
          if (map) map.setCenter(coordinates,16,{duration:250});
          render();
          emitSelectedPoint(coordinates,'gps',null,{accuracy:position.coords.accuracy});
          locateButton.classList.remove('loading');
          locateButton.disabled = false;
        }, error => {
          const message = error.code === 1 ? ${JSON.stringify(copy[6])} : ${JSON.stringify(copy[7])};
          showError(message);
          emit({type:'geo-error',code:error.code,message});
          locateButton.classList.remove('loading');
          locateButton.disabled = false;
        }, {enableHighAccuracy:true,maximumAge:0,timeout:20000});
      });
      const init = () => {
        map = new ymaps.Map('map',{center:defaults.center,zoom:defaults.zoom,controls:[],type:'yandex#map'},{suppressMapOpenBlock:true,yandexMapDisablePoiInteractivity:true});
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
          if (['directory','tracking'].includes(state.mode)) return;
          const coordinates = event.get('coords');
          customerPan = false;
          window.clearTimeout(cameraTimer);
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
            const center = point(event.get('newCenter'));
            if (!center) return;
            const previous = point(event.get('oldCenter'));
            const zoom = event.get('newZoom');
            const changedCenter = previous && (Math.abs(center[0] - previous[0]) > 1e-8 || Math.abs(center[1] - previous[1]) > 1e-8);
            const unchangedZoom = Number(zoom) === Number(event.get('oldZoom'));
            if (state.mode === 'customer' && customerPan && changedCenter && unchangedZoom &&
                Math.abs(center[0]) <= 90 && Math.abs(center[1]) <= 180 && (center[0] !== 0 || center[1] !== 0)) {
              state.center = center;
              state.selected = center;
              render();
              emitSelectedPoint(center,'drag');
            }
            customerPan = false;
            emit({type:'camera',latitude:center[0],longitude:center[1],zoom});
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

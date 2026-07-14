const express = require('express');

const router = express.Router();

const apiKeyPattern = /^[a-zA-Z0-9_-]{20,200}$/;

router.get('/maps/yandex', (_req, res) => {
  const apiKey = String(process.env.YANDEX_MAPS_API_KEY || '').trim();
  if (!apiKeyPattern.test(apiKey)) {
    return res
      .status(503)
      .type('html')
      .send('<!doctype html><meta charset="utf-8"><p>Яндекс Карты временно недоступны.</p>');
  }

  res.set('Cache-Control', 'private, no-store');
  res.type('html').send(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <title>Карта доставки Bulka</title>
  <style>
    html,body,#map{width:100%;height:100%;margin:0;overflow:hidden;background:#f7f2e8}
    body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
    #error{display:none;position:absolute;z-index:20;inset:16px auto auto 16px;max-width:calc(100% - 32px);padding:12px 14px;border-radius:14px;background:#fff;color:#6a351d;box-shadow:0 12px 36px rgba(60,34,23,.18);font-size:14px}
  </style>
  <script src="https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU" onerror="document.getElementById('error').style.display='block'"></script>
</head>
<body>
  <div id="map" aria-label="Карта зон доставки Bulka"></div>
  <div id="error" role="alert">Не удалось загрузить Яндекс Карты. Проверьте подключение и настройки API-ключа.</div>
  <script>
    (() => {
      'use strict';
      const defaults = { center:[43.6532,51.1975], selected:[43.6532,51.1975], zoom:13, mode:'customer', branches:[] };
      let state = {...defaults};
      let map = null;
      let activeBranchId = null;
      let cameraTimer = 0;

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
      const render = () => {
        if (!map) return;
        map.geoObjects.removeAll();
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
          const placemark = new ymaps.Placemark(branch.point, {
            iconCaption:branch.name,
            hintContent:[branch.name,branch.address].filter(Boolean).join(' · '),
            balloonContent:'<strong>' + escapeHtml(branch.name) + '</strong><br>' + escapeHtml(branch.address)
          }, {
            preset:branch.id === activeBranchId ? 'islands#brownDotIconWithCaption' : 'islands#darkOrangeCircleDotIconWithCaption',
            draggable:isAdmin,
            zIndex:400
          });
          placemark.events.add('click', () => {
            activeBranchId = branch.id;
            window.setTimeout(render, 0);
            emit({type:'branch',id:branch.id});
          });
          if (isAdmin) placemark.events.add('dragend', () => {
            const coordinates = placemark.geometry.getCoordinates();
            branch.point = coordinates;
            emit({type:'point',latitude:coordinates[0],longitude:coordinates[1]});
          });
          map.geoObjects.add(placemark);
        });

        const selected = point(state.selected);
        if (selected && state.mode !== 'admin') {
          map.geoObjects.add(new ymaps.Placemark(selected, {hintContent:'Адрес доставки'}, {
            preset:'islands#blackCircleDotIcon', zIndex:600
          }));
        }
      };
      const applyState = next => {
        state = {...state,...next};
        const center = point(state.center) || point(state.selected) || defaults.center;
        const zoom = Math.max(9,Math.min(19,number(state.zoom) || 13));
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
        if (message.type === 'zoom' && map) map.setZoom(Math.max(9,Math.min(19,map.getZoom() + Number(message.delta || 0))),{duration:180});
      });
      const init = () => {
        map = new ymaps.Map('map',{center:defaults.center,zoom:defaults.zoom,controls:[],type:'yandex#map'},{suppressMapOpenBlock:true});
        map.behaviors.enable(['drag','dblClickZoom','multiTouch']);
        map.events.add('click', event => {
          const coordinates = event.get('coords');
          if (state.mode === 'admin') {
            const branches = normalizedBranches();
            if (branches[0]) branches[0].point = coordinates;
          } else {
            state.selected = coordinates;
          }
          emit({type:'point',latitude:coordinates[0],longitude:coordinates[1]});
          render();
        });
        map.events.add('boundschange', event => {
          window.clearTimeout(cameraTimer);
          cameraTimer = window.setTimeout(() => {
            const center = event.get('newCenter');
            emit({type:'camera',latitude:center[0],longitude:center[1],zoom:event.get('newZoom')});
          },120);
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

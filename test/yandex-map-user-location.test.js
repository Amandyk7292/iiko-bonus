/* global require, process, URLSearchParams, fetch */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const express = require('express');
const mapRouter = require('../src/routes/yandex-map.routes');

function runMap(html, mode) {
  const elements = new Map();
  const objects = [];
  const messages = [];
  let receive;
  let locate;
  let failLocation;
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        style: {},
        classList: { add() {}, remove() {} },
        addEventListener(event, callback) {
          this[event] = callback;
        },
      });
    }
    return elements.get(id);
  };
  class GeoObject {
    constructor(coordinates, properties, options) {
      Object.assign(this, { coordinates, properties, options });
      this.events = { add() {} };
    }
  }
  class MapView {
    constructor(_id, options) {
      this.zoom = options.zoom;
      this.geoObjects = {
        removeAll() {
          objects.length = 0;
        },
        add(object) {
          objects.push(object);
        },
      };
      this.behaviors = { enable() {} };
      this.events = { add() {} };
    }
    getZoom() {
      return this.zoom;
    }
    setCenter(_coordinates, zoom) {
      this.zoom = zoom;
    }
    setZoom(zoom) {
      this.zoom = zoom;
    }
  }
  const ymaps = { Map: MapView, Placemark: GeoObject, Circle: GeoObject, ready: (fn) => fn() };
  const window = {
    ymaps,
    BulkaMap: { postMessage: (message) => messages.push(JSON.parse(message)) },
    setTimeout: () => 1,
    clearTimeout() {},
    addEventListener: (_name, callback) => {
      receive = callback;
    },
  };
  window.parent = window;
  vm.runInNewContext(html.match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/)[1], {
    window,
    ymaps,
    URLSearchParams,
    location: { search: `?mode=${mode}`, origin: 'https://bulka.com.kz' },
    document: { getElementById: element, body: element('body') },
    navigator: {
      geolocation: {
        getCurrentPosition(success, failure) {
          locate = success;
          failLocation = failure;
        },
      },
    },
  });
  return {
    objects,
    messages,
    state: (data) => receive({ origin: 'https://bulka.com.kz', data: { type: 'state', ...data } }),
    clickLocate: () => element('locate').click({ preventDefault() {}, stopPropagation() {} }),
    gps: (latitude, longitude, accuracy) => locate({ coords: { latitude, longitude, accuracy } }),
    deny: () => failLocation({ code: 1 }),
    userMarkers: () =>
      objects.filter((object) => object.options.preset === 'islands#blueCircleDotIcon'),
    accuracyCircles: () => objects.filter((object) => object.options.fillColor === '#2F80ED20'),
  };
}

test('GPS marker stays visible independently of directory and delivery selection', async (t) => {
  const oldKey = process.env.YANDEX_MAPS_API_KEY;
  process.env.YANDEX_MAPS_API_KEY = 'test_yandex_maps_key_1234567890';
  const app = express();
  app.use((_req, res, next) => {
    res.locals.cspNonce = 'test-nonce';
    next();
  });
  app.use(mapRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => {
    server.close();
    if (oldKey === undefined) delete process.env.YANDEX_MAPS_API_KEY;
    else process.env.YANDEX_MAPS_API_KEY = oldKey;
  });
  const html = await (await fetch(`http://127.0.0.1:${server.address().port}/maps/yandex`)).text();
  for (const mode of ['directory', 'customer']) {
    await t.test(mode, () => {
      const map = runMap(html, mode);
      assert.equal(map.userMarkers().length, 0, 'No invented position before GPS access');
      map.clickLocate();
      map.deny();
      assert.equal(map.userMarkers().length, 0, 'Denied access must not add a position');
      map.clickLocate();
      map.gps(43.65, 51.19, 25);
      assert.equal(map.userMarkers().length, 1);
      assert.equal(JSON.stringify(map.userMarkers()[0].coordinates), '[43.65,51.19]');
      assert.equal(map.userMarkers()[0].properties.hintContent, 'Моё местоположение');
      assert.equal(JSON.stringify(map.accuracyCircles()[0].coordinates), '[[43.65,51.19],25]');
      map.state({ mode, selected: null, zoom: 10, branches: [] });
      assert.equal(
        map.userMarkers().length,
        1,
        'Flutter refresh and filtering keep the GPS marker',
      );
      map.state({ selected: [43.7, 51.3], zoom: 17 });
      assert.equal(
        JSON.stringify(map.userMarkers()[0].coordinates),
        '[43.65,51.19]',
        'Selecting another address must not move the user',
      );
      map.clickLocate();
      map.gps(43.66, 51.2, 12);
      assert.equal(map.userMarkers().length, 1, 'A repeated fix replaces the marker');
      assert.equal(map.accuracyCircles().length, 1);
      assert.equal(JSON.stringify(map.userMarkers()[0].coordinates), '[43.66,51.2]');
      assert.equal(JSON.stringify(map.accuracyCircles()[0].coordinates), '[[43.66,51.2],12]');
      assert.equal(map.messages.filter((message) => message.source === 'gps').length, 2);
    });
  }
});

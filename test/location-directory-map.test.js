const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const express = require('express');
const mapRouter = require('../src/routes/yandex-map.routes');

test('directory map localizes controls and retains safe map behavior', async (t) => {
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
  for (const [lang, label, locale] of [
    ['ru', 'Приблизить', 'ru_RU'],
    ['kk', 'Жақындату', 'ru_RU'],
    ['en', 'Zoom in', 'en_RU'],
  ]) {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/maps/yandex?mode=directory&lang=${lang}`,
    );
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('permissions-policy'), 'geolocation=()');
    assert.ok(!html.includes('id="locate"'));
    assert.ok(html.includes(`aria-label="${label}"`));
    assert.ok(html.includes(`&lang=${locale}`));
    const inline = html.match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/)[1];
    assert.doesNotThrow(() => new vm.Script(inline));
    assert.ok(inline.includes("if (state.mode === 'directory') return;"));
    assert.ok(inline.includes("emit({type:'branch',id:branch.id})"));
  }
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/maps/yandex?lang=%3Cscript%3E`,
  );
  assert.ok((await response.text()).includes('<html lang="ru">'));
});

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const moduleUrl = pathToFileURL(path.resolve(__dirname, '../public/fortune/wheel.mjs'));

test('fortune animation always finishes on the center of the server-selected prize', async () => {
  const { finalWheelRotation } = await import(moduleUrl);
  for (const count of [1, 3, 6, 12, 24]) {
    for (let index = 0; index < count; index += 1) {
      const previous = 9001;
      const rotation = finalWheelRotation(index, count, previous);
      assert.ok(rotation > previous + 5 * 360);
      const finalCenter = (rotation + ((index + 0.5) * 360) / count) % 360;
      assert.ok(Math.abs(finalCenter) < 0.000001 || Math.abs(finalCenter - 360) < 0.000001);
    }
  }
  assert.throws(() => finalWheelRotation(2, 2));
});

test('public wheel discards internal probability and stock fields and validates colors', async () => {
  const { publicPrizes } = await import(moduleUrl);
  assert.deepEqual(
    publicPrizes([
      { id: 'gift', label: 'Кофе', color: 'url(https://bad)', weight: 50, remaining: 3 },
    ]),
    [{ id: 'gift', label: 'Кофе', color: '#ffdd83' }],
  );
  assert.throws(() => publicPrizes([]));
  assert.throws(() =>
    publicPrizes([
      { id: 'x', label: 'First' },
      { id: 'x', label: 'Duplicate' },
    ]),
  );
});

test('claim handoff tokens stay in fragments and invalid tokens never enter links', async () => {
  const { fortuneClaimLinks } = await import(moduleUrl);
  const token = '0123456789abcdefghijklmnopqrstuvwxyz_ABCD';
  const links = fortuneClaimLinks(token);
  assert.equal(links.web, `/profile?register=1#fortune=${token}`);
  assert.equal(links.app, `bulka://profile?register=1#fortune=${token}`);
  assert.throws(() => fortuneClaimLinks('short'));
  assert.throws(() => fortuneClaimLinks('javascript:alert(1)'));
});

test('saved server draws require their snapshot and none outcomes never retain claim links', async () => {
  const { publicDraw } = await import(moduleUrl);
  const snapshot = [{ id: 'saved', label: 'Кофе', color: '#ffdd83', weight: 50 }];
  const win = { prizeId: 'saved', prizeLabel: 'Кофе', prizeKind: 'gift' };
  const claimToken = '0123456789abcdefghijklmnopqrstuvwxyz_ABCD';
  assert.deepEqual(publicDraw({ wheel: snapshot, win, claimToken }).wheel, [
    { id: 'saved', label: 'Кофе', color: '#ffdd83' },
  ]);
  assert.throws(() =>
    publicDraw({ wheel: snapshot, win: { ...win, prizeId: 'new-admin-prize' }, claimToken }),
  );
  assert.throws(() => publicDraw({ win, claimToken }));
  assert.throws(() => publicDraw({ wheel: snapshot, win, claimToken: 'bad' }));
  assert.equal(
    publicDraw({ wheel: snapshot, win: { ...win, prizeKind: 'none' }, claimToken }).claimToken,
    undefined,
  );
});

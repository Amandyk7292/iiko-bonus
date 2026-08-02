const assert = require('node:assert/strict');
const test = require('node:test');

const { SingleFlight } = require('../src/utils/single-flight.util');

test('repeated payment submissions share one in-flight operation', async () => {
  const guard = new SingleFlight();
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const submit = () =>
    guard.run('customer:checkout-id', async () => {
      calls++;
      await pending;
      return { operationId: 'kaspi-1' };
    });

  const first = submit();
  const second = submit();
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(guard.size, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), [
    { operationId: 'kaspi-1' },
    { operationId: 'kaspi-1' },
  ]);
  assert.equal(guard.size, 0);
});

test('failed payment submission can be retried safely', async () => {
  const guard = new SingleFlight();
  await assert.rejects(() =>
    guard.run('checkout', async () => Promise.reject(new Error('offline'))),
  );
  const result = await guard.run('checkout', async () => 'retried');
  assert.equal(result, 'retried');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { botFixture, message } = require('./helpers/photo-report-telegram-bot-fixture.cjs');

test('photo report polling persists its cursor and never repeats completed replies across restart', async (t) => {
  const f = await botFixture(t);
  f.queue.push(message(41, '101', 'amandyk7292', '/start'));
  assert.equal((await f.bot.pollOnce()).status, 'processed');
  assert.equal(f.sent.length, 1);
  await f.bot.stop();
  const restarted = f.create();
  t.after(() => restarted.stop());
  await restarted.pollOnce();
  assert.equal(f.polling.at(-1).offset, 42);
  assert.equal(f.sent.length, 1);
});

test('photo report polling keeps a failed command pending after claiming it', async (t) => {
  const f = await botFixture(t);
  let failures = 0;
  const store = {
    ...f.store,
    observeUser: async (...args) => {
      if (failures++ === 0) throw new Error('database temporarily unavailable');
      return f.store.observeUser(...args);
    },
  };
  const bot = f.create({ store });
  t.after(() => bot.stop());
  f.queue.push(message(11, '101', 'amandyk7292', '/time 12:00'));
  assert.equal((await bot.pollOnce()).status, 'backoff');
  assert.equal(f.sent.length, 0);
  assert.equal((await bot.pollOnce()).status, 'processed');
  assert.deepEqual(
    f.polling.map((p) => p.offset),
    [0, 0],
  );
  assert.equal((await f.store.getSettings({ db: f.db })).sendTime, '12:00');
  assert.equal(f.sent.length, 1);
});

test('photo report polling safely retries an idempotent mutation after its DB response was lost', async (t) => {
  const f = await botFixture(t);
  let changes = 0;
  const store = {
    ...f.store,
    setSendTime: async (...args) => {
      const result = await f.store.setSendTime(...args);
      if (changes++ === 0) throw new Error('response lost after commit');
      return result;
    },
  };
  const bot = f.create({ store });
  t.after(() => bot.stop());
  f.queue.push(message(11, '101', 'amandyk7292', '/time 13:00'));
  await bot.pollOnce();
  assert.equal((await f.store.getSettings({ db: f.db })).sendTime, '13:00');
  assert.equal(f.sent.length, 0);
  await bot.pollOnce();
  assert.deepEqual(
    f.polling.map((p) => p.offset),
    [0, 0],
  );
  assert.equal(f.sent.length, 1);
});

test('photo report polling resumes a prepared reply after429 and restart without repeating admin grant', async (t) => {
  const f = await botFixture(t);
  let grants = 0;
  const store = {
    ...f.store,
    addAdmin: async (...args) => {
      grants++;
      return f.store.addAdmin(...args);
    },
  };
  let attempts = 0;
  const send = f.api.sendMessage;
  f.api.sendMessage = async (...args) => {
    attempts++;
    return attempts === 1 ? { status: 'retryable', retryAfterSeconds: 60 } : send(...args);
  };
  const first = f.create({ store });
  f.queue.push(message(7, '101', 'amandyk7292', '/admin @manager_one'));
  assert.equal((await first.pollOnce()).waitMs, 60000);
  await first.stop();
  const restarted = f.create({ store });
  t.after(() => restarted.stop());
  assert.equal((await restarted.pollOnce()).status, 'backoff');
  assert.equal(attempts, 1);
  f.advance(61);
  assert.equal((await restarted.pollOnce()).status, 'processed');
  assert.equal(grants, 1);
  assert.equal(attempts, 2);
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].text, /@manager_one.*\/start/s);
});

test('photo report polling never duplicates an ambiguous send after a crash and logs only a fixed safe message', async (t) => {
  const f = await botFixture(t);
  const secret = ['synthetic', 'token'].join('-');
  let attempts = 0;
  f.api.sendMessage = async () => {
    attempts++;
    throw new Error(`https://api.telegram.org/bot${secret}/sendMessage`);
  };
  f.queue.push(message(1, '101', 'amandyk7292', '/start'));
  assert.equal((await f.bot.pollOnce()).status, 'backoff');
  assert.deepEqual(f.warnings, ['Photo report Telegram polling is temporarily unavailable.']);
  await f.bot.stop();
  const restarted = f.create();
  t.after(() => restarted.stop());
  assert.equal((await restarted.pollOnce()).status, 'processed');
  assert.equal(attempts, 1);
  await restarted.pollOnce();
  assert.equal(f.polling.at(-1).offset, 2);
  assert.equal(f.warnings.join('').includes(secret), false);
});

test('photo report polling retries only the unsent report part after429', async (t) => {
  const f = await botFixture(t);
  f.digest.generateDigest = async () => ({ parts: ['Первая часть', 'Вторая часть'] });
  const send = f.api.sendMessage;
  let attempts = 0;
  f.api.sendMessage = async (...args) => {
    attempts++;
    return attempts === 2 ? { status: 'retryable', retryAfterSeconds: 10 } : send(...args);
  };
  f.queue.push(message(1, '101', 'amandyk7292', '/report'));
  assert.equal((await f.bot.pollOnce()).status, 'backoff');
  f.advance(11);
  assert.equal((await f.bot.pollOnce()).status, 'processed');
  assert.deepEqual(
    f.sent.map((s) => s.text),
    ['Первая часть', 'Вторая часть'],
  );
});

test('photo report polling reauthorizes a leading-whitespace prepared report after admin revocation', async (t) => {
  const f = await botFixture(t);
  await f.store.observeUser(
    { id: '202', chatId: '202', username: 'manager_one', private: true },
    f.options,
  );
  await f.store.addAdmin('101', 'manager_one', f.options);
  const generate = f.digest.generateDigest;
  f.digest.generateDigest = async (...args) => {
    await generate(...args);
    return { parts: ['Доступ к фотоотчётам выдаёт владелец.'] };
  };
  let attempts = 0;
  f.api.sendMessage = async () => {
    attempts++;
    return { status: 'retryable', retryAfterSeconds: 10 };
  };
  f.queue.push(message(1, '202', 'manager_one', '  /report  '));
  await f.bot.pollOnce();
  assert.equal(attempts, 1);
  await f.store.removeAdmin('101', 'manager_one', { db: f.db, now: f.now() });
  f.advance(11);
  assert.equal((await f.bot.pollOnce()).status, 'processed');
  assert.equal(attempts, 1);
  assert.equal(f.digests.length, 1);
});

test('photo report polling preserves a non-sensitive access denial through429 and restart', async (t) => {
  const f = await botFixture(t);
  let attempts = 0;
  const send = f.api.sendMessage;
  f.api.sendMessage = async (...args) => {
    attempts++;
    return attempts === 1 ? { status: 'retryable', retryAfterSeconds: 10 } : send(...args);
  };
  f.queue.push(message(1, '202', 'unknown_user', '  /report  '));
  assert.equal((await f.bot.pollOnce()).status, 'backoff');
  await f.bot.stop();
  const restarted = f.create();
  t.after(() => restarted.stop());
  f.advance(11);
  assert.equal((await restarted.pollOnce()).status, 'processed');
  assert.equal(attempts, 2);
  assert.equal(f.digests.length, 0);
  assert.match(f.sent[0].text, /выдаёт владелец/);
});

test('photo report polling rechecks report access between multipart sends', async (t) => {
  const f = await botFixture(t);
  await f.store.observeUser(
    { id: '202', chatId: '202', username: 'manager_one', private: true },
    f.options,
  );
  await f.store.addAdmin('101', 'manager_one', f.options);
  f.digest.generateDigest = async () => ({ parts: ['Первая часть', 'Вторая часть'] });
  const send = f.api.sendMessage;
  f.api.sendMessage = async (...args) => {
    const result = await send(...args);
    await f.store.removeAdmin('101', 'manager_one', { db: f.db, now: f.now() });
    return result;
  };
  f.queue.push(message(1, '202', 'manager_one', '/report'));
  assert.equal((await f.bot.pollOnce()).status, 'processed');
  assert.deepEqual(
    f.sent.map((s) => s.text),
    ['Первая часть'],
  );
});

test('photo report polling holds a distributed lease and backs off outages instead of spinning', async (t) => {
  const f = await botFixture(t);
  const otherLease = randomUUID();
  assert.equal(await f.store.acquirePollingLease(otherLease, { db: f.db, now: f.now() }), 0);
  assert.equal((await f.bot.pollOnce()).waitMs, 5000);
  assert.equal(f.polling.length, 0);
  await f.store.releasePollingLease(otherLease, { db: f.db });
  f.api.getUpdates = async () => ({ status: 'retryable' });
  const sleeps = [];
  let bot;
  bot = f.create({
    sleep: async (ms) => {
      sleeps.push(ms);
      if (sleeps.length === 3) void bot.stop();
    },
  });
  await bot.start();
  assert.deepEqual(sleeps, [2000, 4000, 8000]);
});

test('photo report polling shutdown aborts long polling and releases its DB lease', async (t) => {
  const f = await botFixture(t);
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  f.api.getUpdates = ({ signal }) =>
    new Promise((resolve) => {
      started();
      signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
    });
  f.bot.start();
  await ready;
  await f.bot.stop();
  assert.equal(await f.store.acquirePollingLease(randomUUID(), { db: f.db, now: f.now() }), 0);
});

test('photo report polling chunks long provider cooldowns without overflowing timers', async (t) => {
  const f = await botFixture(t);
  f.api.getUpdates = async () => ({ status: 'retryable', retryAfterSeconds: 2592000 });
  const sleeps = [];
  let bot;
  bot = f.create({
    sleep: async (ms) => {
      sleeps.push(ms);
      void bot.stop();
    },
  });
  await bot.start();
  assert.deepEqual(sleeps, [60000]);
});

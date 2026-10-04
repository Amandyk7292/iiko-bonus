const test = require('node:test');
const assert = require('node:assert/strict');
const { botFixture, message } = require('./helpers/photo-report-telegram-bot-fixture.cjs');
const { privateIdentity, createBot } = require('../src/services/branch-photo-telegram-bot.service');

test('photo report bot uses configured immutable owner ID and preserves ownership after a nickname change', async (t) => {
  const f = await botFixture(t);
  await f.bot.handleUpdate(message(1, '101', 'new_owner_name', '/start'));
  assert.match(f.sent.at(-1).text, /09:00.*Казахстан/s);
  assert.match(f.sent.at(-1).text, /\/admin/);
  await f.bot.handleUpdate(message(2, '303', 'amandyk7292', '/admin @hijacker'));
  assert.match(f.sent.at(-1).text, /только владельцу/);
  assert.equal((await f.store.listAdmins('101', { db: f.db })).length, 1);
  await f.bot.handleUpdate(message(3, '101', 'new_owner_name', '/report'));
  assert.deepEqual(f.digests, ['2026-10-04']);
  await f.bot.handleUpdate(message(4, '303', 'amandyk7292', '/report'));
  assert.equal(f.digests.length, 1);
  assert.match(f.sent.at(-1).text, /выдаёт владелец/);
});

test('photo report bot grants an unstarted target only as pending and activates it after private start', async (t) => {
  const f = await botFixture(t);
  await f.bot.handleUpdate(message(1, '101', 'amandyk7292', '/admin @manager_one'));
  assert.match(f.sent.at(-1).text, /@manager_one.*\/start/s);
  assert.equal(
    (await f.store.listAdmins('101', { db: f.db })).find((r) => r.username === 'manager_one')
      .status,
    'pending',
  );
  assert.equal(
    f.sent.some((r) => r.chatId !== '101'),
    false,
  );
  await f.bot.handleUpdate(message(2, '202', 'manager_one', '/start'));
  assert.match(f.sent.at(-1).text, /подключены/);
  assert.doesNotMatch(f.sent.at(-1).text, /\/admin /);
  await f.bot.handleUpdate(message(3, '202', 'manager_one', '/report 2026-10-03'));
  assert.deepEqual(f.digests, ['2026-10-03']);
  await f.bot.handleUpdate(message(4, '202', 'manager_one', '/admin @hijacker'));
  assert.match(f.sent.at(-1).text, /только владельцу/);
  assert.equal(
    (await f.store.listAdmins('101', { db: f.db })).some((r) => r.username === 'hijacker'),
    false,
  );
});

test('photo report bot never transfers granted admin rights to a recycled nickname', async (t) => {
  const f = await botFixture(t);
  await f.bot.handleUpdate(message(1, '202', 'manager_one', '/start'));
  await f.bot.handleUpdate(message(2, '101', 'amandyk7292', '/admin @manager_one'));
  await f.bot.handleUpdate(message(3, '202', 'manager_changed', '/report'));
  assert.equal(f.digests.length, 1);
  await f.bot.handleUpdate(message(4, '303', 'manager_one', '/report'));
  assert.equal(f.digests.length, 1);
  assert.match(f.sent.at(-1).text, /выдаёт владелец/);
});

test('photo report bot owner can list and remove admins while protecting the owner', async (t) => {
  const f = await botFixture(t);
  await f.bot.handleUpdate(message(1, '101', 'amandyk7292', '/admin @manager_one'));
  await f.bot.handleUpdate(message(2, '101', 'amandyk7292', '/admins'));
  assert.match(f.sent.at(-1).text, /@manager_one — ждёт \/start/);
  await f.bot.handleUpdate(message(3, '101', 'amandyk7292', '/removeadmin @manager_one'));
  assert.match(f.sent.at(-1).text, /отключён/);
  await f.bot.handleUpdate(message(4, '101', 'amandyk7292', '/removeadmin @amandyk7292'));
  assert.match(f.sent.at(-1).text, /отключить нельзя/);
  assert.equal((await f.store.listAdmins('101', { db: f.db })).length, 1);
});

test('photo report bot ignores groups, mismatched sender identities and bot senders without report leakage', async (t) => {
  const f = await botFixture(t);
  const group = message(1, '101', 'amandyk7292', '/report', 'group');
  const mismatch = message(2, '101', 'amandyk7292', '/report');
  mismatch.message.chat.id = 303;
  const otherBot = message(3, '101', 'amandyk7292', '/report');
  otherBot.message.from.is_bot = true;
  for (const update of [group, mismatch, otherBot]) {
    assert.equal(privateIdentity(update), null);
    await f.bot.handleUpdate(update);
  }
  assert.equal(f.digests.length, 0);
  assert.equal(f.sent.length, 0);
});

test('photo report bot validates report calendar dates and owner-only Kazakhstan send time', async (t) => {
  const f = await botFixture(t);
  for (const [index, date] of ['2026-13-99', '2026-02-30', '2030-01-01'].entries()) {
    await f.bot.handleUpdate(message(index + 1, '101', 'amandyk7292', `/report ${date}`));
    assert.match(f.sent.at(-1).text, /Укажите дату/);
  }
  assert.equal(f.digests.length, 0);
  await f.bot.handleUpdate(message(4, '101', 'amandyk7292', '/time 00:00'));
  assert.equal((await f.store.getSettings({ db: f.db })).sendTime, '00:00');
  await f.bot.handleUpdate(message(5, '101', 'amandyk7292', '/time 25:00'));
  assert.match(f.sent.at(-1).text, /Формат/);
  await f.bot.handleUpdate(message(6, '202', 'manager_one', '/time 12:00'));
  assert.match(f.sent.at(-1).text, /только владельцу/);
  assert.equal((await f.store.getSettings({ db: f.db })).sendTime, '00:00');
});

test('photo report bot retains multipart manual reports as plain text with correct recipient', async (t) => {
  const f = await botFixture(t);
  f.digest.generateDigest = async () => ({ parts: ['Фото: <Зал> & пекарь', 'Продолжение'] });
  await f.bot.handleUpdate(message(1, '101', 'amandyk7292', '/report'));
  assert.deepEqual(f.sent, [
    { chatId: '101', text: 'Фото: <Зал> & пекарь' },
    { chatId: '101', text: 'Продолжение' },
  ]);
  await f.bot.handleUpdate(message(1, '101', 'amandyk7292', '/report'));
  assert.equal(f.sent.length, 2);
});

test('photo report bot rejects malformed bootstrap IDs and unsafe private numeric identifiers', () => {
  assert.throws(
    () => createBot({ store: {}, digest: {}, ownerUserId: 'invalid' }),
    /Invalid.*owner ID/,
  );
  const update = message(1, '101', 'amandyk7292', '/start');
  update.message.from.id = 9007199254740992;
  update.message.chat.id = update.message.from.id;
  assert.equal(privateIdentity(update), null);
});

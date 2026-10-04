const { fixture, NOW } = require('./photo-report-telegram-fixture.cjs');
const { createBot } = require('../../src/services/branch-photo-telegram-bot.service');
const {
  previousCalendarDate,
  localClock,
} = require('../../src/services/branch-photo-digest.service');

const message = (updateId, userId, username, text, type = 'private') => ({
  update_id: updateId,
  message: { from: { id: Number(userId), username }, chat: { id: Number(userId), type }, text },
});
async function botFixture(t) {
  const f = await fixture(t);
  let clock = new Date(NOW);
  const sent = [],
    polling = [],
    digests = [],
    warnings = [];
  const queue = [];
  const api = {
    configured: true,
    deleteWebhook: async () => ({ status: 'ok' }),
    getUpdates: async (options) => {
      polling.push(options);
      return {
        status: 'ok',
        updates: queue.filter((update) => update.update_id >= options.offset),
      };
    },
    sendMessage: async (chatId, text) => {
      sent.push({ chatId, text });
      return { status: 'sent', messageId: sent.length };
    },
  };
  const digest = {
    previousCalendarDate,
    localClock,
    generateDigest: async (date) => {
      digests.push(date);
      return { parts: [`Фотоотчёты за ${date}`] };
    },
  };
  const config = {
    store: f.store,
    db: f.db,
    api,
    digest,
    ownerUsername: 'amandyk7292',
    ownerUserId: '101',
    now: () => clock,
    logger: { warn: (value) => warnings.push(value) },
  };
  const create = (overrides = {}) => createBot({ ...config, ...overrides });
  const bot = create();
  t.after(() => bot.stop());
  return {
    ...f,
    bot,
    create,
    config,
    api,
    digest,
    sent,
    polling,
    digests,
    warnings,
    queue,
    advance: (seconds) => {
      clock = new Date(clock.getTime() + seconds * 1000);
    },
    now: () => clock,
  };
}
module.exports = { botFixture, message };

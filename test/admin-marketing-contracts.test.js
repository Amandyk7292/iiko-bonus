const assert = require('node:assert/strict');
const test = require('node:test');
process.env.SUPABASE_URL = 'https://admin-marketing-test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'admin-marketing-test-service-role';
const { adminMutationSchemas } = require('../src/contracts/admin-mutations.contract');
const broadcasts = require('../src/services/push-broadcast.service');

test('two-language admin broadcast reaches delivery with Russian fallback for optional English', async (t) => {
  const calls = [];
  t.mock.method(broadcasts, 'broadcastCustomerPush', async (...args) => {
    calls.push(args);
    return { success: true, count: 2, status: 'sent' };
  });
  const controllerPath = require.resolve('../src/controllers/admin.controller');
  delete require.cache[controllerPath];
  t.after(() => delete require.cache[controllerPath]);
  const { pushMassHandler } = require(controllerPath);
  for (const english of [undefined, '']) {
    const body = adminMutationSchemas.pushMass.body.parse({
      titleTranslations: {
        ru: 'Заголовок',
        kk: 'Тақырып',
        ...(english === undefined ? {} : { en: english }),
      },
      bodyTranslations: {
        ru: 'Текст',
        kk: 'Мәтін',
        ...(english === undefined ? {} : { en: english }),
      },
    });
    const res = {
      statusCode: 200,
      status(value) {
        this.statusCode = value;
        return this;
      },
      json(value) {
        this.body = value;
      },
    };
    await pushMassHandler({ body }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.count, 2);
  }
  assert.deepEqual(
    calls,
    Array.from({ length: 2 }, () => [
      { ru: 'Заголовок', kk: 'Тақырып', en: 'Заголовок' },
      { ru: 'Текст', kk: 'Мәтін', en: 'Текст' },
    ]),
  );
  assert.equal(
    adminMutationSchemas.pushMass.body.safeParse({
      titleTranslations: { ru: 'Title', kk: '' },
      bodyTranslations: { ru: 'Body', kk: 'Мәтін' },
    }).success,
    false,
  );
});

const inactiveConfig = {
  inactiveHours: 48,
  maximumPerDay: 1,
  reminderTimezone: 'Asia/Almaty',
  reminderWindowStart: '11:00',
  reminderWindowEnd: '16:00',
};
const automation = (config, active = false) => ({
  titleTranslations: { ru: 'Давно не заглядывали?', kk: 'Көптен бері көрінбедіңіз' },
  bodyTranslations: { ru: 'Свежая выпечка', kk: 'Жаңа піскен өнімдер' },
  config,
  active,
});

test('migrated inactivity config survives both toggle and text-save validation', () => {
  for (const active of [true, false]) {
    const parsed = adminMutationSchemas.automation.body.parse(automation(inactiveConfig, active));
    assert.equal(parsed.active, active);
    assert.deepEqual(parsed.config, inactiveConfig);
  }
});

test('inactivity config remains bounded and rejects unknown fields', () => {
  for (const patch of [
    { inactiveHours: 0 },
    { inactiveHours: 8761 },
    { maximumPerDay: 2 },
    { reminderTimezone: 'Unrecognized/Zone' },
    { reminderWindowStart: '25:00' },
    { reminderWindowEnd: '16:99' },
    { unrecognized: true },
  ]) {
    assert.equal(
      adminMutationSchemas.automation.body.safeParse(automation({ ...inactiveConfig, ...patch }))
        .success,
      false,
      JSON.stringify(patch),
    );
  }
});

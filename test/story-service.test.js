const assert = require('node:assert/strict');
const test = require('node:test');

const configPath = require.resolve('../src/config/supabase');
const servicePath = require.resolve('../src/services/story.service');

function loadStoryService(supabase) {
  const previousConfig = require.cache[configPath];
  const previousService = require.cache[servicePath];
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { supabase },
  };
  delete require.cache[servicePath];
  const service = require(servicePath);

  return {
    service,
    restore() {
      delete require.cache[servicePath];
      if (previousConfig) require.cache[configPath] = previousConfig;
      else delete require.cache[configPath];
      if (previousService) require.cache[servicePath] = previousService;
    },
  };
}

test('stories expose legacy rows and versioned promotion metadata through one API shape', async () => {
  const rows = [
    {
      id: 1700000000000,
      title: 'Старая акция',
      coverurl: 'https://example.com/legacy-cover.webp',
      contenturl: 'https://example.com/legacy-story.webp',
      description: 'Короткий текст старой акции',
      duration: 12,
      created_at: '2026-07-01T08:00:00.000Z',
    },
    {
      id: 1700000000001,
      title: 'Кофе в подарок',
      coverurl: 'https://example.com/coffee-cover.webp',
      contenturl: 'https://example.com/coffee-story.webp',
      description: JSON.stringify({
        version: 2,
        text: 'Кофе к слойке',
        details: 'Купите слойку и получите кофе.',
        promoType: 'discount',
        startsAt: '2026-07-28T00:00:00.000Z',
        endsAt: '2026-08-10T23:59:00.000Z',
        remaining: 7,
        qrValue: 'BULKA-COFFEE-7',
        createdAt: '2026-06-01T00:00:00.000Z',
        i18n: {
          ru: {
            title: 'Кофе в подарок',
            description: 'Кофе к слойке',
            details: 'Купите слойку и получите кофе.',
            coverUrl: 'https://example.com/coffee-cover.webp',
            contentUrl: 'https://example.com/coffee-story.webp',
          },
          kz: {
            title: 'Кофе сыйлыққа',
            description: 'Қатпарлы нанға кофе',
            details: 'Қатпарлы нан сатып алып, кофе алыңыз.',
            coverUrl: '',
            contentUrl: '',
          },
          en: {
            title: 'Free coffee',
            description: 'Coffee with a pastry',
            details: 'Buy a pastry and receive a coffee.',
            coverUrl: '',
            contentUrl: '',
          },
        },
      }),
      created_at: '2026-07-02T08:30:00.000Z',
    },
  ];
  const supabase = {
    from(table) {
      assert.equal(table, 'stories');
      return {
        select(columns) {
          assert.equal(columns, '*');
          return {
            async order(column, options) {
              assert.equal(column, 'id');
              assert.deepEqual(options, { ascending: true });
              return { data: rows, error: null };
            },
          };
        },
      };
    },
  };
  const loaded = loadStoryService(supabase);

  try {
    const stories = await loaded.service.getStories();
    assert.equal(stories.length, 2);
    assert.equal(stories[0].description, 'Короткий текст старой акции');
    assert.equal(stories[0].promoType, 'promotion');
    assert.equal(stories[0].details, '');
    assert.equal(stories[0].remaining, null);
    assert.equal(stories[0].qrValue, null);
    assert.equal(stories[0].createdAt, '2026-07-01T08:00:00.000Z');
    assert.equal(stories[0].i18n.ru.description, 'Короткий текст старой акции');

    assert.equal(stories[1].promoType, 'discount');
    assert.equal(stories[1].details, 'Купите слойку и получите кофе.');
    assert.equal(stories[1].i18n.kz.details, 'Қатпарлы нан сатып алып, кофе алыңыз.');
    assert.equal(stories[1].remaining, 7);
    assert.equal(stories[1].qrValue, 'BULKA-COFFEE-7');
    assert.equal(stories[1].createdAt, '2026-07-02T08:30:00.000Z');
  } finally {
    loaded.restore();
  }
});

test('adding a story serializes extended promotion fields inside description JSON', async () => {
  let inserted;
  const supabase = {
    from(table) {
      assert.equal(table, 'stories');
      return {
        insert(rows) {
          inserted = rows[0];
          return {
            select() {
              return {
                async single() {
                  return {
                    data: {
                      ...inserted,
                      created_at: '2026-07-30T10:00:00.000Z',
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const loaded = loadStoryService(supabase);
  const i18n = {
    ru: {
      title: 'Семейный абонемент',
      description: 'Покупки для всей семьи',
      details: 'Подробные условия семейного абонемента.',
      coverUrl: 'https://example.com/family-cover.webp',
      contentUrl: 'https://example.com/family-story.webp',
    },
    kz: {
      title: 'Отбасылық абонемент',
      description: '',
      details: '',
      coverUrl: '',
      contentUrl: '',
    },
    en: {
      title: 'Family subscription',
      description: '',
      details: '',
      coverUrl: '',
      contentUrl: '',
    },
  };

  try {
    const saved = await loaded.service.addStory({
      title: i18n.ru.title,
      description: i18n.ru.description,
      details: i18n.ru.details,
      coverUrl: i18n.ru.coverUrl,
      contentUrl: i18n.ru.contentUrl,
      groupId: 'family-subscription',
      groupTitle: i18n.ru.title,
      duration: 15,
      sortOrder: 4,
      promoType: 'subscription',
      startsAt: '2026-08-01T10:00:00+05:00',
      endsAt: '2026-09-01T10:00:00+05:00',
      remaining: 25,
      qrValue: 'https://bulka.com.kz/subscriptions/family',
      i18n,
    });

    const envelope = JSON.parse(inserted.description);
    assert.equal(envelope.version, 2);
    assert.equal(envelope.promoType, 'subscription');
    assert.equal(envelope.details, 'Подробные условия семейного абонемента.');
    assert.equal(envelope.startsAt, '2026-08-01T05:00:00.000Z');
    assert.equal(envelope.endsAt, '2026-09-01T05:00:00.000Z');
    assert.equal(envelope.remaining, 25);
    assert.equal(envelope.qrValue, 'https://bulka.com.kz/subscriptions/family');
    assert.equal(envelope.i18n.ru.details, 'Подробные условия семейного абонемента.');

    assert.equal(saved.promoType, 'subscription');
    assert.equal(saved.remaining, 25);
    assert.equal(saved.details, 'Подробные условия семейного абонемента.');
    assert.equal(saved.createdAt, '2026-07-30T10:00:00.000Z');
  } finally {
    loaded.restore();
  }
});

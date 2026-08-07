const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

const {
  taplinkDocumentSchema,
  taplinkDraftBodySchema,
} = require('../src/contracts/taplink.contract');
const {
  FALLBACK_TAPLINK_DOCUMENT,
  getPublicTaplink,
  publicDocument,
  publishTaplink,
  updateTaplinkDraft,
} = require('../src/services/taplink.service');
const { registerTaplinkAdminRoutes } = require('../src/routes/admin/taplink.routes');
const { registerTaplinkPublicRoutes } = require('../src/routes/public/taplink.routes');
const {
  getCachedTaplinkHtmlConfig,
  primeTaplinkHtmlConfig,
  renderTaplinkHtml,
} = require('../src/services/taplink-html.service');

const clone = (value) => JSON.parse(JSON.stringify(value));
const TAPLINK_THEME_DEFAULTS = Object.freeze({
  backgroundMode: 'brand',
  backgroundColor: '#FFB814',
  gradientFrom: '#FFD56A',
  gradientTo: '#F4A916',
  gradientDirection: 'bottom-right',
  backgroundOverlayColor: '#532814',
  backgroundOverlayOpacity: 0,
  textColor: '#532814',
  mutedTextColor: '#78665D',
  surfaceColor: '#FFFFFF',
  buttonBackgroundColor: '#FFFFFF',
  buttonTextColor: '#532814',
  primaryButtonBackgroundColor: '#FFB814',
  primaryButtonTextColor: '#3F1D0E',
  animation: 'stagger',
  buttonEffect: 'shine',
});

const pageRow = (overrides = {}) => ({
  slug: 'main',
  draft_document: clone(FALLBACK_TAPLINK_DOCUMENT),
  draft_version: 1,
  published_document: clone(FALLBACK_TAPLINK_DOCUMENT),
  published_version: 1,
  updated_at: '2026-08-07T10:00:00.000Z',
  updated_by: 'owner',
  published_at: '2026-08-07T10:00:00.000Z',
  published_by: 'owner',
  ...overrides,
});

const readDb = ({ row = pageRow(), error = null } = {}) => ({
  from(table) {
    assert.equal(table, 'taplink_pages');
    return {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      async maybeSingle() {
        return { data: row, error };
      },
    };
  },
});

const updateDb = (row, { match = true } = {}) => {
  const state = { patch: null, filters: [] };
  return {
    state,
    from(table) {
      assert.equal(table, 'taplink_pages');
      return {
        update(patch) {
          state.patch = patch;
          return this;
        },
        eq(column, value) {
          state.filters.push([column, value]);
          return this;
        },
        select() {
          return this;
        },
        async maybeSingle() {
          if (!match) return { data: null, error: null };
          return { data: { ...row, ...state.patch }, error: null };
        },
      };
    },
  };
};

async function listen(app, t) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('Taplink seed is a strict safe document with the current public links', () => {
  const result = taplinkDocumentSchema.parse(FALLBACK_TAPLINK_DOCUMENT);
  assert.equal(result.blocks.length, 4);
  const projected = publicDocument(result);
  assert.deepEqual(
    projected.blocks.filter((block) => block.type === 'link').map((block) => block.href),
    [
      'https://wa.me/77012772233',
      'https://2gis.kz/aktau/branches/70000001035248861',
      'https://2gis.kz/astana/branches/70000001114429416',
    ],
  );
});

test('legacy Taplink themes normalize every additive design default', () => {
  const legacy = clone(FALLBACK_TAPLINK_DOCUMENT);
  Object.keys(TAPLINK_THEME_DEFAULTS).forEach((field) => delete legacy.theme[field]);

  const parsed = taplinkDocumentSchema.parse(legacy);
  assert.deepEqual(parsed.theme, {
    ...legacy.theme,
    ...TAPLINK_THEME_DEFAULTS,
  });
});

test('Taplink theme accepts a valid extended design configuration', () => {
  const config = clone(FALLBACK_TAPLINK_DOCUMENT);
  Object.assign(config.theme, {
    backgroundImageUrl: 'https://cdn.example.test/taplink/background.webp',
    backgroundMode: 'gradient',
    backgroundColor: '#102A43',
    gradientFrom: '#243B53',
    gradientTo: '#486581',
    gradientDirection: 'top-left',
    backgroundOverlayColor: '#000000',
    backgroundOverlayOpacity: 35,
    textColor: '#111111',
    mutedTextColor: '#334E68',
    surfaceColor: '#FFFFFF',
    buttonBackgroundColor: '#102A43',
    buttonTextColor: '#FFFFFF',
    primaryButtonBackgroundColor: '#FFFFFF',
    primaryButtonTextColor: '#000000',
    animation: 'fade',
    buttonEffect: 'glow',
  });

  const parsed = taplinkDocumentSchema.parse(config);
  assert.equal(parsed.theme.backgroundMode, 'gradient');
  assert.equal(parsed.theme.gradientDirection, 'top-left');
  assert.equal(parsed.theme.backgroundOverlayOpacity, 35);
  assert.equal(parsed.theme.animation, 'fade');
  assert.equal(parsed.theme.buttonEffect, 'glow');
});

test('Taplink link accepts an accessible individual appearance and keeps it public', () => {
  const config = clone(FALLBACK_TAPLINK_DOCUMENT);
  config.blocks[0].appearance = {
    buttonStyle: 'outlined',
    backgroundColor: '#fefefe',
    textColor: '#222222',
    radius: 18,
    buttonEffect: 'none',
  };

  const parsed = taplinkDocumentSchema.parse(config);
  assert.deepEqual(parsed.blocks[0].appearance, {
    buttonStyle: 'outlined',
    backgroundColor: '#FEFEFE',
    textColor: '#222222',
    radius: 18,
    buttonEffect: 'none',
  });
  assert.deepEqual(publicDocument(parsed).blocks[0].appearance, parsed.blocks[0].appearance);
});

test('Taplink link rejects unsafe individual appearance values', () => {
  const invalidAppearances = [
    {
      buttonStyle: 'glass',
      backgroundColor: '#FFFFFF',
      textColor: '#222222',
      radius: 18,
      buttonEffect: 'none',
    },
    {
      buttonStyle: 'soft',
      backgroundColor: '#FFFFFF',
      textColor: '#EEEEEE',
      radius: 18,
      buttonEffect: 'none',
    },
    {
      buttonStyle: 'soft',
      backgroundColor: '#FFFFFF',
      textColor: '#222222',
      radius: 18.5,
      buttonEffect: 'none',
    },
    {
      buttonStyle: 'soft',
      backgroundColor: '#FFFFFF',
      textColor: '#222222',
      radius: 18,
      buttonEffect: 'pulse',
    },
    {
      buttonStyle: 'soft',
      backgroundColor: '#FFFFFF',
      textColor: '#222222',
      radius: 18,
      buttonEffect: 'none',
      customCss: 'position: fixed',
    },
  ];

  invalidAppearances.forEach((appearance, index) => {
    const config = clone(FALLBACK_TAPLINK_DOCUMENT);
    config.blocks[0].appearance = appearance;
    assert.equal(
      taplinkDocumentSchema.safeParse(config).success,
      false,
      `invalid appearance ${index + 1}`,
    );
  });
});

test('Taplink theme rejects unsafe values and unknown design fields', () => {
  const invalidThemes = [
    [
      'unsafe background image',
      (theme) => {
        theme.backgroundImageUrl = 'javascript:alert(1)';
      },
    ],
    [
      'short hex color',
      (theme) => {
        theme.backgroundColor = '#FFF';
      },
    ],
    [
      'alpha hex color',
      (theme) => {
        theme.surfaceColor = '#FFFFFF80';
      },
    ],
    [
      'unknown background mode',
      (theme) => {
        theme.backgroundMode = 'video';
      },
    ],
    [
      'arbitrary gradient angle',
      (theme) => {
        theme.gradientDirection = '45deg';
      },
    ],
    [
      'unknown animation',
      (theme) => {
        theme.animation = 'bounce';
      },
    ],
    [
      'unknown button effect',
      (theme) => {
        theme.buttonEffect = 'custom';
      },
    ],
    [
      'negative overlay',
      (theme) => {
        theme.backgroundOverlayOpacity = -1;
      },
    ],
    [
      'overlay above maximum',
      (theme) => {
        theme.backgroundOverlayOpacity = 71;
      },
    ],
    [
      'fractional overlay',
      (theme) => {
        theme.backgroundOverlayOpacity = 12.5;
      },
    ],
    [
      'unknown nested property',
      (theme) => {
        theme.customCss = 'body { display: none }';
      },
    ],
  ];

  invalidThemes.forEach(([label, mutate]) => {
    const config = clone(FALLBACK_TAPLINK_DOCUMENT);
    mutate(config.theme);
    assert.equal(taplinkDocumentSchema.safeParse(config).success, false, label);
  });
});

test('Taplink theme enforces WCAG AA contrast for every text and button pair', () => {
  const lowContrastPairs = [
    ['textColor', 'surfaceColor'],
    ['mutedTextColor', 'surfaceColor'],
    ['buttonTextColor', 'buttonBackgroundColor'],
    ['primaryButtonTextColor', 'primaryButtonBackgroundColor'],
  ];

  lowContrastPairs.forEach(([foreground, background]) => {
    const config = clone(FALLBACK_TAPLINK_DOCUMENT);
    config.theme[foreground] = '#777777';
    config.theme[background] = '#777777';
    assert.equal(
      taplinkDocumentSchema.safeParse(config).success,
      false,
      `${foreground}/${background}`,
    );
  });
});

test('Taplink contract rejects unsafe URLs, HTML, duplicate ids and unknown fields', () => {
  const unsafeUrl = clone(FALLBACK_TAPLINK_DOCUMENT);
  unsafeUrl.blocks[2].target.value = 'http://example.test/redirect';
  assert.equal(taplinkDocumentSchema.safeParse(unsafeUrl).success, false);

  const protocolRelativeAsset = clone(FALLBACK_TAPLINK_DOCUMENT);
  protocolRelativeAsset.profile.logoUrl = '//evil.example/logo.png';
  assert.equal(taplinkDocumentSchema.safeParse(protocolRelativeAsset).success, false);

  const markup = clone(FALLBACK_TAPLINK_DOCUMENT);
  markup.profile.title.ru = '<img src=x onerror=alert(1)>';
  assert.equal(taplinkDocumentSchema.safeParse(markup).success, false);

  const duplicate = clone(FALLBACK_TAPLINK_DOCUMENT);
  duplicate.blocks[1].id = duplicate.blocks[0].id;
  assert.equal(taplinkDocumentSchema.safeParse(duplicate).success, false);

  const nilUuid = clone(FALLBACK_TAPLINK_DOCUMENT);
  nilUuid.blocks[0].id = '00000000-0000-0000-0000-000000000000';
  assert.equal(taplinkDocumentSchema.safeParse(nilUuid).success, false);

  const unknown = clone(FALLBACK_TAPLINK_DOCUMENT);
  unknown.customCss = 'body { display: none }';
  assert.equal(taplinkDocumentSchema.safeParse(unknown).success, false);
});

test('draft request requires an optimistic revision and a strict config envelope', () => {
  assert.equal(
    taplinkDraftBodySchema.safeParse({
      config: FALLBACK_TAPLINK_DOCUMENT,
      expectedRevision: 1,
    }).success,
    true,
  );
  assert.equal(
    taplinkDraftBodySchema.safeParse({
      config: FALLBACK_TAPLINK_DOCUMENT,
      expectedRevision: 1,
      ignored: true,
    }).success,
    false,
  );
});

test('Taplink draft accepts empty optional copy and normalizes a formatted WhatsApp number', () => {
  const config = clone(FALLBACK_TAPLINK_DOCUMENT);
  config.blocks[0].subtitles = { kk: '', ru: '' };
  config.blocks[0].ariaLabels = { kk: '', ru: '' };
  config.blocks[0].target.value = '+7 (701) 277-22-33';
  const parsed = taplinkDocumentSchema.parse(config);
  assert.equal(parsed.blocks[0].target.value, '77012772233');
});

test('public Taplink uses the durable static fallback when the schema is missing', async () => {
  const page = await getPublicTaplink({
    db: readDb({
      row: null,
      error: { code: '42P01', message: 'relation taplink_pages does not exist' },
    }),
  });
  assert.equal(page.source, 'fallback');
  assert.equal(page.revision, 0);
  assert.equal(page.config.blocks[0].href, 'https://wa.me/77012772233');
});

test('public projection removes disabled blocks without mutating the stored draft', () => {
  const document = clone(FALLBACK_TAPLINK_DOCUMENT);
  document.blocks[2].enabled = false;
  const projected = publicDocument(document);
  assert.equal(projected.blocks.length, 3);
  assert.equal(document.blocks.length, 4);
  assert.equal(document.blocks[0].href, undefined);
});

test('draft update increments the revision only when the expected revision matches', async () => {
  const row = pageRow();
  const db = updateDb(row);
  const changed = clone(FALLBACK_TAPLINK_DOCUMENT);
  changed.profile.title.ru = 'Новый заголовок';
  const page = await updateTaplinkDraft(changed, 1, 'admin-user', { db });
  assert.equal(page.draftRevision, 2);
  assert.equal(page.draft.profile.title.ru, 'Новый заголовок');
  assert.deepEqual(db.state.filters, [
    ['slug', 'main'],
    ['draft_version', 1],
  ]);
  assert.equal(db.state.patch.updated_by, 'admin-user');

  await assert.rejects(
    updateTaplinkDraft(changed, 1, 'admin-user', { db: updateDb(row, { match: false }) }),
    (error) => error.statusCode === 409 && error.code === 'TAPLINK_VERSION_CONFLICT',
  );
});

test('publish delegates the version check and snapshot to the atomic database function', async () => {
  const calls = [];
  const row = pageRow({ draft_version: 2, published_version: 2 });
  const db = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: [row], error: null };
    },
  };
  const page = await publishTaplink(2, 'owner', { db });
  assert.equal(page.publishedRevision, 2);
  assert.deepEqual(calls, [
    {
      name: 'publish_taplink_page',
      args: {
        p_actor: 'owner',
        p_expected_draft_version: 2,
        p_slug: 'main',
      },
    },
  ]);

  await assert.rejects(
    publishTaplink(1, 'owner', {
      db: {
        async rpc() {
          return {
            data: null,
            error: { code: '40001', message: 'TAPLINK_VERSION_CONFLICT' },
          };
        },
      },
    }),
    (error) => error.statusCode === 409 && error.code === 'TAPLINK_VERSION_CONFLICT',
  );
});

test('modular Taplink admin routes expose read, draft and publish contracts', async (t) => {
  const calls = [];
  const page = {
    slug: 'main',
    draft: FALLBACK_TAPLINK_DOCUMENT,
    published: FALLBACK_TAPLINK_DOCUMENT,
    draftRevision: 1,
    publishedRevision: 1,
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = {
      username: String(req.get('x-test-role') || 'owner'),
      role: String(req.get('x-test-role') || 'owner'),
    };
    next();
  });
  registerTaplinkAdminRoutes(app, {
    service: {
      async getAdminTaplink() {
        calls.push(['get']);
        return page;
      },
      async updateTaplinkDraft(config, revision, actor) {
        calls.push(['draft', config.profile.title.ru, revision, actor]);
        return { ...page, draft: config, draftRevision: revision + 1 };
      },
      async publishTaplink(revision, actor) {
        calls.push(['publish', revision, actor]);
        return { ...page, publishedRevision: revision };
      },
    },
  });
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ code: error.code, error: error.message }),
  );
  const origin = await listen(app, t);

  const getResponse = await fetch(`${origin}/admin/api/taplink`);
  assert.equal(getResponse.status, 200);
  assert.match(getResponse.headers.get('cache-control') || '', /no-store/);

  const draftResponse = await fetch(`${origin}/admin/api/taplink/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: FALLBACK_TAPLINK_DOCUMENT, expectedRevision: 1 }),
  });
  assert.equal(draftResponse.status, 200);
  assert.equal((await draftResponse.json()).page.draftRevision, 2);

  const publishResponse = await fetch(`${origin}/admin/api/taplink/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 2 }),
  });
  assert.equal(publishResponse.status, 200);
  assert.deepEqual(calls, [['get'], ['draft', 'Bulka рядом', 1, 'owner'], ['publish', 2, 'owner']]);

  const forbiddenPublish = await fetch(`${origin}/admin/api/taplink/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-role': 'marketer' },
    body: JSON.stringify({ expectedRevision: 2 }),
  });
  assert.equal(forbiddenPublish.status, 403);
  assert.equal((await forbiddenPublish.json()).code, 'ADMIN_ACTION_FORBIDDEN');
});

test('public Taplink route is cacheable and supports revision ETags', async (t) => {
  const app = express();
  registerTaplinkPublicRoutes(app, {
    service: {
      async getPublicTaplink() {
        return {
          slug: 'main',
          revision: 7,
          config: publicDocument(FALLBACK_TAPLINK_DOCUMENT),
          publishedAt: '2026-08-07T10:00:00.000Z',
          source: 'database',
        };
      },
    },
  });
  const origin = await listen(app, t);
  const response = await fetch(`${origin}/api/public/taplink`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('etag'), '"taplink-7"');
  assert.match(response.headers.get('cache-control') || '', /stale-while-revalidate=300/);

  const cached = await fetch(`${origin}/api/public/taplink`, {
    headers: { 'If-None-Match': '"taplink-7"' },
  });
  assert.equal(cached.status, 304);
});

test('Taplink migration creates protected revision storage and seeds every fallback link', () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), 'supabase', 'migrations', '20260807150000_taplink_constructor.sql'),
    'utf8',
  );
  assert.match(migration, /create table if not exists public\.taplink_pages/i);
  assert.match(migration, /create table if not exists public\.taplink_revisions/i);
  assert.match(migration, /create or replace function public\.publish_taplink_page/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /TAPLINK_VERSION_CONFLICT/);
  assert.match(migration, /alter table public\.taplink_pages enable row level security/i);
  assert.match(migration, /to service_role/i);
  assert.match(migration, /https:\/\/wa\.me\/77012772233|\"value\": \"77012772233\"/);
  assert.match(migration, /https:\/\/2gis\.kz\/aktau\/branches\/70000001035248861/);
  assert.match(migration, /https:\/\/2gis\.kz\/astana\/branches\/70000001114429416/);
});

test('Taplink server renderer exposes published SEO metadata to crawlers without JavaScript', () => {
  const template = fs.readFileSync(
    path.join(process.cwd(), 'public', 'taplink', 'index.html'),
    'utf8',
  );
  const config = publicDocument(clone(FALLBACK_TAPLINK_DOCUMENT));
  config.defaultLocale = 'ru';
  config.seo.title.ru = 'Bulka & доставка';
  config.seo.description.ru = 'Свежая выпечка & адреса';
  config.seo.ogImageUrl = '/taplink/assets/brand/bulka_logo.png';

  const html = renderTaplinkHtml(template, config);
  assert.match(html, /<html\b[^>]*\blang="ru"/);
  assert.match(html, /<title data-taplink-meta="title">Bulka &amp; доставка<\/title>/);
  assert.match(html, /data-taplink-meta="og-title"[\s\S]*?content="Bulka &amp; доставка"/);
  assert.match(
    html,
    /data-taplink-meta="og-image"[\s\S]*?content="https:\/\/bulka\.com\.kz\/taplink\/assets\/brand\/bulka_logo\.png"/,
  );

  delete config.seo.ogImageUrl;
  delete config.profile.logoUrl;
  const imageFreeHtml = renderTaplinkHtml(template, config);
  assert.match(imageFreeHtml, /data-taplink-meta="og-image"[\s\S]*?content=""/);
  assert.doesNotMatch(
    imageFreeHtml,
    /data-taplink-meta="og-image"[\s\S]*?content="https:\/\/bulka\.com\.kz\/"/,
  );
});

test('Taplink server renderer hydrates a safe published theme before JavaScript', () => {
  const template = fs.readFileSync(
    path.join(process.cwd(), 'public', 'taplink', 'index.html'),
    'utf8',
  );
  const config = publicDocument(clone(FALLBACK_TAPLINK_DOCUMENT));
  config.theme = {
    ...config.theme,
    backgroundMode: 'gradient',
    backgroundColor: '#112233',
    gradientFrom: '#203040',
    gradientTo: '#405060',
    gradientDirection: 'top-left',
    backgroundImageUrl: 'https://cdn.example.test/bulka/background.png',
    backgroundOverlayColor: '#000000',
    backgroundOverlayOpacity: 20,
    textColor: '#111111',
    mutedTextColor: '#444444',
    surfaceColor: '#FFFFFF',
    buttonBackgroundColor: '#1A1A1A',
    buttonTextColor: '#FFFFFF',
    primaryButtonBackgroundColor: '#FFD000',
    primaryButtonTextColor: '#1A1A1A',
    buttonStyle: 'solid',
    animation: 'rise',
    buttonEffect: 'glow',
    radius: 28,
  };

  const html = renderTaplinkHtml(template, config);
  assert.match(html, /data-taplink-meta="theme-color"[^>]*content="#112233"/);
  assert.match(
    html,
    /<body\b[^>]*data-taplink-theme="body"[^>]*class="taplink-background-gradient"/,
  );
  assert.match(
    html,
    /<main\b[^>]*data-taplink-theme="profile"[^>]*class="profile-card taplink-buttons-solid taplink-animation-rise taplink-effect-glow"/,
  );
  assert.match(html, /--taplink-background-color: #112233/);
  assert.match(html, /--taplink-gradient-angle: 315deg/);
  assert.match(html, /--taplink-background-overlay-color: rgba\(0, 0, 0, 0\.200\)/);
  assert.match(html, /--taplink-button-background-color: #1A1A1A/);
  assert.match(html, /--taplink-primary-button-text-color: #1A1A1A/);
  assert.match(html, /--radius-control: 28px/);
  assert.match(
    html,
    /--taplink-background-image: url\(&quot;https:\/\/cdn\.example\.test\/bulka\/background\.png&quot;\)/,
  );

  const hostile = clone(config);
  hostile.theme.backgroundMode = 'gradient" onpointermove="alert(1)';
  hostile.theme.backgroundColor = '#fff; background: url(javascript:alert(1))';
  hostile.theme.backgroundImageUrl = 'javascript:alert(1)';
  hostile.theme.buttonEffect = 'shine" autofocus onfocus="alert(1)';
  const guardedHtml = renderTaplinkHtml(template, hostile);
  assert.match(guardedHtml, /class="taplink-background-brand"/);
  assert.match(guardedHtml, /--taplink-background-color: #FFB814/);
  assert.match(
    guardedHtml,
    /--taplink-background-image: url\(&quot;https:\/\/bulka\.com\.kz\/taplink\/assets\/mobile-background\.png\?v=20260806-1&quot;\)/,
  );
  assert.doesNotMatch(guardedHtml, /onpointermove|onfocus|javascript:/i);
});

test('Taplink SSR cache ignores a delayed response from an older publication', async () => {
  const newer = clone(FALLBACK_TAPLINK_DOCUMENT);
  newer.seo.title.ru = 'Новая публикация';
  const older = clone(FALLBACK_TAPLINK_DOCUMENT);
  older.seo.title.ru = 'Старая публикация';

  assert.equal(primeTaplinkHtmlConfig(newer, 3), true);
  assert.equal(primeTaplinkHtmlConfig(older, 2), false);
  assert.equal((await getCachedTaplinkHtmlConfig()).seo.title.ru, 'Новая публикация');
});

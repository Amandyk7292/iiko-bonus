const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  normalizeReorderIds,
  normalizeContactAction,
  normalizeContactCard,
  projectPublicCards,
  validateCompactPublication,
} = require('../src/services/contact-center.service');

const translations = (ru, kk = ru, en = ru) => ({ ru, kk, en });

test('contact cards require complete translations and known display modes', () => {
  assert.deepEqual(
    normalizeContactCard({
      displayMode: 'standard',
      titles: translations('Bulka'),
      iconKey: 'bulka',
      isActive: true,
      sortOrder: 2,
    }),
    {
      display_mode: 'standard',
      title_ru: 'Bulka',
      title_kk: 'Bulka',
      title_en: 'Bulka',
      icon_key: 'bulka',
      is_active: true,
      sort_order: 2,
    },
  );

  assert.throws(
    () => normalizeContactCard({ displayMode: 'banner', titles: translations('Bulka') }),
    /display mode/i,
  );
  assert.throws(
    () => normalizeContactCard({ displayMode: 'standard', titles: { ru: 'Bulka' } }),
    /three languages/i,
  );
});

test('contact actions normalize phones and reject unsafe targets', () => {
  assert.equal(
    normalizeContactAction({
      type: 'phone',
      labels: translations('Позвонить', 'Қоңырау шалу', 'Call'),
      target: '8 (700) 000-00-00',
    }).target,
    '+77000000000',
  );

  assert.equal(
    normalizeContactAction({
      type: 'email',
      labels: translations('Email'),
      target: 'HELLO@BULKA.KZ',
    }).target,
    'hello@bulka.kz',
  );

  assert.throws(
    () =>
      normalizeContactAction({
        type: 'website',
        labels: translations('Сайт'),
        target: 'javascript:alert(1)',
      }),
    /HTTPS/i,
  );
  assert.throws(
    () =>
      normalizeContactAction({
        type: 'custom_url',
        labels: translations('Ссылка'),
        target: 'https://user:pass@example.com/private',
      }),
    /HTTPS/i,
  );
});

test('public projection returns safe multilingual camelCase data', () => {
  const cards = projectPublicCards([
    {
      id: 'card-1',
      display_mode: 'standard',
      title_ru: 'Булка',
      title_kk: 'Бөлке',
      title_en: 'Bulka',
      icon_key: 'bulka',
      contact_actions: [
        {
          id: 'action-1',
          action_type: 'phone',
          label_ru: 'Телефон',
          label_kk: 'Телефон',
          label_en: 'Phone',
          target: '+77000000000',
          icon_key: 'phone',
        },
      ],
    },
  ]);

  assert.deepEqual(cards, [
    {
      id: 'card-1',
      displayMode: 'standard',
      titles: { ru: 'Булка', kk: 'Бөлке', en: 'Bulka' },
      iconKey: 'bulka',
      actions: [
        {
          id: 'action-1',
          type: 'phone',
          labels: { ru: 'Телефон', kk: 'Телефон', en: 'Phone' },
          target: '+77000000000',
          iconKey: 'phone',
        },
      ],
    },
  ]);
});

test('contact migration mirrors Supabase and protects both tables', () => {
  const primary = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260718120000_contact_center.sql',
    ),
    'utf8',
  );
  const mirrored = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260718120000_contact_center.sql',
    ),
    'utf8',
  );

  assert.equal(primary, mirrored);
  assert.match(primary, /create table if not exists public\.contact_cards/i);
  assert.match(primary, /create table if not exists public\.contact_actions/i);
  assert.match(primary, /on delete cascade/i);
  assert.match(primary, /service_role_all_contact_cards/i);
  assert.match(primary, /service_role_all_contact_actions/i);
  assert.match(primary, /reorder_contact_cards/i);
  assert.match(primary, /reorder_contact_actions/i);
});

test('reorder validation requires the complete unique id set', () => {
  assert.deepEqual(normalizeReorderIds(['card-b', 'card-a'], ['card-a', 'card-b']), [
    { id: 'card-b', sort_order: 0 },
    { id: 'card-a', sort_order: 1 },
  ]);
  assert.throws(
    () => normalizeReorderIds(['card-a', 'card-a'], ['card-a', 'card-b']),
    /complete unique/i,
  );
  assert.throws(
    () => normalizeReorderIds(['card-a'], ['card-a', 'card-b']),
    /complete unique/i,
  );
});

test('active compact cards allow multiple actions but require at least one', () => {
  assert.doesNotThrow(() =>
    validateCompactPublication({ displayMode: 'compact', isActive: true, activeActionCount: 1 }),
  );
  assert.doesNotThrow(() =>
    validateCompactPublication({ displayMode: 'compact', isActive: true, activeActionCount: 3 }),
  );
  assert.throws(
    () => validateCompactPublication({ displayMode: 'compact', isActive: true, activeActionCount: 0 }),
    /at least one active action/i,
  );
  assert.doesNotThrow(() =>
    validateCompactPublication({ displayMode: 'standard', isActive: true, activeActionCount: 3 }),
  );
});

test('backend exposes public contacts, protected CRUD, and notification payload', () => {
  const publicRoutes = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'public.routes.js'),
    'utf8',
  );
  const adminRoutes = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'admin', 'contact-center.routes.js'),
    'utf8',
  );
  const legacyRoutes = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'legacy.routes.js'),
    'utf8',
  );

  assert.match(publicRoutes, /\/api\/public\/contact-center/);
  assert.match(adminRoutes, /\/admin\/api\/contact-cards/);
  assert.match(adminRoutes, /\/admin\/api\/contact-actions/);
  assert.match(legacyRoutes, /select\('id,title,body,type,payload,is_read,created_at'\)/);
  const service = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'contact-center.service.js'),
    'utf8',
  );
  assert.match(service, /rpc\('reorder_contact_cards'/);
  assert.match(service, /rpc\('reorder_contact_actions'/);
});

test('admin UI exposes complete contact card and action management', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'admin-ui', 'src', 'App.tsx'), 'utf8');
  const sidebar = fs.readFileSync(
    path.join(__dirname, '..', 'admin-ui', 'src', 'components', 'Sidebar.tsx'),
    'utf8',
  );
  const api = fs.readFileSync(
    path.join(__dirname, '..', 'admin-ui', 'src', 'lib', 'api.ts'),
    'utf8',
  );
  const page = fs.readFileSync(
    path.join(__dirname, '..', 'admin-ui', 'src', 'pages', 'ContactCenterPage.tsx'),
    'utf8',
  );

  assert.match(app, /path="\/contacts"/);
  assert.match(sidebar, /to: '\/contacts'/);
  assert.match(api, /getContactCards/);
  assert.match(api, /createContactCard/);
  assert.match(api, /reorderContactCards/);
  assert.match(api, /createContactAction/);
  assert.match(api, /reorderContactActions/);
  assert.match(page, /displayMode/);
  assert.match(page, /activeLanguage/);
  assert.match(page, /removeCard/);
  assert.match(page, /removeAction/);
});

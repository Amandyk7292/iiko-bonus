# Bulka Notification and Contact Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Bulka-branded notification/contact center whose public, multilingual contact cards and arbitrary action buttons are fully managed through the existing admin panel.

**Architecture:** Add dedicated Supabase `contact_cards` and `contact_actions` tables behind a focused Node service, public projection endpoint, and protected admin CRUD endpoints. The Flutter client caches the public projection, gates only the notification tab, resolves notification payload destinations through shell callbacks, and renders the supplied layout in Bulka colors. The React admin gets a dedicated Contacts page using the existing API, modal, feedback, i18n, and sidebar patterns.

**Tech Stack:** PostgreSQL/Supabase, Node.js 22 + Express 4 + `node:test`, React 19 + TypeScript 6 + Vite 8, Flutter/Dart 3.10, SharedPreferences, `url_launcher`, image generation for the branded empty-state PNG.

## Global Constraints

- Target iOS, Android, and Flutter Web.
- Contacts are public; notifications require the existing customer authentication flow.
- Contact cards and actions require Russian, Kazakh, and English text before publication.
- Allowed actions are phone, WhatsApp, Telegram, Instagram, VK, email, website, online chat, and custom HTTPS link.
- Preserve Bulka tokens: gold `#FFB814`, brown `#532814`, white/cream surfaces, Circe body type, KulikovSoft headings where already appropriate.
- Preserve every unrelated dirty-worktree change. Before staging, inspect `git diff -- <paths>` and `git diff --cached --name-only`; do not commit pre-existing work mixed into an overlapping file.
- Write a failing automated test before production behavior. Generated artwork and migration text are verified by contract tests immediately after creation.
- No fake contact records are seeded.
- Never accept or launch `javascript:`, `data:`, embedded-credential, control-character, or non-HTTPS web targets.

---

## File Map

### New backend files

- `migrations/021_contact_center.sql` — additive production migration.
- `supabase/migrations/20260718120000_contact_center.sql` — byte-for-byte mirror for Supabase CLI.
- `src/services/contact-center.service.js` — validation, projection, persistence, CRUD, and reorder boundary.
- `test/contact-center.test.js` — migration, validation, projection, and persistence contract tests.

### Existing backend files

- `supabase_schema.sql` — fresh-install schema mirror.
- `src/routes/public.routes.js` — unauthenticated contact projection endpoint.
- `src/routes/admin.routes.js` — protected contact CRUD endpoints.
- `src/routes/legacy.routes.js` — include notification payload in the customer notification response.
- `src/middlewares/auth.middleware.js` — permit contact areas for owner/admin/editor/marketer roles.

### New admin files

- `admin-ui/src/pages/ContactCenterPage.tsx` — card/action management and preview.

### Existing admin files

- `admin-ui/src/lib/api.ts` — typed contact models and methods.
- `admin-ui/src/App.tsx` — lazy route.
- `admin-ui/src/components/Sidebar.tsx` — System/Content navigation item and role visibility.
- `admin-ui/src/lib/i18n.tsx` — RU/KK/EN labels.
- `admin-ui/src/index.css` — responsive editor and preview styles.

### New Flutter files

- `BulkaAndroid/lib/models/contact_center_models.dart` — public projection and notification destination models.
- `BulkaAndroid/lib/core/contact_center_cache.dart` — versioned SharedPreferences cache and safe URI builder.
- `BulkaAndroid/test/contact_center_models_test.dart` — parsing, localization, cache, and URI tests.
- `BulkaAndroid/test/contact_center_screen_test.dart` — guest/auth tabs, empty state, cards, and destination tests.
- `BulkaAndroid/assets/contact_center/bulka_envelope.png` — generated transparent empty-state illustration.

### Existing Flutter files

- `BulkaAndroid/lib/main.dart` — register new part files.
- `BulkaAndroid/lib/api/bulka_api_client.dart` — public contacts call.
- `BulkaAndroid/lib/models/models.dart` — add defensive `payload` to `AppNotification` only.
- `BulkaAndroid/lib/screens/notifications_screen.dart` — complete branded two-tab experience.
- `BulkaAndroid/lib/screens/home_screen.dart` — open center for guests and pass shell callbacks.
- `BulkaAndroid/lib/shell/main_shell.dart` — Orders/Promotions destination callbacks.
- `BulkaAndroid/lib/core/localization.dart` — RU/KK/EN contact-center copy.
- `BulkaAndroid/pubspec.yaml` — declare generated asset directory.

---

### Task 1: Contact schema and pure validation boundary

**Files:**
- Create: `test/contact-center.test.js`
- Create: `src/services/contact-center.service.js`
- Create: `migrations/021_contact_center.sql`
- Create: `supabase/migrations/20260718120000_contact_center.sql`
- Modify: `supabase_schema.sql`

**Interfaces:**
- Produces: `normalizeContactCard(input, { partial = false })`, `normalizeContactAction(input, { partial = false })`, `projectPublicCards(rows)`, `isMissingContactSchema(error)`.
- Consumes: existing `supabase` client from `src/config/supabase.js`.

- [ ] **Step 1: Write failing validation and migration contract tests**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  normalizeContactAction,
  normalizeContactCard,
  projectPublicCards,
} = require('../src/services/contact-center.service');

const trilingual = (ru, kk = ru, en = ru) => ({ ru, kk, en });

test('contact cards require complete translations and known display modes', () => {
  assert.deepEqual(
    normalizeContactCard({
      displayMode: 'standard',
      titles: trilingual('Bulka'),
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
    () => normalizeContactCard({ displayMode: 'banner', titles: trilingual('Bulka') }),
    /display mode/i,
  );
  assert.throws(
    () => normalizeContactCard({ displayMode: 'standard', titles: { ru: 'Bulka' } }),
    /three languages/i,
  );
});

test('contact actions normalize phones and reject unsafe web targets', () => {
  assert.equal(
    normalizeContactAction({
      type: 'phone',
      labels: trilingual('Позвонить', 'Қоңырау шалу', 'Call'),
      target: '8 (700) 000-00-00',
    }).target,
    '+77000000000',
  );
  assert.throws(
    () => normalizeContactAction({
      type: 'website',
      labels: trilingual('Сайт'),
      target: 'javascript:alert(1)',
    }),
    /HTTPS/i,
  );
  assert.throws(
    () => normalizeContactAction({
      type: 'email',
      labels: trilingual('Email'),
      target: 'not-an-email',
    }),
    /email/i,
  );
});

test('contact migration mirrors Supabase and protects both tables', () => {
  const primary = fs.readFileSync(path.join(__dirname, '..', 'migrations', '021_contact_center.sql'), 'utf8');
  const mirrored = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260718120000_contact_center.sql'),
    'utf8',
  );
  assert.equal(primary, mirrored);
  assert.match(primary, /create table if not exists public\.contact_cards/i);
  assert.match(primary, /create table if not exists public\.contact_actions/i);
  assert.match(primary, /on delete cascade/i);
  assert.match(primary, /service_role_all_contact_cards/i);
  assert.match(primary, /service_role_all_contact_actions/i);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/contact-center.test.js`

Expected: FAIL because `src/services/contact-center.service.js` and the migration files do not exist.

- [ ] **Step 3: Create the additive migration and schema mirror**

Use this schema in both migration files and append the equivalent idempotent block to `supabase_schema.sql`:

```sql
create table if not exists public.contact_cards (
  id uuid primary key default gen_random_uuid(),
  display_mode text not null default 'standard' check (display_mode in ('standard', 'compact')),
  title_ru varchar(120) not null,
  title_kk varchar(120) not null,
  title_en varchar(120) not null,
  icon_key varchar(40) not null default 'bulka',
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contact_actions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.contact_cards(id) on delete cascade,
  action_type text not null check (action_type in ('phone','whatsapp','telegram','instagram','vk','email','website','online_chat','custom_url')),
  label_ru varchar(80) not null,
  label_kk varchar(80) not null,
  label_en varchar(80) not null,
  target varchar(500) not null,
  icon_key varchar(40) not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contact_cards_public_order_idx
  on public.contact_cards(is_active, sort_order, created_at);
create index if not exists contact_actions_card_order_idx
  on public.contact_actions(card_id, is_active, sort_order, created_at);

alter table public.contact_cards enable row level security;
alter table public.contact_actions enable row level security;
drop policy if exists service_role_all_contact_cards on public.contact_cards;
drop policy if exists service_role_all_contact_actions on public.contact_actions;
create policy service_role_all_contact_cards on public.contact_cards
  for all to service_role using (true) with check (true);
create policy service_role_all_contact_actions on public.contact_actions
  for all to service_role using (true) with check (true);

drop trigger if exists contact_cards_set_updated_at on public.contact_cards;
create trigger contact_cards_set_updated_at before update on public.contact_cards
for each row execute function public.set_updated_at();
drop trigger if exists contact_actions_set_updated_at on public.contact_actions;
create trigger contact_actions_set_updated_at before update on public.contact_actions
for each row execute function public.set_updated_at();
```

- [ ] **Step 4: Implement the pure normalization and projection functions**

```js
const { supabase } = require('../config/supabase');

const DISPLAY_MODES = new Set(['standard', 'compact']);
const ACTION_TYPES = new Set([
  'phone', 'whatsapp', 'telegram', 'instagram', 'vk',
  'email', 'website', 'online_chat', 'custom_url',
]);
const ICON_KEYS = new Set([
  'bulka', 'phone', 'whatsapp', 'telegram', 'instagram', 'vk',
  'email', 'website', 'chat', 'link',
]);
const DEFAULT_ACTION_ICON = {
  phone: 'phone', whatsapp: 'whatsapp', telegram: 'telegram', instagram: 'instagram',
  vk: 'vk', email: 'email', website: 'website', online_chat: 'chat', custom_url: 'link',
};

function contactError(message, statusCode = 400, code = 'CONTACT_VALIDATION_ERROR') {
  return Object.assign(new Error(message), { statusCode, code });
}

function localized(input, field, maxLength) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const value = {};
  for (const code of ['ru', 'kk', 'en']) {
    const text = String(source[code] || '').trim();
    if (!text || text.length > maxLength) {
      throw contactError(`${field} must contain three languages within ${maxLength} characters`);
    }
    value[code] = text;
  }
  return value;
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const normalized = digits.length === 11 && digits.startsWith('8') ? `7${digits.slice(1)}` : digits;
  if (normalized.length < 10 || normalized.length > 15) throw contactError('Invalid phone target');
  return `+${normalized}`;
}

function normalizeTarget(type, raw) {
  const target = String(raw || '').trim();
  if (type === 'phone') return normalizePhone(target);
  if (type === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target) || target.length > 254) {
      throw contactError('Invalid email target');
    }
    return target.toLowerCase();
  }
  let url;
  try { url = new URL(target); } catch { throw contactError('Target must be an HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || /[\u0000-\u001f\u007f]/.test(target)) {
    throw contactError('Target must be a safe HTTPS URL');
  }
  return url.toString();
}

function normalizeContactCard(input, { partial = false } = {}) {
  const result = {};
  if (!partial || input.displayMode !== undefined) {
    const mode = String(input.displayMode || 'standard');
    if (!DISPLAY_MODES.has(mode)) throw contactError('Unknown contact display mode');
    result.display_mode = mode;
  }
  if (!partial || input.titles !== undefined) {
    const titles = localized(input.titles, 'Card title', 120);
    result.title_ru = titles.ru; result.title_kk = titles.kk; result.title_en = titles.en;
  }
  if (!partial || input.iconKey !== undefined) {
    const icon = String(input.iconKey || 'bulka');
    if (!ICON_KEYS.has(icon)) throw contactError('Unknown contact icon');
    result.icon_key = icon;
  }
  if (!partial || input.isActive !== undefined) result.is_active = input.isActive === true;
  if (!partial || input.sortOrder !== undefined) {
    const order = Number(input.sortOrder || 0);
    if (!Number.isInteger(order) || order < 0) throw contactError('Invalid contact sort order');
    result.sort_order = order;
  }
  return result;
}

function normalizeContactAction(input, { partial = false } = {}) {
  const result = {};
  const type = String(input.type || '');
  if (!partial || input.type !== undefined) {
    if (!ACTION_TYPES.has(type)) throw contactError('Unknown contact action type');
    result.action_type = type;
  }
  if (!partial || input.labels !== undefined) {
    const labels = localized(input.labels, 'Action label', 80);
    result.label_ru = labels.ru; result.label_kk = labels.kk; result.label_en = labels.en;
  }
  if (!partial || input.target !== undefined) result.target = normalizeTarget(type, input.target);
  if (!partial || input.iconKey !== undefined) {
    const icon = String(input.iconKey || DEFAULT_ACTION_ICON[type] || 'link');
    if (!ICON_KEYS.has(icon)) throw contactError('Unknown contact icon');
    result.icon_key = icon;
  }
  if (!partial || input.isActive !== undefined) result.is_active = input.isActive !== false;
  if (!partial || input.sortOrder !== undefined) {
    const order = Number(input.sortOrder || 0);
    if (!Number.isInteger(order) || order < 0) throw contactError('Invalid contact sort order');
    result.sort_order = order;
  }
  return result;
}

function projectPublicCards(rows = []) {
  return rows.map((row) => ({
    id: String(row.id),
    displayMode: row.display_mode,
    titles: { ru: row.title_ru, kk: row.title_kk, en: row.title_en },
    iconKey: row.icon_key,
    actions: (row.contact_actions || []).map((action) => ({
      id: String(action.id), type: action.action_type,
      labels: { ru: action.label_ru, kk: action.label_kk, en: action.label_en },
      target: action.target, iconKey: action.icon_key,
    })),
  }));
}

const isMissingContactSchema = (error) => ['42P01', 'PGRST205'].includes(String(error?.code || ''));

module.exports = {
  ACTION_TYPES, ICON_KEYS, isMissingContactSchema, normalizeContactAction,
  normalizeContactCard, projectPublicCards, supabase,
};
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `node --test test/contact-center.test.js`

Expected: PASS for normalization, safety, and mirrored migration tests.

- [ ] **Step 6: Commit only new, isolated Task 1 files when safe**

```powershell
git diff -- migrations/021_contact_center.sql supabase/migrations/20260718120000_contact_center.sql src/services/contact-center.service.js test/contact-center.test.js supabase_schema.sql
git add -- migrations/021_contact_center.sql supabase/migrations/20260718120000_contact_center.sql src/services/contact-center.service.js test/contact-center.test.js
git diff --cached --name-only
git commit -m "feat: add contact center data model"
```

Leave `supabase_schema.sql` unstaged if it already contains unrelated user changes.

---

### Task 2: Contact persistence, APIs, roles, and notification payloads

**Files:**
- Modify: `src/services/contact-center.service.js`
- Modify: `src/routes/public.routes.js`
- Modify: `src/routes/admin.routes.js`
- Modify: `src/routes/legacy.routes.js`
- Modify: `src/middlewares/auth.middleware.js`
- Modify: `test/contact-center.test.js`

**Interfaces:**
- Consumes: Task 1 normalizers and projection.
- Produces: `listPublicContactCards()`, `listAdminContactCards()`, `createContactCard()`, `updateContactCard()`, `deleteContactCard()`, `reorderContactCards()`, `createContactAction()`, `updateContactAction()`, `deleteContactAction()`, `reorderContactActions()`.
- Produces HTTP contracts documented in the design spec.

- [ ] **Step 1: Extend the failing tests for projection, compact publication, and API source contracts**

```js
test('public projection excludes inactive records and preserves deterministic order', () => {
  const projected = projectPublicCards([
    {
      id: 'card-1', display_mode: 'standard', title_ru: 'Bulka', title_kk: 'Bulka',
      title_en: 'Bulka', icon_key: 'bulka',
      contact_actions: [{
        id: 'action-1', action_type: 'phone', label_ru: 'Телефон', label_kk: 'Телефон',
        label_en: 'Phone', target: '+77000000000', icon_key: 'phone',
      }],
    },
  ]);
  assert.equal(projected[0].actions[0].target, '+77000000000');
  assert.deepEqual(projected[0].titles, { ru: 'Bulka', kk: 'Bulka', en: 'Bulka' });
});

test('backend exposes public contacts, admin CRUD and notification payload', () => {
  const publicRoutes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'public.routes.js'), 'utf8');
  const adminRoutes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.routes.js'), 'utf8');
  const legacyRoutes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'legacy.routes.js'), 'utf8');
  assert.match(publicRoutes, /\/api\/public\/contact-center/);
  assert.match(adminRoutes, /\/admin\/api\/contact-cards/);
  assert.match(adminRoutes, /\/admin\/api\/contact-actions/);
  assert.match(legacyRoutes, /select\('id,title,body,type,payload,is_read,created_at'\)/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test test/contact-center.test.js`

Expected: FAIL because routes and persistence methods are absent.

- [ ] **Step 3: Add persistence functions to the service**

Implement each exported method with an optional `{ db = supabase }` argument for isolated tests. Use nested selects for reads, single-statement `upsert` arrays for reorder, and these rules:

```js
const CARD_SELECT = `
  id,display_mode,title_ru,title_kk,title_en,icon_key,sort_order,is_active,created_at,updated_at,
  contact_actions(id,card_id,action_type,label_ru,label_kk,label_en,target,icon_key,sort_order,is_active,created_at,updated_at)
`;

async function listPublicContactCards({ db = supabase } = {}) {
  const { data, error } = await db.from('contact_cards').select(CARD_SELECT)
    .eq('is_active', true).order('sort_order').order('created_at');
  if (error) {
    if (isMissingContactSchema(error)) return { cards: [], updatedAt: null };
    throw error;
  }
  const rows = (data || []).map((card) => ({
    ...card,
    contact_actions: (card.contact_actions || [])
      .filter((action) => action.is_active !== false)
      .sort((a, b) => a.sort_order - b.sort_order || String(a.created_at).localeCompare(String(b.created_at))),
  }));
  const updatedAt = rows.flatMap((card) => [card.updated_at, ...card.contact_actions.map((a) => a.updated_at)])
    .filter(Boolean).sort().at(-1) || null;
  return { cards: projectPublicCards(rows), updatedAt };
}

async function assertCompactPublishable(cardId, requestedActive, { db = supabase } = {}) {
  if (!requestedActive) return;
  const { data: card, error: cardError } = await db.from('contact_cards')
    .select('display_mode').eq('id', cardId).single();
  if (cardError) throw cardError;
  if (card.display_mode !== 'compact') return;
  const { count, error } = await db.from('contact_actions').select('id', { count: 'exact', head: true })
    .eq('card_id', cardId).eq('is_active', true);
  if (error) throw error;
  if (count !== 1) throw contactError('Compact cards require exactly one active action');
}
```

For create/update/delete methods, return admin-projected camelCase records. For reorder, first compare the supplied unique ID set with the database IDs in scope, then upsert `[{ id, sort_order }]`. Reject missing, duplicated, or foreign IDs with status 400.

- [ ] **Step 4: Register the public and admin endpoints**

Add the public import and handler:

```js
const contactCenter = require('../services/contact-center.service');

router.get('/api/public/contact-center', async (_req, res) => {
  try {
    const result = await contactCenter.listPublicContactCards();
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
```

Add admin handlers using one response convention:

```js
const sendContactError = (res, error) => res.status(error.statusCode || 500).json({
  success: false,
  error: error.message,
  ...(error.code && { code: error.code }),
});

router.get('/admin/api/contact-cards', async (_req, res) => {
  try { res.json({ success: true, cards: await contactCenter.listAdminContactCards() }); }
  catch (error) { sendContactError(res, error); }
});
router.post('/admin/api/contact-cards', async (req, res) => {
  try { res.status(201).json({ success: true, card: await contactCenter.createContactCard(req.body) }); }
  catch (error) { sendContactError(res, error); }
});
router.put('/admin/api/contact-cards/reorder', async (req, res) => {
  try { res.json({ success: true, cards: await contactCenter.reorderContactCards(req.body?.ids) }); }
  catch (error) { sendContactError(res, error); }
});
router.put('/admin/api/contact-cards/:id', async (req, res) => {
  try { res.json({ success: true, card: await contactCenter.updateContactCard(req.params.id, req.body) }); }
  catch (error) { sendContactError(res, error); }
});
router.delete('/admin/api/contact-cards/:id', async (req, res) => {
  try { await contactCenter.deleteContactCard(req.params.id); res.json({ success: true }); }
  catch (error) { sendContactError(res, error); }
});
router.post('/admin/api/contact-cards/:cardId/actions', async (req, res) => {
  try { res.status(201).json({ success: true, action: await contactCenter.createContactAction(req.params.cardId, req.body) }); }
  catch (error) { sendContactError(res, error); }
});
router.put('/admin/api/contact-cards/:cardId/actions/reorder', async (req, res) => {
  try { res.json({ success: true, actions: await contactCenter.reorderContactActions(req.params.cardId, req.body?.ids) }); }
  catch (error) { sendContactError(res, error); }
});
router.put('/admin/api/contact-actions/:id', async (req, res) => {
  try { res.json({ success: true, action: await contactCenter.updateContactAction(req.params.id, req.body) }); }
  catch (error) { sendContactError(res, error); }
});
router.delete('/admin/api/contact-actions/:id', async (req, res) => {
  try { await contactCenter.deleteContactAction(req.params.id); res.json({ success: true }); }
  catch (error) { sendContactError(res, error); }
});
```

- [ ] **Step 5: Extend notification payload selection and role areas**

Change the notification select to:

```js
.select('id,title,body,type,payload,is_read,created_at')
```

Add both `contact-cards` and `contact-actions` to marketer and editor `ROLE_AREAS`. Owner/admin already use `*`; other roles remain excluded.

- [ ] **Step 6: Run backend verification**

Run: `node --test test/contact-center.test.js`

Expected: PASS.

Run: `npm test`

Expected: all backend tests PASS.

- [ ] **Step 7: Commit only attributable backend changes when safe**

```powershell
git diff -- src/services/contact-center.service.js src/routes/public.routes.js src/routes/admin.routes.js src/routes/legacy.routes.js src/middlewares/auth.middleware.js test/contact-center.test.js
git add -- src/services/contact-center.service.js test/contact-center.test.js
git diff --cached --name-only
git commit -m "feat: expose managed contact center APIs"
```

Keep overlapping route and middleware files unstaged unless their entire staged diff is attributable to this task.

---

### Task 3: Typed React admin contact editor

**Files:**
- Create: `admin-ui/src/pages/ContactCenterPage.tsx`
- Modify: `admin-ui/src/lib/api.ts`
- Modify: `admin-ui/src/App.tsx`
- Modify: `admin-ui/src/components/Sidebar.tsx`
- Modify: `admin-ui/src/lib/i18n.tsx`
- Modify: `admin-ui/src/index.css`
- Modify: `test/contact-center.test.js`

**Interfaces:**
- Consumes: Task 2 admin endpoints.
- Produces: typed `ContactCard`, `ContactAction`, input types, `api.getContactCards`, card/action CRUD and reorder methods, route `/contacts`.

- [ ] **Step 1: Add a failing admin source contract test**

```js
test('admin UI registers a typed contact editor', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', 'admin-ui', 'src', 'lib', 'api.ts'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'admin-ui', 'src', 'App.tsx'), 'utf8');
  const sidebar = fs.readFileSync(path.join(__dirname, '..', 'admin-ui', 'src', 'components', 'Sidebar.tsx'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '..', 'admin-ui', 'src', 'pages', 'ContactCenterPage.tsx'), 'utf8');
  assert.match(api, /export interface ContactCard/);
  assert.match(api, /getContactCards/);
  assert.match(api, /reorderContactActions/);
  assert.match(app, /path="\/contacts"/);
  assert.match(sidebar, /nav\.contacts/);
  assert.match(page, /contact-center-preview/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/contact-center.test.js`

Expected: FAIL because the admin page and API methods are absent.

- [ ] **Step 3: Add exact admin API types and methods**

```ts
export type ContactDisplayMode = 'standard' | 'compact';
export type ContactActionType =
  | 'phone' | 'whatsapp' | 'telegram' | 'instagram' | 'vk'
  | 'email' | 'website' | 'online_chat' | 'custom_url';

export interface ContactAction {
  id: string;
  cardId: string;
  type: ContactActionType;
  labels: LocalizedText;
  target: string;
  iconKey: string;
  sortOrder: number;
  isActive: boolean;
}

export interface ContactCard {
  id: string;
  displayMode: ContactDisplayMode;
  titles: LocalizedText;
  iconKey: string;
  sortOrder: number;
  isActive: boolean;
  actions: ContactAction[];
}

export type ContactCardInput = Omit<ContactCard, 'id' | 'actions'>;
export type ContactActionInput = Omit<ContactAction, 'id' | 'cardId'>;
```

Add methods whose URLs exactly match Task 2. Reorder bodies are `{ ids: string[] }`; mutation responses return the normalized record arrays.

- [ ] **Step 4: Implement the dedicated Contacts page**

Build the page with the existing `Modal`, `PageState`, `useFeedback`, and `useI18n` utilities. Use these stable state shapes:

```ts
const blankText = (): LocalizedText => ({ ru: '', kk: '', en: '' });
const blankCard = (): ContactCardInput => ({
  displayMode: 'standard', titles: blankText(), iconKey: 'bulka', sortOrder: 0, isActive: false,
});
const blankAction = (): ContactActionInput => ({
  type: 'phone', labels: blankText(), target: '', iconKey: 'phone', sortOrder: 0, isActive: true,
});

const actionTypes: Array<{ value: ContactActionType; icon: string }> = [
  { value: 'phone', icon: 'phone' }, { value: 'whatsapp', icon: 'whatsapp' },
  { value: 'telegram', icon: 'telegram' }, { value: 'instagram', icon: 'instagram' },
  { value: 'vk', icon: 'vk' }, { value: 'email', icon: 'email' },
  { value: 'website', icon: 'website' }, { value: 'online_chat', icon: 'chat' },
  { value: 'custom_url', icon: 'link' },
];
```

The rendered page must include:

```tsx
<div className="page-stack contact-center-admin">
  <div className="page-actions-row justify-end">
    <button type="button" className="btn-classic" onClick={() => openCard()}>{t('contacts.addCard')}</button>
  </div>
  <section className="contact-center-layout">
    <div className="contact-card-list" aria-label={t('contacts.cards')}>
      {cards.map((card, index) => (
        <article className="card contact-admin-card" key={card.id}>
          <div className="contact-admin-card-heading">
            <div><strong>{card.titles[locale]}</strong><span>{t(`contacts.mode.${card.displayMode}`)}</span></div>
            <span className={card.isActive ? 'status-pill status-success' : 'status-pill'}>
              {card.isActive ? t('common.active') : t('common.inactive')}
            </span>
          </div>
          <div className="contact-admin-actions">
            <button type="button" className="icon-button" disabled={index === 0} onClick={() => moveCard(index, -1)} aria-label={t('common.moveUp')}>↑</button>
            <button type="button" className="icon-button" disabled={index === cards.length - 1} onClick={() => moveCard(index, 1)} aria-label={t('common.moveDown')}>↓</button>
            <button type="button" className="btn-outline" onClick={() => selectCard(card)}>{t('contacts.manageActions')}</button>
            <button type="button" className="icon-button" onClick={() => openCard(card)} aria-label={t('common.edit')}>✎</button>
            <button type="button" className="icon-button icon-button-danger" onClick={() => removeCard(card)} aria-label={t('common.delete')}>×</button>
          </div>
        </article>
      ))}
    </div>
    <aside className="card contact-center-preview" aria-label={t('common.preview')}>
      <ContactPreview card={selectedCard ?? cards[0] ?? null} locale={locale} />
    </aside>
  </section>
</div>
```

Use Lucide icons in the actual JSX instead of the textual arrows/pencil/cross shown in the structural snippet. Each modal renders three explicit language fields. Action save validates all labels and target before calling the API. Duplicate creates an inactive copy, then recreates its actions in order. Delete uses the shared destructive confirmation dialog. Reordering updates local state, calls the API, and rolls back on failure.

- [ ] **Step 5: Register navigation, permissions, and translations**

Add `ContactCenterPage` lazy import and `<Route path="/contacts" ...>`. Add a `ContactRound` Lucide sidebar item under Content or System. Add `/contacts` to marketer and editor visible paths; owner/admin remain unrestricted.

Add these key families in RU/KK/EN: `nav.contacts`, `contacts.heading`, `contacts.intro`, `contacts.addCard`, `contacts.editCard`, `contacts.cards`, `contacts.manageActions`, `contacts.addAction`, `contacts.empty`, `contacts.emptyHint`, `contacts.mode.standard`, `contacts.mode.compact`, `contacts.target`, `contacts.actionType`, `contacts.deleteCardTitle`, `contacts.deleteCardBody`, `contacts.deleteActionTitle`, `contacts.deleteActionBody`, `contacts.saved`, `contacts.reordered`, plus `common.moveUp`, `common.moveDown`, `common.active`, `common.inactive` if absent.

- [ ] **Step 6: Add responsive styles**

```css
.contact-center-layout { display:grid; grid-template-columns:minmax(0,1fr) minmax(280px,360px); gap:24px; align-items:start; }
.contact-card-list { display:grid; gap:14px; }
.contact-admin-card { padding:18px; display:grid; gap:14px; }
.contact-admin-card-heading,.contact-admin-actions { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.contact-admin-card-heading div { display:grid; gap:4px; }
.contact-admin-card-heading span { color:var(--text-muted); font-size:.875rem; }
.contact-center-preview { position:sticky; top:92px; padding:20px; background:#fffaf1; }
.contact-preview-standard { border:1px solid #eadbbe; border-radius:24px; padding:20px; background:#fff; }
.contact-preview-actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:16px; }
.contact-preview-action { border-radius:16px; padding:10px 14px; background:#fff3cf; color:#532814; }
.localized-field-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
@media (max-width:900px) { .contact-center-layout { grid-template-columns:1fr; } .contact-center-preview { position:static; } }
@media (max-width:640px) { .localized-field-grid { grid-template-columns:1fr; } }
```

- [ ] **Step 7: Verify admin behavior**

Run: `node --test test/contact-center.test.js`

Expected: PASS.

Run: `npm --prefix admin-ui run lint`

Expected: TypeScript check PASS.

Run: `npm --prefix admin-ui run build`

Expected: production Vite build PASS.

- [ ] **Step 8: Commit new admin page separately when safe**

```powershell
git diff -- admin-ui/src/pages/ContactCenterPage.tsx admin-ui/src/lib/api.ts admin-ui/src/App.tsx admin-ui/src/components/Sidebar.tsx admin-ui/src/lib/i18n.tsx admin-ui/src/index.css
git add -- admin-ui/src/pages/ContactCenterPage.tsx
git diff --cached --name-only
git commit -m "feat: add admin contact center editor"
```

Keep all overlapping existing admin files unstaged unless the staged hunks contain only this feature.

---

### Task 4: Flutter contact models, cache, API, and safe launcher

**Files:**
- Create: `BulkaAndroid/lib/models/contact_center_models.dart`
- Create: `BulkaAndroid/lib/core/contact_center_cache.dart`
- Create: `BulkaAndroid/test/contact_center_models_test.dart`
- Modify: `BulkaAndroid/lib/main.dart`
- Modify: `BulkaAndroid/lib/api/bulka_api_client.dart`
- Modify: `BulkaAndroid/lib/models/models.dart`

**Interfaces:**
- Produces: `ContactCenterPayload`, `ContactCard`, `ContactAction`, `ContactActionType`, `ContactCenterCache`, `contactActionUri(ContactAction)`, `NotificationDestination resolveNotificationDestination(AppNotification)`.
- Produces: `BulkaApiClient.getContactCenter()`.

- [ ] **Step 1: Write failing Dart model/cache/URI tests**

```dart
import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({});
  });

  test('contacts localize offline and serialize through cache', () async {
    final payload = ContactCenterPayload.fromJson({
      'updatedAt': '2026-07-18T12:00:00Z',
      'cards': [{
        'id': 'card-1', 'displayMode': 'standard', 'iconKey': 'bulka',
        'titles': {'ru': 'Булка', 'kk': 'Бөлке', 'en': 'Bulka'},
        'actions': [{
          'id': 'action-1', 'type': 'phone', 'iconKey': 'phone', 'target': '+77000000000',
          'labels': {'ru': 'Телефон', 'kk': 'Телефон', 'en': 'Phone'},
        }],
      }],
    });
    expect(payload.cards.single.titleFor('en'), 'Bulka');
    await ContactCenterCache.write(payload);
    expect((await ContactCenterCache.read())?.cards.single.actions.single.target, '+77000000000');
  });

  test('contact action URIs use only tel, mailto and safe https', () {
    expect(contactActionUri(const ContactAction(
      id: '1', type: ContactActionType.phone, labels: {'ru':'Телефон','kk':'Телефон','en':'Phone'},
      target: '+77000000000', iconKey: 'phone',
    )).toString(), 'tel:+77000000000');
    expect(contactActionUri(const ContactAction(
      id: '2', type: ContactActionType.email, labels: {'ru':'Email','kk':'Email','en':'Email'},
      target: 'hello@bulka.kz', iconKey: 'email',
    )).toString(), 'mailto:hello@bulka.kz');
    expect(contactActionUri(const ContactAction(
      id: '3', type: ContactActionType.website, labels: {'ru':'Сайт','kk':'Сайт','en':'Site'},
      target: 'javascript:alert(1)', iconKey: 'website',
    )), isNull);
  });

  test('notification payload resolves app destinations defensively', () {
    final order = AppNotification.fromJson({
      'id':'n1','title':'Заказ готов','body':'Заберите заказ','type':'order',
      'created_at':'2026-07-18T12:00:00Z','payload':{'orderId':'order-1'},
    });
    expect(resolveNotificationDestination(order).kind, NotificationDestinationKind.orders);
    final unsafe = AppNotification.fromJson({
      'id':'n2','title':'Link','body':'Body','type':'broadcast','created_at':'','payload':{'url':'javascript:alert(1)'},
    });
    expect(resolveNotificationDestination(unsafe).kind, NotificationDestinationKind.none);
  });
}
```

- [ ] **Step 2: Run focused Flutter tests and verify RED**

Run from `BulkaAndroid`: `flutter test test/contact_center_models_test.dart`

Expected: compile FAIL because contact-center types do not exist.

- [ ] **Step 3: Implement focused model types**

Create a `part of '../main.dart';` file with immutable models. Parse unknown types as `customUrl`, discard malformed card/action maps, preserve all translations, and expose `titleFor`/`labelFor` with RU → KK → EN fallback. Use these exact public declarations:

```dart
enum ContactDisplayMode { standard, compact }
enum ContactActionType { phone, whatsapp, telegram, instagram, vk, email, website, onlineChat, customUrl }

class ContactAction {
  const ContactAction({required this.id, required this.type, required this.labels, required this.target, required this.iconKey});
  final String id;
  final ContactActionType type;
  final Map<String, String> labels;
  final String target;
  final String iconKey;
  String labelFor(String language) => labels[language] ?? labels['ru'] ?? labels['kk'] ?? labels['en'] ?? '';
  factory ContactAction.fromJson(Map<String, dynamic> json);
  Map<String, dynamic> toJson();
}

class ContactCard {
  const ContactCard({required this.id, required this.displayMode, required this.titles, required this.iconKey, required this.actions});
  final String id;
  final ContactDisplayMode displayMode;
  final Map<String, String> titles;
  final String iconKey;
  final List<ContactAction> actions;
  String titleFor(String language) => titles[language] ?? titles['ru'] ?? titles['kk'] ?? titles['en'] ?? '';
  factory ContactCard.fromJson(Map<String, dynamic> json);
  Map<String, dynamic> toJson();
}

class ContactCenterPayload {
  const ContactCenterPayload({required this.cards, this.updatedAt});
  final List<ContactCard> cards;
  final String? updatedAt;
  factory ContactCenterPayload.fromJson(Map<String, dynamic> json);
  Map<String, dynamic> toJson();
}
```

Add `payload` to `AppNotification`, parsing only `Map` values through `_asMap`.

- [ ] **Step 4: Implement versioned cache, URI safety, and destination resolver**

```dart
const _contactCenterCacheKey = 'contact_center_cache_v1';

abstract final class ContactCenterCache {
  static Future<ContactCenterPayload?> read() async {
    final raw = (await SharedPreferences.getInstance()).getString(_contactCenterCacheKey);
    if (raw == null) return null;
    try { return ContactCenterPayload.fromJson(_asMap(jsonDecode(raw))); } catch (_) { return null; }
  }
  static Future<void> write(ContactCenterPayload payload) async {
    await (await SharedPreferences.getInstance()).setString(_contactCenterCacheKey, jsonEncode(payload.toJson()));
  }
}

Uri? contactActionUri(ContactAction action) {
  if (action.type == ContactActionType.phone) return Uri(scheme: 'tel', path: action.target);
  if (action.type == ContactActionType.email) return Uri(scheme: 'mailto', path: action.target);
  final uri = Uri.tryParse(action.target);
  if (uri == null || uri.scheme != 'https' || uri.userInfo.isNotEmpty || uri.host.isEmpty) return null;
  return uri;
}

enum NotificationDestinationKind { none, orders, promotions, support, external }
class NotificationDestination {
  const NotificationDestination(this.kind, {this.uri});
  final NotificationDestinationKind kind;
  final Uri? uri;
}
```

Resolve order/delivery/refund with `orderId`, promotion types, support types, then validated HTTPS payload `url`; otherwise return `none`.

- [ ] **Step 5: Add the public API method and part registrations**

```dart
Future<ContactCenterPayload> getContactCenter() async {
  final json = await _get('/api/public/contact-center');
  if (json['success'] != true || json['cards'] is! List) {
    throw ApiException(_messageFrom(json, 'error_network'.tr));
  }
  return ContactCenterPayload.fromJson(json);
}
```

Register `part 'core/contact_center_cache.dart';` and `part 'models/contact_center_models.dart';` in `main.dart`.

- [ ] **Step 6: Verify GREEN and regression tests**

Run from `BulkaAndroid`: `flutter test test/contact_center_models_test.dart`

Expected: PASS.

Run: `flutter analyze`

Expected: no new analyzer errors.

- [ ] **Step 7: Commit new Flutter foundation files when safe**

```powershell
git diff -- BulkaAndroid/lib/models/contact_center_models.dart BulkaAndroid/lib/core/contact_center_cache.dart BulkaAndroid/test/contact_center_models_test.dart BulkaAndroid/lib/main.dart BulkaAndroid/lib/api/bulka_api_client.dart BulkaAndroid/lib/models/models.dart
git add -- BulkaAndroid/lib/models/contact_center_models.dart BulkaAndroid/lib/core/contact_center_cache.dart BulkaAndroid/test/contact_center_models_test.dart
git diff --cached --name-only
git commit -m "feat: add Flutter contact center models"
```

---

### Task 5: Branded Flutter screen, guest entry, and payload navigation

**Files:**
- Create: `BulkaAndroid/test/contact_center_screen_test.dart`
- Create: `BulkaAndroid/assets/contact_center/bulka_envelope.png`
- Modify: `BulkaAndroid/lib/screens/notifications_screen.dart`
- Modify: `BulkaAndroid/lib/screens/home_screen.dart`
- Modify: `BulkaAndroid/lib/shell/main_shell.dart`
- Modify: `BulkaAndroid/lib/core/localization.dart`
- Modify: `BulkaAndroid/pubspec.yaml`

**Interfaces:**
- Consumes: Task 4 models/cache/launcher/destination resolver.
- Produces: `NotificationsScreen(api, onRequireAuth, onOpenOrders, onOpenPromotions, launchUri)`.

- [ ] **Step 1: Write failing guest/auth/empty/contact widget tests**

Create a `FakeContactApi extends BulkaApiClient` overriding `getContactCenter`, `getNotifications`, and mark-read methods. Cover these assertions:

```dart
testWidgets('guest opens public Contacts and authentication gates Notifications', (tester) async {
  var authRequests = 0;
  final api = FakeContactApi(contactPayload: sampleContacts, notifications: const []);
  await tester.pumpWidget(testApp(NotificationsScreen(
    api: api,
    onRequireAuth: () async { authRequests++; api.setAccessToken('token'); return true; },
    onOpenOrders: () {},
    onOpenPromotions: () {},
  )));
  await tester.pumpAndSettle();
  expect(find.text('Контакты'), findsWidgets);
  expect(find.text('Bulka'), findsOneWidget);
  await tester.tap(find.byKey(const ValueKey('notification-center-tab-notifications')));
  await tester.pumpAndSettle();
  expect(authRequests, 1);
  expect(find.text('У вас нет новых уведомлений'), findsOneWidget);
  expect(find.byKey(const ValueKey('notification-empty-envelope')), findsOneWidget);
});

testWidgets('notification payload closes center and opens orders', (tester) async {
  var openedOrders = false;
  final api = FakeContactApi.authenticated(notifications: [orderNotification]);
  await tester.pumpWidget(testApp(NotificationsScreen(
    api: api, onRequireAuth: () async => true,
    onOpenOrders: () => openedOrders = true, onOpenPromotions: () {},
  )));
  await tester.pumpAndSettle();
  await tester.tap(find.text(orderNotification.title));
  await tester.pumpAndSettle();
  expect(openedOrders, isTrue);
  expect(api.readIds, contains(orderNotification.id));
});
```

Add a 320 px surface-size test that asserts no overflow exception and finds two compact-grid tiles. Add semantics assertions for both selected tabs and unread notification state.

- [ ] **Step 2: Run the focused screen test and verify RED**

Run from `BulkaAndroid`: `flutter test test/contact_center_screen_test.dart`

Expected: compile FAIL because the screen constructor and two-tab UI are not implemented.

- [ ] **Step 3: Generate the Bulka envelope asset**

Use the image-generation skill with both existing brand references:

- `BulkaAndroid/assets/brand/bulka_logo.png`
- `BulkaAndroid/assets/brand/app_icon_foreground.png`

Prompt requirements: isolated open envelope, soft premium 3D/clay material, Bulka gold/cream/brown only, circular wax seal with the `B` and bread mark, transparent background, centered, no text, no purple, no extra objects, readable at 220 logical pixels. Save the final transparent PNG as `BulkaAndroid/assets/contact_center/bulka_envelope.png` and inspect it at original resolution.

- [ ] **Step 4: Implement the two-tab state machine**

The state owns:

```dart
late int _tab = widget.api.isAuthenticated ? 0 : 1;
List<AppNotification> _notifications = const [];
ContactCenterPayload? _contacts;
bool _notificationsLoading = false;
bool _contactsLoading = true;
String? _notificationsError;
String? _contactsError;
```

On init, read contacts cache, refresh contacts, and load notifications only when authenticated. `_selectTab(0)` calls `onRequireAuth`; after success it loads notifications. Contact actions call the injected `Future<bool> Function(Uri)` defaulting to `launchUrl(uri, mode: LaunchMode.platformDefault)`.

Use a `Scaffold` with a custom SafeArea header and these stable widget keys:

- `notification-center-back`
- `notification-center-tab-notifications`
- `notification-center-tab-contacts`
- `notification-center-mark-all`
- `notification-empty-envelope`
- `contact-standard-<id>`
- `contact-compact-<id>`

Render the header segmented control with `AnimatedContainer`, 28 px outer radius, 22 px segments, existing Bulka motion, and no fixed text height. Render tab bodies through `AnimatedSwitcher`.

- [ ] **Step 5: Implement notification cards and navigation**

Keep Settings and Mark all read. Use one icon resolver:

```dart
IconData _notificationIcon(String type) => switch (type) {
  'order' || 'delivery' => Icons.shopping_bag_rounded,
  'bonus' => Icons.card_giftcard_rounded,
  'support' => Icons.support_agent_rounded,
  'refund' => Icons.currency_exchange_rounded,
  _ => Icons.notifications_active_rounded,
};
```

On tap, mark unread content locally first, await the API, resolve destination, then:

- Orders: pop the center and call `onOpenOrders`.
- Promotions: pop and call `onOpenPromotions`.
- Support: push `OrderSupportScreen(api: widget.api)`.
- External: call the safe launcher.
- None: remain on the screen.

Use warm cream cards, 24 px radius, Bulka borders, type icon, title/body/date, and an explicit unread dot plus semantics.

- [ ] **Step 6: Implement contact cards and adaptive grid**

Split active data by `ContactDisplayMode`. Standard cards use wrapping action chips. Compact cards use `SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 176, mainAxisExtent: 136, crossAxisSpacing: 12, mainAxisSpacing: 12)` so narrow phones show two columns and larger screens expand naturally. Cap the content width at 760 px.

Use vector Material glyphs resolved from `iconKey`; only the branded envelope and Bulka seal use raster assets. Every action has a `Semantics(button: true, label: ...)` wrapper and visible pressed feedback through `BulkaPressScale`.

- [ ] **Step 7: Wire guest entry and shell destinations**

Extend `HomeScreen` with:

```dart
final VoidCallback onOpenOrders;
final VoidCallback onOpenPromotions;
```

Remove the home-bell pre-auth guard. Pass callbacks into `NotificationsScreen`. In `MainShell`, provide `onOpenOrders: () => _changeTab(2)` and `onOpenPromotions: () => _changeTab(3)`.

- [ ] **Step 8: Add complete localization and asset declaration**

Add RU/KK/EN values for: tabs, additional section, empty notifications, empty contacts, retry, loading, launch failure, mark all, settings, contact accessibility labels, and guest sign-in prompt. Keep the corrected Russian copy exactly `У вас нет новых уведомлений`.

Add:

```yaml
assets:
  - assets/brand/
  - assets/order/
  - assets/contact_center/
```

- [ ] **Step 9: Verify focused and full Flutter tests**

Run from `BulkaAndroid`: `dart format lib test/contact_center_models_test.dart test/contact_center_screen_test.dart`

Run: `flutter test test/contact_center_models_test.dart test/contact_center_screen_test.dart`

Expected: PASS.

Run: `flutter analyze`

Expected: PASS with no new diagnostics.

Run: `flutter test`

Expected: all Flutter tests PASS.

- [ ] **Step 10: Commit only new screen test and artwork when safe**

```powershell
git diff -- BulkaAndroid/test/contact_center_screen_test.dart BulkaAndroid/assets/contact_center/bulka_envelope.png BulkaAndroid/lib/screens/notifications_screen.dart BulkaAndroid/lib/screens/home_screen.dart BulkaAndroid/lib/shell/main_shell.dart BulkaAndroid/lib/core/localization.dart BulkaAndroid/pubspec.yaml
git add -- BulkaAndroid/test/contact_center_screen_test.dart BulkaAndroid/assets/contact_center/bulka_envelope.png
git diff --cached --name-only
git commit -m "feat: add branded notification contact center"
```

Do not stage overlapping existing Flutter files if their diff includes pre-existing user work.

---

### Task 6: End-to-end verification and visual QA

**Files:**
- Modify if needed after evidence: only files listed in Tasks 1–5.
- Verify generated outputs without committing `admin-ui/dist/` or `public/app/` unless the repository’s release workflow explicitly requires them.

**Interfaces:**
- Consumes: complete backend/admin/Flutter feature.
- Produces: verified builds, screenshots, and a clean feature handoff that documents unrelated dirty files.

- [ ] **Step 1: Run backend and admin verification**

```powershell
npm run lint
npm test
npm --prefix admin-ui run lint
npm --prefix admin-ui run build
```

Expected: every command exits 0.

- [ ] **Step 2: Run Flutter verification**

```powershell
Set-Location BulkaAndroid
flutter pub get
flutter analyze
flutter test
flutter build web --release
```

Expected: every command exits 0 and the web build contains `assets/contact_center/bulka_envelope.png`.

- [ ] **Step 3: Run local visual QA on three widths**

Serve the Flutter web build with the repository QA server, open it in the in-app browser, and capture authenticated/guest states at:

- 320 × 700 — no overflow, two-column compact contacts.
- 390 × 844 — reference-like phone layout, three compact columns when labels fit.
- 1024 × 768 — centered capped content and readable admin preview.

Check: SafeArea clearance, back button, centered title, segmented selection, empty envelope, notification list, standard card, compact grid, 200% text scaling, keyboard focus, and reduced motion.

- [ ] **Step 4: Verify admin CRUD against a disposable/local database only**

Create an inactive card, add one action, edit three translations, reorder, activate, verify public response, hide it, and delete it. Do not write test records to production.

- [ ] **Step 5: Review the final diff for ownership and generated noise**

```powershell
git status --short
git diff --check
git diff --stat
```

Expected: no whitespace errors; all feature files are accounted for; unrelated pre-existing changes remain untouched and unstaged.

- [ ] **Step 6: Record final evidence in the handoff**

Report exact passing commands, any platform build not runnable on Windows (native iOS archive), generated asset path, migration names, admin route, Flutter entry behavior, and all files intentionally left uncommitted due to overlap.

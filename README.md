# Bulka Bonus

Production stack for the Bulka loyalty program: an Express/Supabase API, React admin panel, Flutter customer app, and an iikoFront plugin.

## Components

- `src/` — API, authentication, customer balance, OTP, Wallet, iiko integration, and loyalty tiers.
- `admin-ui/` — protected admin panel at `/admin`.
- `BulkaAndroid/` — iOS and Android customer app.
- `IikoBonusPlugin/` — iikoFront plugin that searches customers and applies bonus transactions.
- `supabase/migrations/` — the only canonical, immutable SQL migration history.
- `supabase_schema.sql` — a mutable bootstrap snapshot for an empty database; it is never checksummed as a migration.

## Local setup

1. Copy `.env.example` to `.env` and fill in the secrets. Never commit `.env`, signing keys, certificates, or iiko plugin configuration.
2. Install API dependencies with `npm ci`.
3. Install admin dependencies with `npm ci --prefix admin-ui`.
4. Check the database migration plan with `npm run db:migrate:check`.
5. Build the admin panel with `npm run build` and start the API with `npm start`.

Use `GET /livez` (or the legacy `/healthz`) for process liveness and `GET /readyz`
for dependency readiness. `/readyz` checks Supabase, the optional Kaspi module
and monitored background workers while returning only the aggregate status.
When `METRICS_BEARER_TOKEN` is configured, Prometheus metrics are available at
`GET /internal/metrics` and detailed readiness at `GET /internal/readiness`
with that Bearer token. Set `OPS_ALERT_WEBHOOK_URL` to receive throttled alerts
for critical reconciliation, delivery, and WhatsApp worker failures.

## WhatsApp AI consultant for Astana

The existing Baileys bot can answer customer questions about Bulka in Astana through Gemini while keeping OTP and staff task commands separate. It responds only in direct chats; group commands keep their existing behavior.

Set these values in the protected server `.env`:

```dotenv
GEMINI_ASSISTANT_ENABLED=true
GEMINI_API_KEY=replace_with_a_new_google_ai_studio_key
GEMINI_MODEL=gemini-3.1-flash-lite
```

The consultant reads current menu facts from iiko, branch details from Supabase, and public contact/loyalty settings. If branch storage is unavailable, it falls back to the five verified Astana locations: Kabanbay Batyr 46a, Kabanbay Batyr 59/3, Uly Dala 67, Uly Dala 41/2, and Roza Baglanova 4. `/сброс` clears the short in-memory conversation history.

Never commit provider keys. The privacy page discloses processing by
WhatsApp/Meta, Google Gemini, Alibaba Cloud/Qwen and DeepSeek. The bot redacts
common phone, email, card-number and login-code patterns before sending text,
but customers must still be told not to share secrets.

## Database migration

Set `SUPABASE_DB_URL` (or `DATABASE_URL`) to a privileged Supabase PostgreSQL
connection string and run:

```powershell
npm run db:migrate
```

The runner records the SHA-256 checksum of every applied SQL file in
`public.bulka_schema_migrations`, takes a PostgreSQL advisory lock, and applies
only files that are not yet recorded. Editing an already applied migration or
creating an ordering gap fails the deployment. `npm run db:migrate:check`
validates the local ordered set without changing the database.

Migration filenames must use `YYYYMMDDHHMMSS_snake_case.sql`, with one unique
timestamp. Do not create mirrors in another directory and do not edit an
applied file.

For a brand-new database, apply `supabase_schema.sql` once as the bootstrap
snapshot, then baseline only through the last migration verified as present in
that snapshot:

```powershell
npm run db:migrate -- --baseline-existing --baseline-through=20260723120000_admin_operations_realtime.sql
```

All migrations after that baseline are applied normally. Existing databases
must never reapply the snapshot.

## Loyalty tiers

The system now supports admin-managed tiers with multilingual names and descriptions, thresholds, cashback percentage, order, and activation state.

- Public: `GET /api/public/loyalty-tiers?lang=ru|kk|en`
- Customer: `GET /api/customer/loyalty?lang=ru|kk|en` with the customer Bearer token
- Admin: `/admin/api/loyalty-tiers` (CRUD), `/reorder`, and `/:id/active`

At least one active tier with a zero threshold is protected server-side. Legacy settings remain a fallback until the database migration is applied.

## Apple Wallet and Google Wallet

Wallet passes are issued from the authenticated customer card and synchronized after every bonus balance change. Apply the latest database migration before release, then configure:

- Apple: `PUBLIC_BASE_URL`, `WALLET_AUTH_SECRET`, `APPLE_PASS_TYPE_ID`, `APPLE_WALLET_TEAM_ID`, `WALLET_CERT`, `WALLET_KEY`, and `WALLET_WWDR`. Production certificate values are base64; local development may use the protected PEM files described in `.env.example`.
- Google: `GOOGLE_ISSUER_ID`, `GOOGLE_CLASS_ID`, and `GOOGLE_CREDENTIALS_JSON`. The service account needs the `wallet_object.issuer` scope and issuer access.

Create or update the Google loyalty class once with `npm run wallet:google:setup`. `PUBLIC_BASE_URL` must be the public HTTPS API origin so Apple Wallet can fetch updated passes.

Production runs on the Bulka VPS. Keep Wallet credentials only in `/var/www/iiko-bonus/.env`; `scripts/deploy-vps.ps1` preserves that file and never adds secrets to the release archive. Release flow:

```powershell
.\scripts\deploy-vps.ps1
```

Every release first passes a private staging smoke test. The persistent staging
process listens only on `127.0.0.1:3101`, with bots and background workers
disabled. Its files are stored in `/home/deploy/iiko-bonus-staging/current`.
Production promotion happens only after staging is healthy. The
deployment keeps the three most recent healthy source releases in
`/home/deploy/.bulka-releases`.

Rollback to the newest previous healthy release:

```bash
ssh bulka-vps 'bash /var/www/iiko-bonus/scripts/rollback-vps.sh'
```

External WAF activation and the guarded origin-lockdown step are documented in
`docs/external-waf.md`.

## Verification

```powershell
npm run verify
cd BulkaAndroid
flutter pub get
flutter analyze
flutter test
```

CI runs backend and admin coverage gates, admin Playwright and Python browser
tests, Flutter browser tests, Android compilation, an unsigned iOS compile and
dependency audits. `admin-ui/dist/` and `public/app/` are generated by the
release workflow and published as artifacts; they are not source-controlled.

## Mobile release

The Android release can never silently use the debug signing key. Create `BulkaAndroid/android/key.properties` from `key.properties.example`, point it to the protected production keystore, then build:

```powershell
cd BulkaAndroid
flutter build appbundle --release --dart-define=BULKA_API_BASE_URL=https://your-api.example
```

Create the iOS archive on macOS with the Apple signing certificate and provisioning profile. iOS permission text is localized for Russian, Kazakh, and English; only foreground location is requested.

## iikoFront plugin

Configure `IikoBonusPlugin/Resto.Front.Api.IikoBonusPlugin.dll.config` from the included example, then run:

```powershell
.\build.ps1 -Configuration Release
```

Copy the generated DLL, manifest, and configuration file together into the configured iikoFront plugin directory. Keep its API token outside version control.

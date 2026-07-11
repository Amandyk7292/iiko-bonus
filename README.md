# Bulka Bonus

Production stack for the Bulka loyalty program: an Express/Supabase API, React admin panel, Flutter customer app, and an iikoFront plugin.

## Components

- `src/` — API, authentication, customer balance, OTP, Wallet, iiko integration, and loyalty tiers.
- `admin-ui/` — protected admin panel at `/admin`.
- `BulkaAndroid/` — iOS and Android customer app.
- `IikoBonusPlugin/` — iikoFront plugin that searches customers and applies bonus transactions.
- `supabase_schema.sql` — idempotent database schema and seed tiers.

## Local setup

1. Copy `.env.example` to `.env` and fill in the secrets. Never commit `.env`, signing keys, certificates, or iiko plugin configuration.
2. Install API dependencies with `npm ci`.
3. Install admin dependencies with `npm ci --prefix admin-ui`.
4. Check the database migration plan with `npm run db:migrate:check`.
5. Build the admin panel with `npm run build` and start the API with `npm start`.

The API responds to `GET /healthz` without depending on Supabase, so it can be used for deployment health checks.

## Database migration

`supabase_schema.sql` is safe to re-run. To apply it from the command line, set `SUPABASE_DB_URL` (or `DATABASE_URL`) to a privileged Supabase PostgreSQL connection string and run:

```powershell
npm run db:migrate
```

The command is intentionally explicit: without `--apply` it does not change the database.

## Loyalty tiers

The system now supports admin-managed tiers with multilingual names and descriptions, thresholds, cashback percentage, order, and activation state.

- Public: `GET /api/public/loyalty-tiers?lang=ru|kk|en`
- Customer: `GET /api/customer/loyalty?lang=ru|kk|en` with the customer Bearer token
- Admin: `/admin/api/loyalty-tiers` (CRUD), `/reorder`, and `/:id/active`

At least one active tier with a zero threshold is protected server-side. Legacy settings remain a fallback until the database migration is applied.

## Verification

```powershell
npm run verify
cd BulkaAndroid
flutter pub get
flutter analyze
flutter test
```

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

# Editable loyalty FAQ

Migration: `supabase/migrations/20261003223000_loyalty_faq.sql`.

The FAQ is presentation content; it does not change settings, rates, expiry,
bonus ledgers, tiers or payment rules. Seeded wording uses current card values
and current program conditions without freezing configurable percentages or days.

## API

- `GET /api/public/faq?lang=ru|kk` returns `{success:true,items:[{id,question,answer,sortOrder}]}`.
  The default language is Russian. Only active entries are returned, ordered by
  `sort_order`, then `id`. An incomplete Kazakh question/answer pair falls back
  entirely to Russian. Responses use `Cache-Control: no-store`.
- `GET /admin/api/faq` returns `{success:true,items:[{id,questionRu,answerRu,questionKk,answerKk,sortOrder,isActive}]}`.
- `POST /admin/api/faq` (201) and `PUT /admin/api/faq/:id` (200) accept a full camelCase
  item, excluding `id`; both return `{success:true,item}`. Russian text is required.
  Questions allow up to 240 characters, answers up to 4,000; HTML and unsafe control
  characters are rejected. Kazakh fields may be omitted or blank together.
  `sortOrder` is an integer from 0 to 2,147,483,647; `isActive` is a boolean.
- `DELETE /admin/api/faq/:id` (200) returns `{success:true,item}` and sets
  `isActive=false`. The UI calls this **Hide**. The item stays in the admin list
  and can be shown again with a full `PUT` containing `isActive=true`.

Public registration lives under the public API rate limiter, independently of
the POS-authenticated `/api/loyalty` router. Administration uses existing session,
CSRF, role, rate-limit and audit middleware. The `faq` path maps to the existing
`loyalty-tiers` permission area: owner, admin, editor and marketer can manage it.
No new role or general permission is granted. The table has service-role-only RLS
and denies direct anonymous/authenticated access; service_role has no DELETE grant.

## Seed evidence

| Topic | Repository rule or UI evidence |
| --- | --- |
| Earning timing and base | `src/services/order-payment-state.service.js:29` excludes discounts/bonuses from eligible merchandise; `:221` calculates the current card rate; `:269` / `:434` award during confirmed payment handling. This is payment confirmation, not order fulfillment completion. `src/services/loyalty-reservation.service.js:328` calculates POS earning on paid amount. |
| Activation wait | `src/services/order-payment-state.service.js:237` and `src/services/loyalty-reservation.service.js:333` read the configurable activation delay; `src/services/customer.service.js:187` activates pending transactions. The FAQ does not claim a date is rendered in history. |
| Card level | `src/utils/tier.util.js:140` chooses a tier from `totalSpent` and purchase thresholds. `BulkaAndroid/lib/widgets/loyalty_tier_card.dart:70` displays the level and percentage. The FAQ does not promise a remaining-to-next-tier display. |
| Using bonuses | `src/services/checkout-bonus.service.js:8` / `:25` calculate available merchandise bonus spending before payment and recheck under reservation; `BulkaAndroid/lib/screens/checkout_bonus_switch.dart:45` displays the bonus option; `BulkaAndroid/lib/screens/orders_checkout_layout.dart:298` displays the spent amount. |
| Expiry | `src/server.js:114` reads enabled/auto-write-off/period settings; `src/services/customer.service.js:816` expires balances after inactivity; `src/services/bonus-expiry.service.js:124` builds the expiry summary. `BulkaAndroid/lib/screens/home_screen.dart:296` mounts `_LoyaltyPanel`; `BulkaAndroid/lib/widgets/loyalty_panel.dart:162` mounts the expiry notice; `:226` shows it only when there is an upcoming expiry and a positive amount, with date and sum. |
| Cashier QR | `src/routes/legacy.routes.js:713` authenticates QR issuance; `src/services/customer.service.js:606` validates dynamic QR expiry. `BulkaAndroid/lib/widgets/loyalty_panel.dart:96` offers the cashier QR action. |
| Refund correction | `supabase/migrations/20261003162000_delivery_fee_loyalty_adjustment.sql:165` adjusts purchase progress and `:176` / `:190` restores spent bonuses and reverses earnings; `supabase/migrations/20261002172600_family_pos_bonus_refund.sql:47` applies equivalent family POS correction. |
| History | `src/routes/legacy.routes.js:133` loads bonus transactions from the family wallet owner when applicable; `BulkaAndroid/lib/screens/balance_history_item.dart:3` renders transactions; `BulkaAndroid/lib/screens/balance_history_screen.dart:116` displays the history list. |
| Personal account | `src/services/personal-account.service.js:37` reads monetary balance and entries separately from bonus transactions. `src/services/customer-financial-details.service.js:36` reads separate bonus and monetary ledgers. |
| Family wallet | `src/services/family.service.js:92` shares the owner's bonus balance and purchase progress with an active member; `:223` permits payment-purpose QR only when the owner grants a positive daily limit. The FAQ describes shared bonuses and separate permission for spending the shared monetary account. |

## Verification

`test/faq.test.js` covers validation, paired fallback and safe errors.
`test/faq-pg.test.js` executes the migration and service against PostgreSQL-compatible
PGlite, including hide/show preservation, filtering, ordering, constraints and RLS.
`test/faq-routes.test.js` exercises the production app router, public reads, admin
sessions, every allowed/denied role, cookie CSRF, full mutation contracts and audit.

## Web bundle cost

The normal release-mode preview measured 439,006 bytes for total admin JavaScript
gzip, with a 72,980-byte largest chunk and 32,846-byte largest CSS file. The FAQ
editor remains lazy loaded. Flutter measured 6,649,759 bytes raw and 1,816,088 bytes
gzip, about 12 KB raw / 3.4 KB gzip above the previous staff-touch release.
The total admin and Flutter entry budgets have only about 2 KB measured headroom;
the individual JavaScript, CSS, exporter and WebAssembly limits remain unchanged.
Production is rebuilt from the committed source and checked against these limits.

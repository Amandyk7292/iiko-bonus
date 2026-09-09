# Delivery pricing at checkout

Customers pay the delivery fee displayed at checkout together with their goods.
Delivery is free when the merchandise total after discounts is at least
10,000 KZT. Delivery fees do not count toward this threshold. Pickup has no
delivery fee; preorder delivery follows the same rule as immediate delivery.

Updated Flutter clients request a preliminary Yandex Cargo `check-price` estimate
for the validated branch, saved destination coordinates and canonical cart.
This request does not create an order, delivery job or courier claim. Estimates
must be in KZT and within the configured dispatch limit. Decimal estimates are
rounded up to whole tenge before they are displayed.

The server signs the estimate for 15 minutes and binds it to the customer,
branch, destination, schedule, merchandise and discount. Payment uses that
signed fee without calling Yandex again. Expired or changed quotes require a
refresh and another confirmation before any payment starts. A retry of an
existing checkout returns the original payment even if its quote has expired.

Installed older clients continue using their server-configured delivery-zone
estimate until updated; the 10,000 KZT threshold applies to them as well.
Clients cannot submit an arbitrary fee. Already created orders are not repriced.

The amount collected from the customer is stored in `kaspi_orders.delivery_fee`
and included in the payment and receipt total. Yandex's final cost remains in
`delivery_jobs.provider_price`. Bulka pays Yandex through its corporate account
and absorbs any difference. Provider prices are excluded from customer order
responses and never become a later customer surcharge.

Tests cover threshold boundaries, discounts, pickup/preorder, quote integrity,
expiry, idempotent retries, the 1000-to-1500 KZT overage example, provider payloads,
and the customer-visible fee. Flutter API tests verify the quote token is carried
into saved-card checkout without accepting a client-supplied fee.

## Verification on 9 September 2026

Commit `63a46f2cf852` was published as production release
`20260909135706-63a46f2cf852`. Production and private staging health checks passed;
no SQL migrations were needed. Validation passed: 106 backend tests, 77 Flutter
tests, Flutter analysis, backend ESLint and source-size budgets.

Android 1.0.1 (26), debug x86_64, was installed in the Android 16 emulator.
APK SHA-256: `7b5553a3689fed9c8a744f9d79c093eed034bafbc893c97c8277348d061fe879`.
The existing customer session, saved address and cart survived the update.
The live checkout showed goods 35 KZT, estimated delivery 2471 KZT and total
2506 KZT. Screenshot: ignored local evidence
`scratch/android-delivery-check-20260909/repeat-16-live-quote.png`.

Only Premium Plaza's nearest-zone minimum was temporarily lowered from 2000 to
35 KZT at 09:03:02 UTC to inspect the previously authorized test basket. It was
restored at 09:04:10 UTC; the zone fee and other zones were unchanged. No payment,
order or courier was created. The larger real payment remains pending owner
confirmation because the original test was authorized for 35 KZT.

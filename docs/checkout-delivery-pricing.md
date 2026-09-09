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

After the owner explicitly authorized 2506 KZT, real test order 100043 was paid
with the saved card ending 1328. Its customer fee remained 2471 KZT while Yandex's
actual cost was 2470.80 KZT. No later amount was charged to the customer.

The Android order changed from new to accepted and preparing without pressing
Refresh after the corresponding browser admin and kitchen actions. An automobile
courier was assigned, and the native app displayed the courier, car and a GPS map.
The provider reported successive GPS positions. The actual Yandex claim response
contained the selected branch coordinates and the saved recipient coordinates,
house, entrance, floor, apartment and phone. The courier's own device was not
inspected, and physical pickup/handoff was not performed.

At the owner's urgent request, Yandex confirmed cancellation at 09:29:19 UTC with
status `cancelled`, not `cancelled_with_payment`. Forte confirmed the full 2506 KZT
refund at 09:29:54 UTC. Automatic reconciliation finalized the order at 09:30:34
UTC: payment refunded, fulfillment and kitchen cancelled, refund succeeded.
The owner independently confirmed receiving the money. Android and the browser
subsequently showed the refund. Local evidence:

- `scratch/android-delivery-check-20260909/repeat-38-courier-map.png`
- `scratch/android-delivery-check-20260909/repeat-courier-assigned.json`
- `scratch/android-delivery-check-20260909/repeat-cancellation-audit.json`
- `scratch/android-delivery-check-20260909/repeat-39-after-refund.png`

Premium Plaza's nearest-zone minimum was temporarily lowered from 2000 to 35 KZT
for checkout attempts, and was last restored at 09:15:34 UTC after payment. A
09:31:56 UTC inspection confirmed the original 2000 KZT minimum and 600 KZT zone
fee. Other zone values were preserved.

Two issues found during the repeat test were corrected: a previously refunded
payment can no longer reopen its old bank checkout for a new basket, and an
admin cancellation awaiting bank confirmation returns HTTP 202 with the saved
pending refund state. The admin closes the confirmation dialog, shows an
informational message, and prevents resubmission while reconciliation continues.
An explicit bank decline still produces an error. No additional real payment or
refund is needed to test these branches.

The recovery fixes were published from `ded5218d612e` as healthy production
release `20260909143959-ded5218d612e`; private staging was healthy too. Validation
passed: 33 backend refund/lifecycle tests, 7 admin order tests, 79 Flutter tests,
Flutter analysis, TypeScript, backend ESLint and source-size budgets. Nine backend
refund tests also passed from the clean release checkout.

Android 1.0.1 (27) was built and installed in the emulator. APK SHA-256:
`07dbcf0e576a33fbaeea2b0fff7ebd399579fb42c3d3bf6e52f910065df354ec`.
The native purchases page showed order 100043 cancelled and refunded, and its
receipt showed goods 35 KZT, delivery 2471 KZT, total 2506 KZT and card ending
1328. Evidence: `repeat-46-final-purchases.png` and
`repeat-44-android27-receipt-loaded.png` in the same ignored evidence directory.
A final read-only provider check at 09:45:30 UTC confirmed one Yandex claim,
cancelled, and the order fully refunded. No IPA was built for this update.

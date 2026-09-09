# Delivery map and retired zones

Delivery uses the nearest active branch with delivery enabled and valid coordinates, or the explicitly selected eligible branch. Preorder availability, hours, capacity and stock checks remain. Historical polygon, radius, minimum-order and branch tariff settings no longer limit addresses or determine payment amounts. The public locations API and both staff interfaces omit these settings; the bulk zone endpoint is removed. Historical database columns are retained, and the delivery constraint now only requires coordinates.

The customer confirms the courier estimate in checkout. Delivery is free for merchandise after discounts from 10,000 KZT. A signed quote freezes the fee at payment; subsequent courier charges never change the customer's order. Apps without quote-token support receive `CHECKOUT_APP_UPDATE_REQUIRED` for delivery, instead of a guessed or zero fee. Pickup is unaffected. Native clients must be updated with this release because older location selectors still require zone data.

The order map shows a brown bakery pin, a gold home pin and a blue car. Pickup coordinates come from the dispatched request snapshot, with branch coordinates as a fallback before dispatch. The recipient uses the saved order address, including house, entrance, floor and apartment. Missing coordinates never generate a marker. Incoming courier positions update the car without resetting the user's map view; “Show all points” restores the full view. The map and legend work in Russian, Kazakh and English.

Map bounds use the documented [Yandex JS API 2.1 setBounds options](https://yandex.com/dev/jsapi-v2-1/doc/en/v2-1/ref/reference/Map), including margins for the pins. `BulkaAndroid/test/fixtures/tracking_preview.dart` renders the actual tracking component for visual checks without creating an order, charging a card or dispatching a courier.

## Verification on 2026-09-09

Production release `8e30153bffef` is healthy. The public API returns 18 branches without zone settings. Read-only checks on the previously cancelled order 100043 confirmed that the pickup matches the dispatched request and the full recipient address is preserved; the payment remains refunded. All three marker assets return SVG responses successfully.

The authenticated browser check confirmed that the locations list and Premium Plaza editor no longer contain zone, radius, minimum-order or branch tariff controls. Android 1.0.1 (28) was installed on `emulator-5554`. The actual tracking widget displayed all three distinct markers and the full recipient address; zoom and "Show all points" were checked. The preview was then replaced with the normal application, which opened the signed-in purchase history successfully. No new order, payment or courier was created, and no IPA was built.

Visual evidence is saved locally at `scratch/android-delivery-check-20260909/map-preview-zoom.png` (test fixture) and `normal-android28-loaded.png` (normal application). The Android build used debug signing for the emulator.

Validation: backend suite 848 passed, 3 skipped; focused Flutter tests 64 passed and analyzer clean; admin build, lint and the 4 location filter tests passed; map route tests 5 passed; API contract coverage 189/189 and migration safety checks passed. The full Flutter suite had 321 passes and 2 existing failures in `buyer_safety_regression_test.dart`; both failures were reproduced on the preceding release and concern outdated back-navigation expectations. Full backend lint also reports existing formatting errors in `src/routes/admin/access.routes.js`; scoped changed-file lint passed.

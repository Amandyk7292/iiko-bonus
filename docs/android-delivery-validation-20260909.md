# Android delivery validation, 9 September 2026

## Build and corrections

Source: `c7394bc182cf`. Production release:
`20260909120428-c7394bc182cf`; production and private staging readiness checks
passed. Flutter web bundle SHA-256:
`e76ec63686d90965635c76517de8954c04a6b75f9b64e088f7f217bd3560caeb`.

Android emulator: Medium_Phone_API_36.1, Google Play x86_64, Android 16.
Installed `com.bulka.bonus`, 1.0.1 (25), debug x86_64. Final APK SHA-256:
`7ff32dfb6908f76b00356a6f23151aa0b28d5bc7c7efe54e66339c4740843b73`.
No IPA was built in this test.

The Windows emulator host crashed during keyboard interactions with the earlier
renderer. Emulator 37.1.11 with `-gpu software`, Flutter software rendering and
Impeller disabled stayed running through customer login, saved-card payment,
order status updates and receipt display. The emulator timezone was set to
Asia/Aqtau before the final build validation.

Two real failures were corrected:

- The delivery minimum rejection was hidden by a generic client error, while
  checkout still displayed the product subtotal as the final amount. Checkout
  now requires a successful quote, displays a persistent translated error with
  retry, and withholds the final total until validated. Preference loading also
  avoids briefly displaying pickup for a saved delivery checkout.
- Automatic courier dispatch validated an order returned from an update without
  its related branch/customer. It incorrectly reported a missing branch city.
  The atomic dispatch claim now fetches those relations before route validation.

Validation: 66 Flutter tests, 37 backend dispatch/kitchen/refund tests, targeted
Flutter analysis, backend ESLint and source-size checks passed.

## Real order evidence

Only test order **100042**, ID `30b61bbd-de43-4949-a953-fe9765f68641`, was
created. One Moscow sugar bun cost **35 KZT**, paid through the customer's
existing Visa ending **1328**. Earlier attempts failed delivery validation before
order/payment creation. The later payment screen initially waited for a final
result and then confirmed payment; no new payment was initiated while waiting.

The saved address, destination coordinates and registered customer phone were
compared with the persisted order and actual Yandex request. Pickup was
**Premium Plaza, Aktau**. Destination house was sent in the courier comment;
entrance, floor and apartment were separate destination fields. Private address,
contact and provider details remain in ignored local evidence, not this document.

With owner approval, only the branch's `zone-near` tariff was changed to minimum
35 / fee 0 at **06:50:23 UTC**. It was restored to minimum 2000 / fee 600 at
**06:59:15 UTC**, preserving the other delivery zones. The paid order retained
its original 35 KZT total.

Changing the order to **Accepted** in the browser updated the open Android order
screen and displayed the order notification without pressing Refresh. This
status alone does not start kitchen acceptance. Accepting the same order on the
Kitchen screen changed the customer status to **Preparing** automatically.

After publication, a guarded retry of the existing failed dispatch used the
corrected orchestration path. Yandex's production Cargo endpoint accepted the
claim; dispatch became `succeeded`, then the provider entered `performer_lookup`.
No second order or payment was created. Yandex searched for roughly 15 minutes
before assigning an automobile courier. The Android customer screen displayed
the courier's name, vehicle and embedded location map. Two different GPS
positions were received at 07:26 UTC. Screenshots were taken before cancellation;
no physical pickup or customer handoff was performed or claimed.

The assigned courier was cancelled through the browser at **07:27:53 UTC**.
The confirmation was for free cancellation; Yandex returned `cancelled`, not
`cancelled_with_payment`, and the delivery job reached terminal cancellation.

Order cancellation/refund was then submitted in the browser. The first bank
response was uncertain, so no second refund was submitted. Automatic
reconciliation confirmed the same refund reference at **07:29:46 UTC**:
payment `refunded`, order `cancelled`, refund `succeeded`, amount **35 KZT**,
no refund error. Android automatically changed to the refunded order view and
displayed the refund notification. This proves bank/provider confirmation;
the issuing bank's card statement was not inspected.

Final readback verified both terminal states and the restored tariff. There is
no active courier request or paid, unrefunded test order left from this run.

The native receipt displayed the Bulka logo, order number, item quantity,
35 KZT total and saved card suffix. It did not open a browser or WebView.
The order and receipt were opened in Russian, Kazakh and English. Kazakh used
the requested title `Төлем түбіртегі`; English used `Payment receipt`, with
translated product/payment text. Russian was restored afterwards.

## Local artifacts

Ignored evidence directory: `scratch/android-delivery-check-20260909/`.

- `58-order-before-accept.png`, `59-order-after-accept.png` and
  `60-kitchen-accepted-live.png`: automatic customer status changes/notification.
- `65-test-receipt.png`, `75-kazakh-receipt.png`, `85-english-receipt.png`:
  actual native receipt for the paid test order in all three languages.
- `93-courier-map.png`, `94-courier-live-position.png`: assigned courier and
  real location displayed inside the Android app.
- `96-refund-confirmed.png`, `97-cancelled-purchases.png`: customer-visible
  refund and cancelled purchase.
- `courier-assigned-audit.json`, `courier-position-2-audit.json`,
  `courier-cancelled-audit.json`, `final-order-audit.json`,
  `final-tariff-audit.json`: scoped assignment/location/cancellation/refund and
  restored settings.
- `order-paid-audit.json`, `courier-request-audit.json`: payment, route and
  dispatch evidence scoped to this order.
- `tariff-applied.json`, `tariff-restored.json`, `customer-final-baseline.json`:
  temporary tariff and verified restoration.
- `checkout-regression-final.log`, `checkout-analyze-final.log`,
  `dispatch-full-regression.log`, `delivery-fix-deploy.log` and
  `android25-final-build.log`: checks/build/release evidence.

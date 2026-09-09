# Customer application fixes, 9 September 2026

## Device release

On 9 September the user explicitly authorized building, installing and checking
the IPA, superseding the earlier hold. Build 21 was never installed.

The final **IPA 23**, version **1.0.1**, source `142eb871c92f`, was installed on
the original Amandyk iPhone at **09:41:37 +05:00**. Installation reached 100%; a
separate app query confirmed build 23, and native process launch succeeded.
Actions run `34311492058`, artifact `10088604739`.
SHA-256: `ccaffc3522cb363d08cce2d52d02718dd70c4ffaf5faf1ede29c1c348f92efae`.
The artifact checksum and app/widget signing, profiles, device eligibility,
push entitlement, shared app group and icon catalog were validated again.

Build **22** (version 1.0.1, source `1d4b73c0646a`) was installed on the original
Amandyk iPhone at **09:15:09 +05:00**. Installation, a separate bundle/version
query, and launch succeeded. Actions run `34309685403`, artifact `10088031264`.
SHA-256: `f2cced1aa9c2b3976b88e4229e23c6bc2330090bf94fc067de9b9604b86a2004`.
App/widget profiles, signing certificate, device eligibility, app group, push
entitlement and the solid icon catalog passed local validation.

Physical checking exposed missing customer notification authorization: Firebase
initialized and customer login succeeded, but the token listener was never
installed. The user confirmed that iOS had no Notifications settings entry for
this app. The onboarding completion flag did not represent an OS permission;
the existing post-onboarding permission helper was never called.

The follow-up fix requests permission after customer sign-in or restoration of a
session whose onboarding was completed. Requests are coalesced, an existing iOS
denial is respected, and a logout during the settings query prevents a prompt.
Background retries still never prompt. Regression tests cover a skipped screen,
stale local permission flag, simultaneous calls, denial, logout, and Android's
first runtime permission. The 22 push/onboarding tests and 62 final app/permission
tests passed; Flutter analysis reported no issues.

## Implementation

Application source: `57e69b92fb24`.

- Receipts open in Flutter from order details and purchase history. The signed
  endpoint supplies a restricted JSON representation; invalid/expired links are
  rejected before reading receipt data. No staff or customer token is forwarded.
- Receipt sharing produces a PDF with the existing Bulka logo, embedded
  Montserrat fonts, translated product names and centered numeric columns.
  The user's Kazakh wording is **Төлем түбіртегі**.
- Payment labels use the actual payment's last four digits, including a fallback
  to that same order's stored bank metadata. Unknown suffixes stay unknown.
  Internal provider identifiers and the merchant details panel are removed.
- Current menu products/categories from Aktau and Astana have Russian, Kazakh
  and English copy. The same dictionary covers existing purchases and cached
  cart items. Explicit administrator translations retain priority; historical
  prices, quantities and canonical names are preserved.
- Directory maps omit the location button and deny website geolocation.
  Built-in POI interactions are disabled; Bulka branch markers still work.
- Customer bottom sheets paint their complete lower safe area white. Outside
  taps dismiss editable fields without breaking password controls or switching
  between fields. The outer Locations arrow closes the route; the inner arrow
  returns to cities and clears search.
- Map controls and native home widgets follow the selected application language.
  A background push does not replace the saved language with its isolate default.

## Verification

- 95 focused Flutter tests passed. After the last PDF/city adjustments, all
  16 affected receipt, map, sheet and widget-language tests passed again.
- Flutter analysis: no issues. Flutter web release build completed successfully.
- 43 targeted backend tests passed; a separate 40-test HTTP/receipt/catalog
  suite passed. This includes signed JSON authorization and unchanged sale totals.
- Every current product/category in both city snapshots has all three languages:
  Aktau 167 products / 17 categories; Astana 184 products / 15 categories.
- PDF previews were rendered and inspected in Russian, Kazakh and English.
- Release checkout API contract coverage: 190/190. Unrelated local admin edits
  were excluded. The pre-existing catalog_product_card.dart size-budget overage
  remains unchanged by this release.

Production release **20260909004946-57e69b92fb24** is healthy. Flutter web SHA-256:
`a3cbd92e78f5683989fa21b3dd88009c5374d2bd400aba0c17ebafeac9eb2fe2`.
The standard deployment completed its database backup, migrations and provenance
checks. Live API checks confirmed translated names and unchanged prices for all
167 Aktau and 184 Astana products. Directory geolocation is disabled and the
location button is absent; the provider's POI interaction switch is disabled.

The real receipt for reported order **100039** returned valid native JSON in
Russian, Kazakh and English. Its actual payment card suffix is available. No
payment or order state was modified during verification.

## Push and Live Activity evidence

Earlier source `1d7f51e` is already deployed. APNs accepted one update for reported
order 100010 (ready) and one end event for order 100011 (completed), with no failures.
This confirms APNs acceptance, not observation of the physical lock screen.

Customer Firebase enrollment now waits for native initialization/APNs and retries
late or offline registration. Broadcast results no longer report success for zero
recipients. With build 23, the original account's device count changed from **0
to 1** at `2026-09-09T04:41:49.648475Z`. One test notification targeted that fresh
iOS token only. FCM accepted it at `2026-09-09T04:42:22.738Z`, and a physical
device screenshot captured its visible "Проверка Bulka" banner. This establishes
actual foreground delivery, beyond provider acceptance. No customer broadcast
was sent and no order/payment status was changed. Physical cashier delivery and
all lock-screen lifecycle cases are not established by this customer test.

The physical Locations screen showed the white bottom safe area and absent
location button. The running customer Live Activity displayed "Готов" in Dynamic
Island, and build 23 registered a fresh ActivityKit token after launch.

Device evidence: `scratch/iphone-build23-install.log`,
`scratch/iphone-build23-after-app.json`, `scratch/iphone-build23-launch.log`,
`scratch/iphone-build23-push-after.json`, `scratch/iphone-build23-push-delivery.jsonl`,
`scratch/iphone-build23-test-push.png`, and `scratch/iphone-build23-permission.png`.

Local evidence is in `scratch/client-validation-complete.log`,
`scratch/client-final-delta-tests.log`, `scratch/client-final-analyze-v2.log`,
`scratch/customer-backend-verified.log`, `scratch/client-receipt-http-tests.log`,
`scratch/client-languages-deploy.log` and the three `receipt-preview-*.pdf` files.
Post-deployment evidence: `scratch/client-live-public-verification.log` and
`scratch/client-live-receipt-verification.log`.

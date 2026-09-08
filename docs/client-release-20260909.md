# Customer application fixes, 9 September 2026

## IPA hold

The user explicitly requested completing the changes **without building or
installing another IPA until their next instruction**. Do not dispatch the iOS
workflow. Build 20 remains the last verified installation on the original iPhone.
Build 21 finished before this hold; it was not downloaded or installed.

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
recipients. Physical customer FCM delivery remains unverified: the installed build
20 does not contain the subsequent enrollment fixes, and the user's IPA hold must
be respected. Do not send an unsolicited broadcast to test it.

Local evidence is in `scratch/client-validation-complete.log`,
`scratch/client-final-delta-tests.log`, `scratch/client-final-analyze-v2.log`,
`scratch/customer-backend-verified.log`, `scratch/client-receipt-http-tests.log`,
`scratch/client-languages-deploy.log` and the three `receipt-preview-*.pdf` files.
Post-deployment evidence: `scratch/client-live-public-verification.log` and
`scratch/client-live-receipt-verification.log`.

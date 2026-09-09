# Delivery pricing, promotions and cancellation

Published on 2026-09-09 as release `20260909163925-31bd68eb1754`.
Implementation commit: `8403f2c`; isolated test fixture correction: `31bd68e`.

- Customer receipts (HTML, native Flutter and PDF) and staff order views show goods, discounts, the delivery fee charged at checkout, and the total. Delivery orders show a zero fee when delivery is free. Later courier price changes do not change the customer breakdown.
- `free_delivery` promotions have a zero merchandise discount and waive the checkout delivery fee. Existing audience, branch, minimum order, date and redemption restrictions still apply. Pickup orders reject this promotion with a localized explanation. The Yandex corporate billing path is unchanged.
- Web and native promotion forms show basic settings first and put optional limits and audience settings under additional conditions. Fields that do not apply to free delivery are hidden.
- Cashiers may cancel orders in their assigned branch through the regular order cancellation action. Other order transitions remain in the kitchen workflow; general refunds and courier dispatch permissions are not expanded.
- Cancellation first confirms the external courier cancellation. The database then claims the refund and closes the order atomically, blocking competing courier reservations. Only then is the bank refund requested. Failed or unconfirmed courier cancellation leaves the order and payment open. Existing bank idempotency and pending-refund reconciliation remain in place. Provider restrictions after goods handoff still apply.

Verification:

- Clean release checkout: 851 backend tests passed initially; four new promotion tests failed because they depended on a local database configuration. The fixture was isolated, then all four passed in that same checkout. Three unrelated tests were skipped.
- 287 admin UI tests passed; 19 targeted Flutter receipt, promotion, order and native workspace tests passed.
- TypeScript and Flutter analysis, scoped backend lint, migration safety and source size checks passed.
- Russian, Kazakh and English PDF previews were rendered and visually checked.
- Normal deployment applied migrations and verified healthy production/staging plus the public Flutter bundle hash.
- Read-only production check of order 100043: goods 35 KZT, delivery 2471 KZT, total 2506 KZT; payment remains refunded and its Cargo job remains cancelled. Signed receipts returned HTTP 200 in all three languages. Both promotion constraints contain the new type.
- Live browser verification confirmed the simplified free-delivery form and the order amount breakdown. No promotion was saved and no new real charge, order or courier was created.
- No IPA or new native Android binary was produced for this change. Native source changes require the next installed build.

Separate balance question: customer payments collected by Bulka do not automatically replenish the Yandex corporate account. The open Yandex Kazakhstan account showed 5000 KZT. The current checkout does not verify that account's available balance. A balance/reservation check before payment and an operator alert need a supported balance integration; auto-replenishment or deferred billing must be confirmed for the merchant's Yandex contract. None was enabled by this release.

# Native staff administration

The iOS/Android employee entry now opens `NativeStaffApp`, not `AdminPortalScreen`.
The website still opens the browser administration. Payment and Yandex map adapters
are independent of the removed administration WebView entry.

## Native sections

| Area | Flutter implementation |
| --- | --- |
| Employee session | Password/2FA, WhatsApp phone verification, operator access links, isolated Keychain session, revocation and logout |
| Workspace | Role-based navigation, city/branch scope, global search and detail, operational alerts, staff push registration and heartbeat |
| Operations / analytics | Scoped queues and counters, charts, customer/order summaries and action links |
| Orders | Search, status/payment filters, items, customer contacts, transitions, cancellation, courier assignment, substitutions, refund preview and execution, proof/PIN/location |
| Kitchen | Native order cards, status columns represented by filters, preparation time, arrival/late state, paid-order alarm, foreground refresh, SSE reconnect, tablet wake lock |
| Delivery / couriers | Assignment/auto-assignment, availability, Yandex quote/request/sync/cancel/reconciliation, tracking links, courier CRUD/history/session revocation/access link |
| iiko Front | Operations list, details and export |
| iiko Dashboard | All eight sections, calendar period, metrics and daily chart, comparison, rankings and drilldowns, receipt items, report fields and filters, templates, stock controls, Excel sharing, preferences import/export |
| Customers / transactions | Search/pages, customer detail/history/edit/bonus adjustment/delete, authorized bulk actions, transaction filters and CSV |
| Menu / inventory | Product/category overrides, custom products, facts, translation, image upload, stock/stop lists, synchronization, modifier groups and product constructor |
| Locations | City/branch CRUD, full manual address, collapsed Yandex map, coordinates, hours, availability, delivery zones, POS credentials |
| Content | Stories and news CRUD, images, schedule and localized content |
| WhatsApp | Conversations, text/voice, delivery state, pairing, assistant configuration, knowledge, customer memory; viewer cannot mutate |
| Support / reviews | Queues, detail, status, assignments, replies and review moderation |
| Loyalty / marketing | Bonus policy and promo codes, tiers, promotions, gift cards, automations |
| Taplink / contacts / broadcast | Structured native editors, Taplink draft/preview/publication, contacts, localized broadcast preview and explicit send |
| Access / system | Employee access, credential reset, ordering/site controls, audit/security status, integration diagnostics, application release policy |

Existing server contracts and authorization remain authoritative. Cashier catalog
is discovered from the server: older deployments that expose only orders/kitchen
do not gain an unsupported menu entry. Access creation uses the published server's
phone roles and cashier-password contract. Unrelated in-progress backend and web
changes in the shared workspace are excluded from this mobile release.

## Interaction and correctness

- Native page routes carry the same compact white theme; text wraps at narrow widths.
- No fixed-height desktop data tables: report rows expand into labeled details.
- Event refreshes are coalesced, with pending refresh retained while a page is busy.
- Invalid sessions close employee detail routes and return to native login.
- Refund/voice requests preserve their operation identifier when a request is retried.
- Paid courier cancellation and publication/send operations require explicit native confirmation.
- Taplink/broadcast navigation and product-option back navigation protect unsaved drafts.
- API requests reject traversal/external paths and do not forward credentials on redirects.

## Verification

Automated fixtures exercise 29 sections at 320, 390 and 768 logical pixels with
1.5x text, staff entry without WebView, calendar-result propagation across iiko
report sections, dispatch validation, event coalescing, login/session isolation,
revocation, refund retry and kitchen transitions. No live financial, courier or
broadcast mutations are performed by these tests.

Release results and device installation are recorded after the signed build.
Physical Android performance is not measured because no Android device is connected.
The previous iPhone build-4 frame sample is documented separately in
`iphone-performance-20260908.md`; it is not evidence for this native administration.

# Client updates after admin changes

Admin writes invalidate client data after a successful, authenticated response. The public SSE endpoint (`/api/public/events`) sends only `client.data.changed` with an allowlisted list of domains. It never forwards admin payloads, customer identities, addresses, balances or orders. Authenticated clients receive the same invalidations through their existing private SSE connection, plus their own order, notification and loyalty events.

| Admin data | Open client views refreshed |
| --- | --- |
| Menu, product configuration, inventory | Catalog, product details/options, cart prices/stock, checkout quote |
| Branches, addresses, hours, fulfillment rules | Directory, open branch sheet, branch picker, address map, catalog branch label, checkout |
| Stories, news, promotions | Home feed, promotions, checkout promotions |
| Contact cards/actions | Notification center contacts |
| Loyalty settings and tiers | Profile/header, loyalty tier, balance history, rewards |
| Online ordering/payment settings | Checkout availability and quote |
| Customer name/bonus adjustment | Affected customer's profile and balance/history |
| New notification | Affected customer's open notification center, including when device push is disabled |
| Order, delivery, support events | Customer orders, order details, support list/thread |

`menu.updated` and `locations.updated` emitted by services also produce public invalidations. Private events retain customer and staff/branch audience checks. New client-facing admin resources must be added to `publicDomains` in `client-data-events.middleware.js`; do not broadcast arbitrary admin responses.

Flutter coalesces event bursts for 250 ms and queues another refresh when an event arrives during a request. Views preserve search, city, map position and form input. Reconnecting SSE, returning to the foreground and network recovery re-fetch current data, so recovery does not rely on retained event history. A 50-second heartbeat watchdog detects a silent connection; reconnect attempts wait three seconds. Suspended/offline devices catch up when connectivity/application activity resumes.

The SSE broker is in-process, matching the current single backend process. Scaling to independent backend workers requires a shared event broker before enabling multiple instances; an event in one worker does not reach another worker's subscribers.

Branch editing exposes name and full address independently from the map. The map is unmounted while collapsed and a marker move changes coordinates only. Existing labels support ru/kk/en.

## Verification

- Backend tests: public audience isolation/replay, successful vs failed/admin read writes, domain coverage, address-only persistence and validation.
- Flutter tests: guest stream, identity changes, reconnection/cancellation, invalidation during an in-flight menu request, live branch sheet and preserved search.
- Admin UI test: collapsed map, manual name/address, marker movement preserving text and persisted coordinates.
- Browser QA: two independent guest browser contexts using real SSE; both updated after a branch mutation and recovered after event history/streams were reset.
- Full Flutter suite: 229 passed; three pre-existing label assertions also fail on unchanged `7e792ca` (catalog navigation, notification title, payment return order labels). No new failures in that run.

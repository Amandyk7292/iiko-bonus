# Performance review, 2026-10-04

This release addresses measured delays without making financial or order actions trust stale data. Measurements below are bounded fixtures or finite read-only photo samples, not a production SLA.

| Area | Change and verification |
| --- | --- |
| Product photos | Automatic sanitized WebP95 upload, bounded dimensions; explicit photographic delivery for product/category photos. Existing objects also get small renditions. Stickers, avatars and promotional artwork keep lossless delivery. Separate image/API quotas, independent rendition keys and ETags, alpha and fallback regression checks. |
| Image states | Product-image pastry placeholder removed. Loading uses an activity indicator; missing/failed photos have a static background. Reduced-motion preference disables rotation. Geometry and product controls remain available while a photo is pending. |
| Customer order history | Account-scoped cache renders while network revalidation runs. Successful first pages replace cached-only entries; pagination retains real loaded pages. Cached details cannot cancel before a fresh snapshot. Account changes and same-frame notification opening are covered. |
| Hidden customer/staff views | Hidden history, cashier orders, stop-list and reports stop background reads and refresh on return. Kitchen events, sound and counters remain active. Selections and pending changes survive tab switches. |
| Delivery cart | Removed duplicate initial address lookup; ordering, quote, stock and payment validations still await authoritative responses. |
| Admin customers/orders/transactions | Opening, pagination and filter changes dispatch immediately. Only text entry is debounced. Old reads abort; generation guards reject late results. |
| Dashboard tables | One numeric collator per sort and a single normalized search value; memoized row calculation. Ordering, source-array immutability and large fixtures checked. |
| Dashboard stock | Four independent iiko reads overlap. Logout waits for all reads, including failures. No stock TTL was added. |
| Product sales | Independent product/department metadata reads overlap; branch checks still precede sales requests. |
| Photo calendar | Independent metadata reads overlap; full report pagination, role/branch scope, archived points and device status retained. |
| Global search/customer detail | Independent reads overlap; related results still wait for permitted customer IDs. No private search cache introduced. |
| Other flows | Existing suites exercise login/SMS/reset guards, profile/family/FAQ, catalog filtering/cart/reorder, payment/delivery states, support, notifications and staff flows. Existing coalescing, cache-first catalog, bounded image prefetch and paused hidden home/account polling retained. |
| Password recovery quota | Two accepted SMS-link reservations per normalized phone in a rolling 24-hour window, including resends and uncertain provider failures. Persistent database locks enforce the cap across concurrent workers and restart; registration keeps its existing limits. UI preserves the server deadline and shows hours/minutes. Real independent PostgreSQL connections and auth/UI regressions were checked without sending SMS. |
| Purchase reminders | Persistent customer/day claim and daily outbox deduplication; random daily Kazakhstan slot between 11:00 and 16:00. Retired legacy queues, expiry on all three push platforms, eligibility recheck, opt-out and other marketing caps. Actual migration and provider fixtures exercised; no test push sent. See purchase-reminder-scheduling.md. |

## Measurements

- Three actual new 1254px PNG photos: 2.15–2.50 MB originals; automatic upload creates 419–528 KB masters. 384px delivery was 183–216 KB lossless and is 48–67 KB in photo mode. Existing heavily compressed JPEGs can produce a larger high-quality master; client delivery remains sized for its view.
- Identical synthetic 25,000-row dashboard: numeric sort 486.56 → 20.60 ms; full search 13.00 → 5.70 ms.
- Identical delayed-read fixtures: stock 438.54 → 108.46 ms; global search 124.84 → 93.59 ms; customer detail 94.19 → 63.20 ms.
- Widget-clock fixtures: hidden order history previously made ten list requests in 60 seconds; hidden stop-list made two unnecessary reads in 30 seconds plus an event. Hidden refresh now waits for visibility, with one coalesced refresh on return.

Full Flutter, backend and admin unit suites were run once after implementation. Follow-up regressions cover issues found in independent review. Admin synthetic browser checks cover phone, tablet and desktop. The compiled Flutter release is checked locally in Chromium and WebKit with delayed photos and no real customer writes, orders or SMS.

Real network/iiko delays, device performance, camera permissions and third-party delivery remain external dependencies. No production load test or installed Android/iOS/Windows binary replacement is part of this web release. Source changes apply to native builds when those are built and installed.

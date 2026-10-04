# Purchase reminder timing

The existing `inactive` marketing automation now uses one persistent allowance per
customer and Kazakhstan calendar day, with a deterministic random slot between
11:00 and 15:50 in `Asia/Almaty`. The ten-minute marketing worker picks up that
slot within ten minutes; sending closes at 16:00. The slot changes with the date
and survives process restarts. Timezone database rules are used in PostgreSQL and
JavaScript, including historical offset changes; there is no fixed UTC offset.

Only the existing inactive-purchase audience is eligible: an active automation,
a non-deleted customer, at least one registered push installation, and a latest
paid order older than the automation's `inactiveHours` (48 by default). Existing
product selection and translations remain unchanged. Customers without previous
paid orders are not added. Promotional opt-out and quiet hours are respected.
Eligibility is checked again before provider delivery, including purchases made
after enqueueing, deleted customers and disabled automations.

The old rolling 24-hour restriction for previous **inactive** reminders is replaced
by calendar-day idempotency, so yesterday's late slot cannot force today's slot
back to the same time. The 24-hour suppression from other pending/sent marketing
types is retained and rechecked before sending. Birthdays, orders, bonus updates
and their schedules are unchanged.

There are two durable deduplication layers: `inactive_reminder_claims` has a unique
customer/day key independent of automation, text or purchase edits, and the push
outbox uses an explicit customer/day key. Existing outbox leases and uncertain
delivery handling still prevent automatic resending after an ambiguous provider
response. Without the outbox schema, reminders fail closed instead of using the
legacy immediate-delivery fallback. Each registered device can receive the same
one daily reminder; this is one notification event per customer, not a random
choice of one of their devices.

Expired daily reminders are skipped, including retries after a restart at 22:00.
Missed ten-minute slots are not drained in a catch-up burst: eligible customers
get a fresh random slot on a subsequent day. Opt-out, quiet hours, provider errors
or outages can result in no reminder that day. No more than one is attempted per
day per device unless a provider explicitly rejects an attempt before accepting
it. Ambiguous outcomes are not automatically resent.

Android and WebPush TTL and APNs absolute expiry stop provider storage at the
day's 16:00 boundary. Already accepted legacy messages cannot be recalled, and
the operating system ultimately controls when an accepted notification is shown.

## Cause and deployment

Before this change, `server.js` ran marketing every ten minutes, while
`enqueue_inactive_order_reminders` inserted a delivery scheduled immediately,
without a daytime window. Its rolling 24-hour cap could perpetuate a previous
evening send time. `22:00` was only the default start of optional quiet hours,
which were disabled by default; it was not a configured reminder cron time.
Inactive push envelopes also lacked a TTL.

A read-only production aggregate on 2026-10-04 confirmed active `inactive_default`,
`inactiveHours=48`, `maximumPerDay=1`, and no reminder timezone/window config.
Over the preceding 14 days the marketing ledger contained sent reminders at
15h (4), 16h (12), 17h (2), 22h (6), and 23h (2), Kazakhstan time. The outbox also
recorded actual sends at 22h and 23h. This confirms server-side evening dispatch,
not only delayed device delivery. No customer identifiers or tokens were read
into the report, and no push was sent during verification.

Apply additive migration `20261004193000_inactive_reminder_daytime.sql` before
starting the new workers. Stop old marketing/outbox workers during the migration
and reload so an already-running old process cannot deliver its legacy queue.
The migration preserves sent daily allowances, retires only legacy pending
inactive reminders and their unsent outbox entries, adds a private RLS-protected
claim table and service-role-only RPCs, and records the fixed window in inactive
automation config. It does not change automation activation, translations,
`inactiveHours`, customer balances or orders. No environment change is required.
The window is enforced in code/SQL; editing informational config fields alone
does not override it. The existing two-argument enqueue RPC remains compatible.

`outputs/reminder-daytime-2026-10-04/read-only-reminder-probe.sql` reads only
configuration, aggregate delivery hours, schema presence and RPC ACL/hash
metadata. Run it before and after release without invoking enqueue or send RPCs.

## Verification

`test/inactive-reminder-sql.test.js` executes the actual migration twice in PGlite
and exercises slot distribution, historical/current Kazakhstan timezone rules,
window boundaries, repeated workers, calendar rollover, rule deletion,
eligibility, other marketing caps, old queue migration and private RPC ACLs.
PGlite serializes queries; PostgreSQL's unique key/transaction supplies the
cross-process concurrency guarantee, not an external database load test.

`test/inactive-reminder-delivery.test.js` mocks every provider call and database
transport to verify expiry envelopes, opt-out/quiet hours, before/after-window
retries, restart, daily outbox deduplication, next-day delivery and schema failure.

# Delivery availability before checkout payment

The `delivery_availability` settings row persists a global stop when an actual
Yandex error explicitly reports insufficient funds. Public locations expose
`deliveryEnabled: false`; configured branch flags remain unchanged. Checkout
rechecks the stop before returning a delivery quote or creating a payment,
including free delivery and previously signed quotes. Pickup is unaffected.

Admin Orders and Dispatch show the warning. After verifying a credited top-up
in Yandex Business, an administrator can resume delivery. Resume requires the
current revision; a concurrent funds failure wins over a stale admin screen.
Reads fail closed for delivery. A failed stop write is retained locally and
retried. A database outage does not provide a reliable account-wide store.

At the owner's explicit request, checkout also performs a physical courier
probe on the selected branch-to-customer route: create, inspect the priced
claim, accept, immediately cancel. There is no artificial five-second sleep.
The next payment step requires both acknowledged acceptance and confirmed
free cancellation. A free-delivery order follows the same pre-payment check.
Actual customer orders and their couriers are separate from probe claims.

The migration `20260909190000_checkout_delivery_probes.sql` stores the request
ID and original payload before creation, and the claim ID and cancellation
deadline before acceptance. After five seconds, the cancellation worker can
take over. It also recovers after process restarts, always reusing an uncertain
creation's request ID; it never accepts draft claims. Lost cancellation
responses are reconciled through claim info. Pending cleanup blocks payment.
The worker must be enabled for new probes to run. Customer database roles
cannot access the table or its admission functions. Terminal rows clear the
address/contact payload, retaining only the audit IDs and status.

Confirmed successes are reused for the same customer and payload for two
minutes, invalidated by a subsequent balance-stop resume. Atomic admission
allows one active probe per customer, at most three globally, with a
30-second per-customer cooldown for changed routes and failed checks.
An overdue acceptance prevents additional physical probes. This avoids
repeated dispatches during UI refreshes or concurrent API retries.

Five seconds is a cleanup target, **not a provider response guarantee**.
A courier may accept sooner. If cancellation has become paid, Bulka cancels
at its expense and delivery is stopped for administrative review. Unavailable
cancellation remains queued, triggers the existing worker health alert path,
and also disables new delivery checkouts. No probe cost is charged to a client.

This mechanism does **not** read or reserve the corporate balance. Successful
acceptance only checks what the provider allows at that moment; it cannot
guarantee funds remain available when the real order later dispatches. The
customer's confirmed delivery price remains fixed even if the provider price
subsequently changes. Confirmed customer deliveries already in progress are
not cancelled by a global availability stop.

On 2026-09-09, an authorized support request asked for the available corporate
balance API and whether `claims/create` + `claims/info` can return a funds error
before `claims/accept`. Support escalated the question to development; no
technical answer was available at implementation time.

Provider documentation:

- [Claim acceptance](https://yandex.ru/support/delivery-profile/ru/api/express/openapi/IntegrationV2ClaimsAccept)
- [Express integration workflow](https://yandex.ru/support/delivery-profile/ru/api/express/quickstart)

Verification: the `checkout-delivery-probe`, `checkout-delivery-probe-store`,
`yandex-checkout-probe`, `checkout-delivery-payment` and `delivery-availability`
tests cover durable admission, restart cleanup, uncertain HTTP results,
immediate cancellation, paid cancellation, funds stops and payment blocking.
They use an isolated PostgreSQL runtime and fake provider transport; they do
not charge a bank card or dispatch real couriers.

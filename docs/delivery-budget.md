# Delivery budget

The owner confirmed an opening KZT budget of 5000 on 2026-09-09. The migration
inserts that amount once. Deploys, restarts and payment retries never reset it.
This ledger does not transfer money or place a hold on the Yandex account.

Each delivery payment requires an internal reservation equal to the courier
estimate plus 50%, rounded up to a whole tenge. A 1000 estimate reserves 1500,
leaving 3500 of the opening 5000 for other orders. Free customer deliveries
also reserve the full provider cost. The customer fee remains the signed
checkout fee; the buffer is funded by Bulka and never enters the receipt.

Quotes check available budget before any physical provider probe. Payment
admission atomically locks the singleton account, checks all outstanding
reservations and creates or reuses the checkout reservation. Concurrent
checkouts cannot allocate the same money. Missing or failed budget reads block
delivery; pickup continues to work. Old quotes without a courier estimate
require a fresh quote, but no mobile app update is required.

A marker is persisted before starting the bank payment. Unstarted orphan
reservations expire after 35 minutes. Unknown bank outcomes retain their
budget for reconciliation; they are not released just because a request
timed out. An order-save trigger links the reservation in the same database
transaction. A late payment must reacquire released budget before fulfilment;
otherwise the existing automatic refund path handles it.

Failed payments and cancelled orders release their reservations only when no
tracked courier expense remains unresolved. At real courier acceptance the
existing buffer can cover a higher price; any excess requires additional
available budget. Final provider costs are recorded once per job/probe.
Duplicate notifications do not charge the ledger twice. A cancellation bill
on an ongoing order is charged while retaining budget for a replacement.
Unknown final bills retain their reservation until reconciled. The monitored
`delivery-budget-reconciliation` worker retries every minute without creating,
accepting or cancelling any courier.

Owners see **Остаток / В резерве / Доступно** in Orders and Dispatch. **Учесть
пополнение** records money already credited in Yandex; **Сверить остаток**
corrects the ledger after provider expenses are settled. Both actions require
explicit amount confirmation and a fresh revision, and use an idempotency key.
They never release existing holds or clear a provider-triggered delivery stop.
Balances cannot be rebased while courier bills are unresolved, to avoid
deducting the same pending expense again after reconciliation.

The ledger depends on accurate confirmed top-ups and external spend. Manual
Yandex bookings outside Bulka must be reconciled. The 50% buffer is not a
provider price guarantee: a final bill above it can exhaust the budget and
block further deliveries. No mechanism here guarantees courier availability.

Validation includes executable PostgreSQL functions in PGlite, simultaneous
admission/retry cases, order lifecycle and final-cost accounting, bank-call
gates, free delivery, UI confirmation, stale revisions and denied permissions.

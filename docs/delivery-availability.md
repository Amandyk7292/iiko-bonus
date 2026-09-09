# Delivery availability after a provider funds error

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

This does **not** query or reserve the available Yandex balance. It cannot
prevent the first funds rejection or guarantee that funds remain available
between customer payment and courier dispatch. A successful price estimate,
draft claim, or cancelled claim is not proof of a funded delivery.

Do not use actual courier dispatches followed by a five-second cancellation as
a balance probe. `claims/accept` starts performer search; a cancellation request
can fail or have an uncertain result. Confirmed deliveries already in progress
are not cancelled by this availability stop.

On 2026-09-09, an authorized support request asked for the available corporate
balance API and whether `claims/create` + `claims/info` can return a funds error
before `claims/accept`. Support escalated the question to development; no
technical answer was available at implementation time.

Provider documentation:

- [Claim acceptance](https://yandex.ru/support/delivery-profile/ru/api/express/openapi/IntegrationV2ClaimsAccept)
- [Express integration workflow](https://yandex.ru/support/delivery-profile/ru/api/express/quickstart)

Verification: `test/delivery-availability.test.js` covers shared persistence,
stale resumes, storage failures, free deliveries, signed quotes and pickup.

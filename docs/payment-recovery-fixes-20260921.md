# Card linking and payment recovery

The Flutter payment payload is accepted by the API again. The server compares the
customer-confirmed total with the server-calculated total before creating a bank
payment; price changes return `CHECKOUT_QUOTE_CHANGED` for a refreshed confirmation.
Unsupported payment methods remain rejected rather than silently charging a card.

Checkout recovery now resolves the customer's client request id to the actual
bank operation. Read failures are not reported as missing payments. Completed
operations return their status without decrypting or reopening a bank checkout.

Saved-card revocation survives duplicate signed bank notifications. Reactivation
requires an explicit card-linking session started after revocation. Concurrent
updates are conditional on the status that was read.

An individual declined bank attempt does not finish an open checkout. Card setups
retain their recovery token until success and accept late success after a failure.
Concurrent setup verification cannot overwrite a newly finalized status with a
stale snapshot. The bank timeout covers headers and response-body reading.

The web payment page preserves a non-secret operation reference, uses short-lived
tab storage for reloads and can recover through the authenticated status API.
Checkout tokens are removed from the address and from tab storage on leaving.
Bank return and payment resume responses are private and non-cacheable.

Flutter persists a pending card setup per customer, resumes it instead of creating
another one, bounds automatic return verification to 20 seconds and distinguishes
an unknown result from a declined operation. Hosted fallback can be used without
first saving a card. Card-linking titles and the temporary 30 KZT verification
charge/refund explanation are localized in Russian, Kazakh and English.

Validation:

- Existing server suite: 1,193 cases; only the widget asset-version expectation
  needed updating. The complete HTTP app test file then passed (22/22).
- Added contract, signed-event, timeout, recovery and browser-script regression
  tests; payment-specific backend tests pass.
- Payment Flutter tests, including the new recovery/fallback cases, pass.
- Flutter analyzer: no issues. Backend lint: no errors, one pre-existing unused
  parameter warning in `wallet.service.js`.
- Chrome reload test preserved the same card setup with the bank SDK replaced by
  a local fixture; no real card details, charges or refunds were used.
- Four unrelated home/story layout tests also fail on an isolated archive of
  the previous release `27a8fddb`. They are not payment regressions.

This release updates the server and Flutter Web. Native-store publication and a
real bank/3-D Secure acceptance transaction are separate from these checks.

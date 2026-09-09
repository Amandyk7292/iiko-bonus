# Delivery pricing at checkout

Customers pay the delivery fee displayed at checkout together with their goods.
Delivery is free when the merchandise total after discounts is at least
10,000 KZT. Delivery fees do not count toward this threshold. Pickup has no
delivery fee; preorder delivery follows the same rule as immediate delivery.

Updated Flutter clients request a preliminary Yandex Cargo `check-price` estimate
for the validated branch, saved destination coordinates and canonical cart.
This request does not create an order, delivery job or courier claim. Estimates
must be in KZT and within the configured dispatch limit. Decimal estimates are
rounded up to whole tenge before they are displayed.

The server signs the estimate for 15 minutes and binds it to the customer,
branch, destination, schedule, merchandise and discount. Payment uses that
signed fee without calling Yandex again. Expired or changed quotes require a
refresh and another confirmation before any payment starts. A retry of an
existing checkout returns the original payment even if its quote has expired.

Installed older clients continue using their server-configured delivery-zone
estimate until updated; the 10,000 KZT threshold applies to them as well.
Clients cannot submit an arbitrary fee. Already created orders are not repriced.

The amount collected from the customer is stored in `kaspi_orders.delivery_fee`
and included in the payment and receipt total. Yandex's final cost remains in
`delivery_jobs.provider_price`. Bulka pays Yandex through its corporate account
and absorbs any difference. Provider prices are excluded from customer order
responses and never become a later customer surcharge.

Tests cover threshold boundaries, discounts, pickup/preorder, quote integrity,
expiry, idempotent retries, the 1000-to-1500 KZT overage example, provider payloads,
and the customer-visible fee. Flutter API tests verify the quote token is carried
into saved-card checkout without accepting a client-supplied fee.

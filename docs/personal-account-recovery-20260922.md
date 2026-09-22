# Personal account API restoration

The installed app already requested the personal-account endpoints, and the
prepaid ledger migration was present in production, but its API handlers were
missing. Reading the balance therefore failed before a top-up could start.

This release connects the existing ledger to authenticated account/history,
top-up creation/status, account-funded checkout and refund endpoints. A top-up
has a persisted customer-scoped request id before a bank checkout is created.
Only a server-queried Forte transaction with the matching checkout token,
tracking id, shop, currency, amount and test mode can credit funds. Bank callbacks
remain signature protected. Duplicate credit, debit and refund requests are
serialized by the existing PostgreSQL ledger functions. Loyalty balances remain
separate. Reversals that overdraw prepaid funds block further spending.

Reservations are attached before an account-funded checkout debits money.
Interrupted paid orders and top-ups are reconciled by the scheduled worker.
Completed cash-ledger payments never reopen a bank checkout. The hosted payment
shell labels account funding separately and returns to the personal account.
Funding does not request a saved-card contract or save the customer's card.

Validation includes the actual PL/pgSQL migration in isolated PGlite, duplicate
funding/payment/refund requests, insufficient funds, account ownership, ledger
immutability, bank amount mismatch and checkout-reservation ordering. No real
card charge was initiated by these checks.

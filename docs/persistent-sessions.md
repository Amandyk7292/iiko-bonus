# Persistent customer and staff login

Customer refresh sessions have no automatic expiry by default. Access JWTs remain
short lived (15 minutes). `CUSTOMER_REFRESH_TOKEN_DAYS=1..365` can explicitly restore
a finite refresh lifetime. Logout, account deletion and credential version changes
still prevent refresh. Migration extends only currently active, unexpired sessions.

Native clients commit both tokens in one secure storage record and migrate the old
keys on first launch. A device proof is persisted before refresh. The server stores
its hash so an interrupted rotation can recover its deterministic successor even
after a restart or app update. A proof alone cannot authenticate. Browser refresh
tokens remain HttpOnly; JavaScript stores only the separate proof and a tab-scoped
access token. Logout also revokes successors of an older refresh token.

Admin/staff credentials identify a database session. The middleware verifies the
JWT signature, issuer and audience, then checks the session record, current profile,
permissions and credential version. The record is the authority for expiry:
PostgreSQL `infinity` means persistent and preserves staff push expiry comparisons.
An expired JWT alone is never sufficient to gain access. Temporary WhatsApp
operator links retain their finite lifetime. Revoked and already expired sessions
are not revived during migration.

Browser cookies are renewed for 400 days on customer refresh and admin session
restoration. Deployments do not rotate signing secrets or change storage keys.
Browser/OS data deletion or secret rotation can still require a new login.

Temporary database/network/storage failures preserve credentials. The web apps
retry restoration; only a confirmed invalid session shows the login flow. Delayed
customer responses cannot replace a newer login, and stale admin 401 responses
cannot dismiss a subsequent successful login.

Verification: customer concurrency/revocation tests, admin middleware lifetime and
outage tests, actual PostgreSQL migrations via PGlite, Flutter secure-storage and
session race tests, and `test/flutter_session_persistence_e2e.py` against the compiled
web app in Chromium and WebKit with all HTTP traffic intercepted locally.

# Per-branch iikoFront loyalty authentication rollout

The shared `IIKO_LOYALTY_API_TOKEN` is not a branch identity. Every terminal must
also use an independently rotatable `IIKO_BRANCH_POS_TOKEN` before strict
enforcement is enabled.

## Safe rollout

1. Deploy the migration and application with
   `LOYALTY_BRANCH_POS_ENFORCEMENT=compatibility`. This preserves legacy core
   loyalty requests while accepting and auditing branch-authenticated requests.
   Pickup handoff and gift-card POS routes remain strict in both modes.
   Compatibility is a temporary migration state, not closure of the original
   shared-token risk: legacy requests still have no branch identity. Per-order
   safety caps apply to both modes, but atomic rolling limits apply only to
   branch-authenticated requests.
2. In the admin location screen, rotate the POS credential once for every
   active branch. The plaintext token is displayed only in that response. Put
   the matching values into that branch's iikoFront plugin configuration:
   `IIKO_BRANCH_ID` and `IIKO_BRANCH_POS_TOKEN`.
3. Restart the plugin and confirm that its status reports both the shared token
   and branch key as configured. Do not copy one branch token to another branch.
4. Check `/internal/readiness`: `configuredActiveBranches` must equal
   `activeBranches`, `missingActiveBranches` must be zero, and
   `activeLegacyReservations` must be zero. Only then can
   `readyForEnforcement` be true.
5. Observe the protected Prometheus metrics over a complete operating period.
   `bulka_loyalty_pos_auth_requests_total{mode="branch"}` must increase and the
   `mode="legacy"` counter must stop increasing. Drain or cancel any legacy
   loyalty reservations before switching modes; reservations expire after 24
   hours. Required mode deliberately fails readiness while even one active
   legacy reservation remains.
6. Set `LOYALTY_BRANCH_POS_ENFORCEMENT=required` and restart the application.
   Readiness becomes unhealthy if any active branch lacks a credential. Requests
   without a valid branch ID and token fail closed with HTTP 401.
7. Rotate the old global `API_SECRET`/`IIKO_LOYALTY_API_TOKEN`, distribute the new
   value to every terminal through the protected configuration channel, and
   verify branch-authenticated traffic again.

## Fraud-containment limits

The server rejects one POS transaction above the configured order, discount or
earned-bonus caps. PostgreSQL also atomically limits each authenticated branch's
rolling 24-hour order count, order total, discounts and earned bonuses. Configure
the `LOYALTY_POS_MAX_*` and `LOYALTY_POS_BRANCH_ROLLING_*` values from verified
branch turnover before enabling strict mode. A retry of the same reservation is
idempotent and does not consume the rolling allowance twice.

These controls bound the damage from a stolen terminal credential, but they do
not prove that an iiko sale exists: the terminal still supplies the order lines
and total. Keep anomaly alerts and daily reconciliation against iiko reports;
server-side iiko order verification is the remaining stronger control if the
business later permits that integration.

As of the 10 August 2026 read-only production preflight, 17 branches were active
and zero active branch POS credentials existed. Strict mode must not be enabled
until provisioning and terminal verification are complete.

const crypto = require('node:crypto');
const { logger } = require('../config/logger');
const { CheckoutDeliveryProbeStore } = require('./checkout-delivery-probe-store');
const { deliveryAvailability, unavailableError } = require('./delivery-availability.service');

const CANCELLED = new Set(['cancelled', 'cancelled_with_payment', 'cancelled_by_taxi']);
const DRAFT = new Set(['new', 'estimating', 'ready_for_approval']);
const REJECTED = new Set(['failed', 'estimating_failed', 'performer_not_found']);
const ACTIVE = new Set([
  'accepted',
  'performer_lookup',
  'performer_draft',
  'performer_found',
  'pickup_arrived',
  'ready_for_pickup_confirmation',
]);
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const fingerprint = (payload) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(payload)))
    .digest('hex');

class CheckoutDeliveryProbeService {
  constructor({
    store = new CheckoutDeliveryProbeStore(),
    availability = deliveryAvailability,
    transport = () => require('./yandex-delivery.service').createCheckoutProbeTransport(),
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {}) {
    Object.assign(this, { store, availability, transport, now, sleep });
    this.inFlight = new Map();
    this.cleaning = false;
  }

  timestamp() {
    return new Date(this.now()).toISOString();
  }

  async ensure(context) {
    const state = await this.availability.get();
    if (state.disabled) throw unavailableError();
    const transport = this.transport();
    const payload = transport.prepare(context);
    const hash = fingerprint(payload);
    const key = `${context.customerId}:${hash}`;
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const task = this.check(context, payload, hash, state.resumedAt, transport);
    this.inFlight.set(key, task);
    try {
      return await task;
    } finally {
      this.inFlight.delete(key);
    }
  }

  async check(context, payload, hash, after, transport) {
    let result;
    try {
      result = await this.store.acquire(
        context.customerId,
        hash,
        payload,
        crypto.randomUUID(),
        after,
      );
      if (result?.kind === 'created') await this.run(result.probe, transport);
      else if (result?.kind !== 'cached') throw unavailableError();
      await this.availability.assertAvailable(context.checkout);
      return { probeId: result.probe.id };
    } catch (error) {
      logger.warn(
        {
          event: 'checkout_delivery_probe_failed',
          probeId: result?.probe?.id,
          code: error.code || 'PROBE_UNAVAILABLE',
        },
        'Checkout delivery probe did not succeed',
      );
      throw unavailableError();
    }
  }

  async finish(probe, info, accepted = false) {
    const status = info?.status || 'unknown';
    // A cancelled claim alone is not proof that a new courier was accepted.
    const success = accepted && status === 'cancelled';
    const finished = await this.store.patch(probe, {
      state: success ? 'complete' : 'rejected',
      provider_status: status,
      accepted_at: accepted ? probe.accepted_at || probe.accept_attempted_at : null,
      cancelled_at: CANCELLED.has(status) ? this.timestamp() : null,
      checked_at: this.timestamp(),
      request_payload: null,
      lease_token: null,
      last_error: success ? null : status,
    });
    await require('./delivery-budget.service')
      .deliveryBudget.observeProbe(finished)
      .catch(() => {});
    return finished;
  }

  async defer(probe, error) {
    try {
      await this.store.patch(probe, {
        last_error: String(error?.code || 'PROBE_CANCELLATION_UNCONFIRMED').slice(0, 100),
        lease_until: new Date(this.now() + 1000).toISOString(),
      });
    } catch {
      // The persisted claim/request ID remains available to the next lease.
    }
  }

  async run(probe, transport) {
    let current = probe;
    let info;
    let acceptanceAcknowledged = false;
    try {
      info = await transport.create(current);
      if (!info?.id) throw unavailableError();
      current = await this.store.patch(current, {
        external_claim_id: info.id,
        state: 'evaluating',
        provider_status: info.status,
      });
      for (let attempt = 0; attempt < 4 && info.status !== 'ready_for_approval'; attempt++) {
        await this.availability.recordProviderFailure(info);
        if (REJECTED.has(info.status)) {
          await this.finish(current, info);
          throw unavailableError();
        }
        await this.sleep(250);
        info = await transport.info(current.external_claim_id);
      }
      if (info.status !== 'ready_for_approval') throw unavailableError();
      transport.validatePrice(info);
      await this.availability.assertAvailable({ effectiveFulfillmentType: 'delivery' });
      // Persist cleanup BEFORE acceptance. A worker may take over after 5s,
      // even if the accepting HTTP process disappears or its response is lost.
      current = await this.store.patch(current, {
        state: 'cancelling',
        accept_attempted_at: this.timestamp(),
        lease_until: new Date(this.now() + 5000).toISOString(),
      });
      try {
        const accepted = await transport.accept(current.external_claim_id, info.version);
        acceptanceAcknowledged = ACTIVE.has(accepted?.status);
        info = { ...info, ...accepted };
      } catch (error) {
        await this.availability.recordProviderFailure(error);
        // An uncertain accept must still be cancelled, never retried here.
      }
      // No artificial delay and no DB write between accept and cancellation.
      const cancelled = await this.cancel(current, transport, info, true);
      acceptanceAcknowledged ||= cancelled.accepted;
      if (!cancelled.closed) throw unavailableError();
      await this.finish(current, cancelled.info, acceptanceAcknowledged);
      if (!acceptanceAcknowledged || cancelled.info.status !== 'cancelled')
        throw unavailableError();
    } catch (error) {
      await this.availability.recordProviderFailure(error);
      if (
        !current.external_claim_id &&
        [400, 401, 403, 422].includes(error.details?.providerStatus)
      ) {
        await this.finish(current, { status: 'failed' }).catch(() => {});
      }
      // Drafts were never offered to a courier. The janitor resolves unknown
      // creates using the SAME request ID and never accepts a draft.
      await this.defer(current, error);
      throw error;
    }
  }

  async cancel(probe, transport, info, immediate = false) {
    let accepted = Boolean(probe.accepted_at) || ACTIVE.has(info?.status);
    if (immediate) {
      try {
        info = await transport.cancel(probe.external_claim_id, info.version, 'free');
        if (!CANCELLED.has(info?.status)) info = await transport.info(probe.external_claim_id);
      } catch {
        info = await transport.info(probe.external_claim_id);
      }
    }
    accepted ||= ACTIVE.has(info?.status);
    await this.availability.recordProviderFailure(info);
    if (CANCELLED.has(info?.status) || REJECTED.has(info?.status)) {
      if (info.status === 'cancelled_with_payment') {
        await this.availability.suspend('probe_paid_cancellation');
      }
      return { closed: true, info, accepted };
    }
    if (DRAFT.has(info?.status)) {
      // Cancellation only supports confirmed claims. If accept timed out, its
      // request may still finish. Watch until the offer has certainly expired.
      const elapsed = this.now() - Date.parse(probe.accept_attempted_at || probe.created_at);
      return {
        closed: !probe.accept_attempted_at || elapsed > 20 * 60 * 1000,
        info,
        accepted: false,
      };
    }
    const conditions = await transport.cancelInfo(probe.external_claim_id);
    if (!['free', 'paid'].includes(conditions.cancel_state)) {
      await this.availability.suspend('probe_cancellation_attention');
      throw unavailableError();
    }
    // Cancellation already authorized: stop even if a courier arrived early.
    // A paid probe is charged to Bulka and disables additional probes.
    if (conditions.cancel_state === 'paid') {
      await this.availability.suspend('probe_paid_cancellation');
      const { verifiedMoney } = require('./delivery-budget-cost');
      const cost =
        conditions.currency === 'KZT'
          ? verifiedMoney(conditions.price_with_vat ?? conditions.price)
          : null;
      if (cost != null) probe = await this.store.patch(probe, { budget_final_cost: cost });
    }
    const response = await transport.cancel(
      probe.external_claim_id,
      info.version,
      conditions.cancel_state,
    );
    info = CANCELLED.has(response?.status)
      ? response
      : await transport.info(probe.external_claim_id);
    return { closed: CANCELLED.has(info.status), info, accepted };
  }

  async cleanup() {
    if (this.cleaning) return;
    this.cleaning = true;
    let unresolved = 0;
    try {
      const transport = this.transport();
      for (let attempt = 0; attempt < 3; attempt++) {
        let probe = await this.store.lease(crypto.randomUUID());
        if (!probe) break;
        try {
          if (!probe.external_claim_id) {
            // Provider requires the original request_id after a lost response.
            const created = await transport.create(probe);
            if (!created?.id) throw unavailableError();
            probe = await this.store.patch(probe, { external_claim_id: created.id });
          }
          const info = await transport.info(probe.external_claim_id);
          const result = await this.cancel(probe, transport, info);
          if (result.closed) {
            // Recovery never turns an uncertain check into a payment approval.
            await this.finish(probe, result.info, false);
          } else {
            await this.defer(probe, unavailableError());
            if (probe.accept_attempted_at) unresolved++;
          }
        } catch (error) {
          await this.availability.recordProviderFailure(error);
          if (
            !probe.external_claim_id &&
            [400, 401, 403, 422].includes(error.details?.providerStatus)
          ) {
            await this.finish(probe, { status: 'failed' }).catch(() => {});
          }
          await this.defer(probe, error);
          unresolved++;
          logger.error(
            {
              event: 'delivery_probe_cleanup_pending',
              probeId: probe.id,
              claimId: probe.external_claim_id,
              code: error.code || 'PROBE_CLEANUP_PENDING',
            },
            'Courier probe cancellation needs another attempt',
          );
        }
      }
      if (unresolved)
        throw Object.assign(new Error('Courier probe cleanup remains pending'), {
          code: 'DELIVERY_PROBE_CLEANUP_PENDING',
        });
    } finally {
      this.cleaning = false;
    }
  }
}

const checkoutDeliveryProbe = new CheckoutDeliveryProbeService();
module.exports = { CheckoutDeliveryProbeService, checkoutDeliveryProbe, fingerprint };

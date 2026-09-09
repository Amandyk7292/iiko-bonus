const { supabase } = require('../config/supabase');

class CheckoutDeliveryProbeStore {
  constructor(db = supabase) {
    this.db = db;
  }

  async acquire(customerId, routeHash, payload, lease, after) {
    const { data, error } = await this.db.rpc('acquire_checkout_delivery_probe', {
      p_customer_id: customerId,
      p_route_hash: routeHash,
      p_payload: payload,
      p_lease_token: lease,
      p_after: after || null,
    });
    if (error) throw error;
    return data;
  }

  async lease(lease) {
    const { data, error } = await this.db.rpc('lease_checkout_delivery_probe', {
      p_lease_token: lease,
    });
    if (error) throw error;
    return data;
  }

  async patch(probe, values) {
    const now = new Date().toISOString();
    const { data, error } = await this.db
      .from('checkout_delivery_probes')
      .update({ ...values, updated_at: now })
      .eq('id', probe.id)
      .eq('lease_token', probe.lease_token)
      .gt('lease_until', now)
      .not('state', 'in', '(complete,rejected)')
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data)
      throw Object.assign(new Error('Delivery probe lease lost'), { code: 'PROBE_LEASE_LOST' });
    return data;
  }
}

module.exports = { CheckoutDeliveryProbeStore };

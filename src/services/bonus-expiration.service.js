const DAY_MS = 24 * 60 * 60 * 1000;

async function loadBonusActivity(client, customers) {
  const activity = new Map();
  for (let offset = 0; offset < customers.length; offset += 500) {
    const { data, error } = await client.rpc('customer_bonus_activity', {
      p_customer_ids: customers.slice(offset, offset + 500).map((customer) => customer.id),
    });
    if (error) throw new Error(error.message);
    for (const row of data || []) activity.set(row.customer_id, row.last_activity_at);
  }
  return activity;
}

async function listPositiveCustomers(client) {
  const customers = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client
      .from('customers')
      .select('*')
      .gt('balance', 0)
      .order('id')
      .range(offset, offset + 499);
    if (error) throw new Error(error.message);
    customers.push(...(data || []));
    if (!data || data.length < 500) return customers;
  }
}

async function attachBonusExpiration(client, customers, settings) {
  const policy = settings.bonus_expiration || {};
  const enabled = policy.enabled !== false && policy.auto_write_off !== false;
  const days = Number(policy.expiration_days || 90);
  const activity = enabled
    ? await loadBonusActivity(
        client,
        customers.filter((customer) => Number(customer.balance) > 0),
      )
    : new Map();
  return customers.map((customer) => {
    const lastActivity = activity.get(customer.id) || customer.created_at;
    const timestamp = Date.parse(lastActivity || '');
    return {
      ...customer,
      bonus_expiration_enabled: enabled,
      bonus_expiration_days: days,
      bonus_expires_at:
        enabled && Number(customer.balance) > 0 && Number.isFinite(timestamp)
          ? new Date(timestamp + days * DAY_MS).toISOString()
          : null,
    };
  });
}

module.exports = { attachBonusExpiration, loadBonusActivity, listPositiveCustomers };

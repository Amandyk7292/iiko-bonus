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
  const forecasts = new Map();
  const positive = customers.filter((customer) => Number(customer.balance) > 0);
  if (enabled) {
    for (let offset = 0; offset < positive.length; offset += 500) {
      const { data, error } = await client.rpc('bonus_expiry_customer_forecasts', {
        p_customer_ids: positive.slice(offset, offset + 500).map((customer) => customer.id),
      });
      if (error) throw new Error(error.message);
      for (const row of data || []) forecasts.set(row.customer_id, row);
    }
  }
  return customers.map((customer) => {
    const forecast = forecasts.get(customer.id);
    return {
      ...customer,
      bonus_expiration_enabled: enabled,
      bonus_expiration_months: 6,
      bonus_expires_at: forecast?.next_expiry_at || null,
      bonus_expiring_amount: Math.max(0, Number(forecast?.expiring_amount || 0)),
    };
  });
}

module.exports = { attachBonusExpiration, loadBonusActivity, listPositiveCustomers };

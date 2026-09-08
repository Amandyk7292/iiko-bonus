const { supabase } = require('../config/supabase');
const { sendPushToCustomer } = require('./push.service');

// Count people separately from devices, and never call zero deliveries a send.
async function broadcastCustomerPush(
  titles,
  bodies,
  { db = supabase, send = sendPushToCustomer } = {},
) {
  const summary = {
    count: 0,
    deliveredDevices: 0,
    queuedCount: 0,
    savedCount: 0,
    totalTokens: 0,
    skippedPreferences: 0,
  };
  for (let offset = 0; ; offset += 250) {
    const { data: customers, error } = await db
      .from('customers')
      .select('id,fcm_token,preferred_language')
      .order('id')
      .range(offset, offset + 249);
    if (error) throw error;
    if (!customers?.length) break;
    const language = (customer) =>
      ['kk', 'en'].includes(customer.preferred_language) ? customer.preferred_language : 'ru';
    const { data: saved, error: saveError } = await db
      .from('customer_notifications')
      .insert(
        customers.map((customer) => ({
          customer_id: customer.id,
          title: titles[language(customer)],
          body: bodies[language(customer)],
          type: 'broadcast',
          payload: { i18n: { titles, bodies } },
        })),
      )
      .select('id,customer_id');
    if (saveError) throw saveError;
    summary.savedCount += customers.length;
    const notificationIds = new Map((saved || []).map((row) => [row.customer_id, row.id]));
    for (let start = 0; start < customers.length; start += 25) {
      const outcomes = await Promise.all(
        customers
          .slice(start, start + 25)
          .map((customer) =>
            send(
              customer.id,
              titles[language(customer)],
              bodies[language(customer)],
              { notificationId: String(notificationIds.get(customer.id) || ''), type: 'broadcast' },
              customer.fcm_token,
            ),
          ),
      );
      for (const outcome of outcomes) {
        summary.count += outcome.delivered > 0 ? 1 : 0;
        summary.deliveredDevices += Number(outcome.delivered || 0);
        summary.totalTokens += Number(outcome.attempted || 0);
        summary.queuedCount += outcome.queued ? 1 : 0;
        summary.skippedPreferences += outcome.skipped === 'preferences' ? 1 : 0;
      }
    }
    if (customers.length < 250) break;
  }
  const status =
    summary.queuedCount > 0
      ? 'queued'
      : summary.count > 0
        ? summary.deliveredDevices < summary.totalTokens
          ? 'partial'
          : 'sent'
        : summary.totalTokens > 0
          ? 'failed'
          : 'no_recipients';
  return {
    success: status === 'sent' || status === 'partial' || status === 'queued',
    status,
    ...summary,
  };
}

module.exports = { broadcastCustomerPush };

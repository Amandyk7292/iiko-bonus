const { randomUUID } = require('node:crypto');
const { supabase } = require('../config/supabase');

async function saveCustomerNotification(fields, { db = supabase } = {}) {
  const record = { ...fields, id: randomUUID() };
  let failure;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Reuse the ID if the database saved the row before the response was lost.
      const { error, status } = await db
        .from('customer_notifications')
        .upsert(record, { onConflict: 'id', ignoreDuplicates: true })
        .abortSignal(AbortSignal.timeout(4000));
      if (!error) return record.id;
      failure = error;
      if (status !== 0 && status !== 408 && !(status >= 500)) break;
    } catch (error) {
      failure = error;
    }
  }
  console.error(
    'Customer notification could not be saved:',
    fields.type,
    failure?.code || 'unknown',
  );
  return '';
}

module.exports = { saveCustomerNotification };

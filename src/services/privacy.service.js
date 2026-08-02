const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const { notFound } = require('../utils/app-error.util');

const DIRECT_EXPORT_RELATIONS = Object.freeze([
  ['transactions', 'transactions', 'customer_id'],
  ['orders', 'kaspi_orders', 'customer_id'],
  ['paymentReceipts', 'payment_receipts', 'customer_id'],
  ['addresses', 'customer_addresses', 'customer_id'],
  ['favorites', 'customer_favorites', 'customer_id'],
  ['recentlyViewed', 'customer_recent_products', 'customer_id'],
  ['cart', 'customer_cart_snapshots', 'customer_id'],
  ['notifications', 'customer_notifications', 'customer_id'],
  ['appEvents', 'customer_app_events', 'customer_id'],
  ['marketingDeliveries', 'marketing_deliveries', 'customer_id'],
  ['reviews', 'order_reviews', 'customer_id'],
  ['referralCodes', 'referral_codes', 'customer_id'],
  ['referralRedemptions', 'referral_redemptions', 'referred_customer_id'],
  ['promotionRedemptions', 'promotion_redemptions', 'customer_id'],
  ['giftCardTransactions', 'gift_card_transactions', 'customer_id'],
  ['inventoryReservations', 'inventory_reservations', 'customer_id'],
  ['fulfillmentReservations', 'fulfillment_slot_reservations', 'customer_id'],
  ['loyaltyReservations', 'loyalty_reservations', 'customer_id'],
  ['support', 'customer_support_requests', 'customer_id'],
  ['notificationPreferences', 'customer_notification_preferences', 'customer_id'],
  ['whatsappConversations', 'whatsapp_conversations', 'customer_id'],
  ['whatsappOutbox', 'whatsapp_outbox', 'customer_id'],
]);

async function readRowsByColumn(db, table, column, value, columns = '*') {
  const { data, error } = await db.from(table).select(columns).eq(column, value);
  if (error) throw error;
  return data || [];
}

async function readRowsIn(db, table, column, values, columns = '*') {
  if (!values.length) return [];
  const { data, error } = await db.from(table).select(columns).in(column, values);
  if (error) throw error;
  return data || [];
}

async function readRowsOr(db, table, expression, columns = '*') {
  const { data, error } = await db.from(table).select(columns).or(expression);
  if (error) throw error;
  return data || [];
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = String(row?.id || JSON.stringify(row));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function attachmentPaths(rows) {
  return rows.flatMap((row) =>
    (Array.isArray(row?.attachments) ? row.attachments : [])
      .map((item) => String(item?.path || item || '').trim())
      .filter(Boolean),
  );
}

function outboxStoragePaths(rows) {
  return rows.map((row) => String(row?.payload?.storagePath || '').trim()).filter(Boolean);
}

async function removeStoragePaths(db, bucket, paths) {
  const uniquePaths = [...new Set(paths)];
  for (let offset = 0; offset < uniquePaths.length; offset += 100) {
    const { error } = await db.storage.from(bucket).remove(uniquePaths.slice(offset, offset + 100));
    if (error) throw error;
  }
}

async function exportCustomerData(customerId, { db = supabase, now = () => new Date() } = {}) {
  const { data: customer, error } = await db
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!customer) throw notFound('CUSTOMER_NOT_FOUND', 'Профиль не найден');

  const relationEntries = await Promise.all(
    DIRECT_EXPORT_RELATIONS.map(async ([key, table, column]) => [
      key,
      await readRowsByColumn(db, table, column, customerId),
    ]),
  );
  const related = Object.fromEntries(relationEntries);
  const orderIds = related.orders.map((row) => row.id).filter(Boolean);
  const reviewIds = related.reviews.map((row) => row.id).filter(Boolean);
  const supportIds = related.support.map((row) => row.id).filter(Boolean);
  const conversationIds = related.whatsappConversations.map((row) => row.id).filter(Boolean);
  const referralCodeIds = related.referralCodes.map((row) => row.id).filter(Boolean);

  const [
    partialRefunds,
    reviewItems,
    supportMessages,
    whatsappMessages,
    whatsappMemories,
    referredByCode,
    giftCards,
  ] = await Promise.all([
    readRowsIn(db, 'order_partial_refunds', 'order_id', orderIds),
    readRowsIn(db, 'order_review_items', 'review_id', reviewIds),
    readRowsIn(db, 'customer_support_messages', 'request_id', supportIds),
    readRowsIn(db, 'whatsapp_messages', 'conversation_id', conversationIds),
    readRowsIn(db, 'whatsapp_memories', 'conversation_id', conversationIds),
    readRowsIn(db, 'referral_redemptions', 'referral_code_id', referralCodeIds),
    readRowsOr(
      db,
      'gift_cards',
      `purchaser_customer_id.eq.${customerId},recipient_customer_id.eq.${customerId}`,
    ),
  ]);
  const refundItems = await readRowsIn(
    db,
    'order_partial_refund_items',
    'refund_id',
    partialRefunds.map((row) => row.id).filter(Boolean),
  );

  const generatedAt = now().toISOString();
  const payload = {
    generatedAt,
    formatVersion: 2,
    customer,
    ...related,
    partialRefunds,
    refundItems,
    reviewItems,
    supportMessages,
    whatsappMessages,
    whatsappMemories,
    giftCards,
    referralRedemptions: uniqueRows([...related.referralRedemptions, ...referredByCode]),
  };

  const { error: purgeError } = await db.rpc('purge_expired_customer_exports');
  if (purgeError) throw purgeError;

  const { data: request, error: requestError } = await db
    .from('customer_privacy_requests')
    .insert({
      customer_id: customerId,
      request_type: 'export',
      status: 'completed',
      export_payload: null,
      export_expires_at: generatedAt,
      payload_purged_at: generatedAt,
      completed_at: generatedAt,
    })
    .select('id')
    .single();
  if (requestError) throw requestError;
  return { requestId: request.id, ...payload };
}

async function deleteCustomerData(customerId, { db = supabase, now = () => new Date() } = {}) {
  const { data: customer, error: readError } = await db
    .from('customers')
    .select('id,phone,deleted_at')
    .eq('id', customerId)
    .maybeSingle();
  if (readError) throw readError;
  if (!customer) return true;

  const { data: request, error: requestError } = await db
    .from('customer_privacy_requests')
    .insert({ customer_id: customerId, request_type: 'delete', status: 'processing' })
    .select('id')
    .single();
  if (requestError) throw requestError;

  try {
    const supportRows = await readRowsByColumn(
      db,
      'customer_support_requests',
      'customer_id',
      customerId,
      'id,attachments',
    );
    const supportMessages = await readRowsIn(
      db,
      'customer_support_messages',
      'request_id',
      supportRows.map((row) => row.id).filter(Boolean),
      'attachments',
    );
    const whatsappOutbox = await readRowsByColumn(
      db,
      'whatsapp_outbox',
      'customer_id',
      customerId,
      'payload',
    );

    await removeStoragePaths(db, 'support-attachments', [
      ...attachmentPaths(supportRows),
      ...attachmentPaths(supportMessages),
    ]);
    await removeStoragePaths(db, 'whatsapp-outbox', outboxStoragePaths(whatsappOutbox));

    const deletedPhone = `deleted-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const { error: deleteError } = await db.rpc('delete_customer_personal_data', {
      p_customer_id: customerId,
      p_deleted_phone: deletedPhone,
      p_request_id: request.id,
    });
    if (deleteError) throw deleteError;
    return true;
  } catch (error) {
    await db
      .from('customer_privacy_requests')
      .update({
        status: 'failed',
        error: String(error.message).slice(0, 1000),
        completed_at: now().toISOString(),
      })
      .eq('id', request.id);
    throw error;
  }
}

module.exports = {
  DIRECT_EXPORT_RELATIONS,
  deleteCustomerData,
  exportCustomerData,
};

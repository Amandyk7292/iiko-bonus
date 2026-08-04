const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const realtime = require('./realtime.service');

const OUTBOX_BUCKET = 'whatsapp-outbox';
const MAX_TEXT_LENGTH = 10_000;
const DISABLED_AUTOMATED_SOURCE_TYPES = new Set(['payment_receipt']);

const cleanText = (value, maxLength) =>
  String(value || '')
    .trim()
    .slice(0, maxLength);

const digest = (value) =>
  crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex');

function whatsappOutboxDedupeKey(scope, ...parts) {
  const prefix =
    String(scope || 'message')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'message';
  return `${prefix}:${digest(parts.map((part) => String(part || '')).join('\u001f')).slice(0, 56)}`;
}

function whatsappProviderMessageId(outboxId) {
  return `BLK${digest(outboxId).slice(0, 24).toUpperCase()}`;
}

function retryDelaySeconds(attemptCount) {
  const attempt = Math.max(1, Number(attemptCount) || 1);
  return Math.min(15 * 2 ** (attempt - 1), 15 * 60);
}

function normalizeOutbox(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    dedupeKey: row.dedupe_key,
    chatJid: row.chat_jid,
    messageType: row.message_type,
    sourceType: row.source_type,
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
    status: row.status,
    attemptCount: Number(row.attempt_count || 0),
    maxAttempts: Number(row.max_attempts || 8),
    nextAttemptAt: row.next_attempt_at,
    providerMessageId: row.provider_message_id || null,
    lastError: row.last_error || null,
    sentAt: row.sent_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findOutboxByDedupeKey(dedupeKey, { db = supabase } = {}) {
  const { data, error } = await db
    .from('whatsapp_outbox')
    .select('*')
    .eq('dedupe_key', dedupeKey)
    .maybeSingle();
  if (error) throw error;
  return normalizeOutbox(data);
}

async function insertOutbox(record, { db = supabase } = {}) {
  const { data, error } = await db.from('whatsapp_outbox').insert(record).select('*').single();
  if (error?.code === '23505') {
    return findOutboxByDedupeKey(record.dedupe_key, { db });
  }
  if (error) throw error;
  return normalizeOutbox(data);
}

async function enqueueWhatsAppText(
  { chatJid, text, dedupeKey, sourceType = 'system', maxAttempts = 8, metadata = {} },
  { db = supabase } = {},
) {
  const normalizedChatJid = cleanText(chatJid, 255);
  const normalizedText = cleanText(text, MAX_TEXT_LENGTH);
  if (!normalizedChatJid) throw new Error('WhatsApp chat JID is required');
  if (!normalizedText) throw new Error('WhatsApp message text is required');
  const normalizedDedupeKey =
    cleanText(dedupeKey, 200) ||
    whatsappOutboxDedupeKey('text', normalizedChatJid, normalizedText, Date.now());
  return insertOutbox(
    {
      dedupe_key: normalizedDedupeKey,
      chat_jid: normalizedChatJid,
      message_type: 'text',
      source_type: cleanText(sourceType, 40) || 'system',
      payload: {
        text: normalizedText,
        metadata:
          metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
      },
      max_attempts: Math.min(20, Math.max(1, Number(maxAttempts) || 8)),
    },
    { db },
  );
}

async function enqueueWhatsAppVoice(
  {
    chatJid,
    audio,
    durationSeconds,
    dedupeKey,
    sourceType = 'operator',
    maxAttempts = 8,
    metadata = {},
  },
  { db = supabase } = {},
) {
  const normalizedChatJid = cleanText(chatJid, 255);
  if (!normalizedChatJid) throw new Error('WhatsApp chat JID is required');
  if (!Buffer.isBuffer(audio) || audio.length === 0) {
    throw new Error('WhatsApp voice payload is required');
  }
  const normalizedDedupeKey =
    cleanText(dedupeKey, 200) ||
    whatsappOutboxDedupeKey('voice', normalizedChatJid, digest(audio), Date.now());
  const existing = await findOutboxByDedupeKey(normalizedDedupeKey, { db });
  if (existing) return existing;

  const storagePath = `voice/${new Date().toISOString().slice(0, 10)}/${digest(
    normalizedDedupeKey,
  )}.ogg`;
  const { error: uploadError } = await db.storage.from(OUTBOX_BUCKET).upload(storagePath, audio, {
    contentType: 'audio/ogg',
    cacheControl: '3600',
    upsert: true,
  });
  if (uploadError) throw uploadError;

  try {
    return await insertOutbox(
      {
        dedupe_key: normalizedDedupeKey,
        chat_jid: normalizedChatJid,
        message_type: 'voice',
        source_type: cleanText(sourceType, 40) || 'operator',
        payload: {
          storagePath,
          durationSeconds: Math.max(1, Math.round(Number(durationSeconds) || 1)),
          metadata:
            metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
        },
        max_attempts: Math.min(20, Math.max(1, Number(maxAttempts) || 8)),
      },
      { db },
    );
  } catch (error) {
    await db.storage
      .from(OUTBOX_BUCKET)
      .remove([storagePath])
      .catch(() => undefined);
    throw error;
  }
}

async function updateLinkedConversationMessage(
  outboxId,
  { deliveryStatus, providerMessageId = null },
  { db = supabase } = {},
) {
  const updates = { delivery_status: deliveryStatus };
  if (providerMessageId) updates.wa_message_id = providerMessageId;
  const { data, error } = await db
    .from('whatsapp_messages')
    .update(updates)
    .eq('outbox_id', outboxId)
    .select('id,conversation_id')
    .maybeSingle();
  if (error) throw error;
  if (data) {
    realtime.publish(
      'whatsapp.message.updated',
      {
        conversationId: data.conversation_id,
        messageId: data.id,
        deliveryStatus,
        providerMessageId,
      },
      { adminOnly: true },
    );
  }
}

async function markLinkedPaymentReceiptDelivered(row, sentAt, { db = supabase } = {}) {
  const receiptId = cleanText(row?.payload?.metadata?.receiptId, 64);
  if (
    row?.source_type !== 'payment_receipt' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receiptId)
  ) {
    return;
  }
  const { error } = await db
    .from('payment_receipts')
    .update({ phone_delivered_at: sentAt, updated_at: sentAt })
    .eq('id', receiptId);
  if (error) throw error;
}

async function markSent(row, providerMessageId, { db = supabase } = {}) {
  const sentAt = new Date().toISOString();
  const { error } = await db
    .from('whatsapp_outbox')
    .update({
      status: 'sent',
      payload: {},
      provider_message_id: providerMessageId,
      last_error: null,
      locked_at: null,
      sent_at: sentAt,
      updated_at: sentAt,
    })
    .eq('id', row.id);
  if (error) throw error;
  await updateLinkedConversationMessage(
    row.id,
    { deliveryStatus: 'sent', providerMessageId },
    { db },
  ).catch((linkedError) => {
    console.warn('[WHATSAPP OUTBOX] Сообщение отправлено, но статус переписки не обновлён:', {
      outboxId: row.id,
      code: linkedError?.code || 'OUTBOX_LINKED_MESSAGE_UPDATE_FAILED',
    });
  });
  await markLinkedPaymentReceiptDelivered(row, sentAt, { db }).catch((receiptError) => {
    console.warn('[WHATSAPP OUTBOX] Чек отправлен, но отметка доставки не сохранена:', {
      outboxId: row.id,
      code: receiptError?.code || 'PAYMENT_RECEIPT_DELIVERY_UPDATE_FAILED',
    });
  });
  if (row.message_type === 'voice' && row.payload?.storagePath) {
    await db.storage
      .from(OUTBOX_BUCKET)
      .remove([row.payload.storagePath])
      .catch(() => undefined);
  }
  realtime.publish(
    'whatsapp.outbox.updated',
    { outboxId: row.id, status: 'sent', providerMessageId },
    { adminOnly: true },
  );
  return { id: row.id, status: 'sent', providerMessageId, queued: false };
}

async function markCancelled(row, reason, { db = supabase } = {}) {
  const now = new Date().toISOString();
  const { error } = await db
    .from('whatsapp_outbox')
    .update({
      status: 'cancelled',
      payload: {},
      last_error: cleanText(reason, 500),
      locked_at: null,
      updated_at: now,
    })
    .eq('id', row.id);
  if (error) throw error;
  realtime.publish(
    'whatsapp.outbox.updated',
    { outboxId: row.id, status: 'cancelled' },
    { adminOnly: true },
  );
  return {
    id: row.id,
    status: 'cancelled',
    providerMessageId: null,
    queued: false,
  };
}

async function markFailed(row, error, { db = supabase } = {}) {
  const terminal = Number(row.attempt_count || 0) >= Number(row.max_attempts || 8);
  const status = terminal ? 'failed' : 'retry';
  const now = new Date();
  const nextAttemptAt = new Date(
    now.getTime() + retryDelaySeconds(row.attempt_count) * 1000,
  ).toISOString();
  const lastError = cleanText(error?.message || 'WhatsApp delivery failed', 500);
  const { error: updateError } = await db
    .from('whatsapp_outbox')
    .update({
      status,
      last_error: lastError,
      locked_at: null,
      next_attempt_at: terminal ? row.next_attempt_at : nextAttemptAt,
      updated_at: now.toISOString(),
    })
    .eq('id', row.id);
  if (updateError) throw updateError;
  if (terminal) {
    await updateLinkedConversationMessage(row.id, { deliveryStatus: 'failed' }, { db }).catch(
      (linkedError) => {
        console.warn('[WHATSAPP OUTBOX] Не удалось обновить статус переписки:', {
          outboxId: row.id,
          code: linkedError?.code || 'OUTBOX_LINKED_MESSAGE_UPDATE_FAILED',
        });
      },
    );
  }
  realtime.publish(
    'whatsapp.outbox.updated',
    {
      outboxId: row.id,
      status,
      attemptCount: Number(row.attempt_count || 0),
      nextAttemptAt: terminal ? null : nextAttemptAt,
    },
    { adminOnly: true },
  );
  return {
    id: row.id,
    status,
    providerMessageId: null,
    queued: !terminal,
    error: lastError,
  };
}

async function voiceBuffer(row, { db = supabase } = {}) {
  const storagePath = cleanText(row.payload?.storagePath, 500);
  if (!storagePath) throw new Error('Queued WhatsApp voice file is missing');
  const { data, error } = await db.storage.from(OUTBOX_BUCKET).download(storagePath);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}

async function deliverWhatsAppOutbox(
  { sendMessage, limit = 25, messageId = null },
  { db = supabase } = {},
) {
  if (typeof sendMessage !== 'function') throw new Error('WhatsApp sender is required');
  const { data, error } = await db.rpc('claim_whatsapp_outbox', {
    p_limit: Math.min(100, Math.max(1, Number(limit) || 25)),
    p_message_id: messageId || null,
  });
  if (error) throw error;
  const results = [];
  for (const row of data || []) {
    try {
      const sourceType = cleanText(row.source_type || row.sourceType, 40);
      if (DISABLED_AUTOMATED_SOURCE_TYPES.has(sourceType)) {
        results.push(
          await markCancelled(row, 'Automatic payment receipt messages are disabled', { db }),
        );
        continue;
      }
      const providerDedupeId = whatsappProviderMessageId(row.id);
      const result = await sendMessage({
        id: row.id,
        chatJid: row.chat_jid,
        messageType: row.message_type,
        text: row.payload?.text || '',
        audio: row.message_type === 'voice' ? await voiceBuffer(row, { db }) : Buffer.alloc(0),
        durationSeconds: Number(row.payload?.durationSeconds || 1),
        providerDedupeId,
      });
      const providerMessageId = cleanText(result?.key?.id || providerDedupeId, 180);
      results.push(await markSent(row, providerMessageId, { db }));
    } catch (deliveryError) {
      try {
        results.push(await markFailed(row, deliveryError, { db }));
      } catch (stateError) {
        console.error('[WHATSAPP OUTBOX] Не удалось сохранить состояние доставки:', {
          outboxId: row.id,
          code: stateError?.code || 'OUTBOX_STATE_FAILED',
        });
        throw stateError;
      }
    }
  }
  return results;
}

module.exports = {
  OUTBOX_BUCKET,
  deliverWhatsAppOutbox,
  enqueueWhatsAppText,
  enqueueWhatsAppVoice,
  findOutboxByDedupeKey,
  normalizeOutbox,
  retryDelaySeconds,
  whatsappOutboxDedupeKey,
  whatsappProviderMessageId,
};

const { supabase } = require('../config/supabase');
const ID = /^[1-9][0-9]{0,19}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail = (code = 'invalid') =>
  Object.assign(
    new Error(
      {
        owner_required: 'Эта команда доступна только владельцу бота.',
        owner_protected: 'Владельца бота удалить нельзя.',
        lease_lost: 'Обработку продолжает другой экземпляр бота.',
      }[code] || 'Неверные параметры команды.',
    ),
    {
      code: `PHOTO_REPORT_TELEGRAM_${code.toUpperCase()}`,
      statusCode: code.startsWith('owner_') ? 403 : code === 'lease_lost' ? 409 : 400,
    },
  );
const userId = (value) => {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw fail();
  const id = String(value ?? '');
  if (!ID.test(id)) throw fail();
  return id;
};
const username = (value) => {
  const name = String(value || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
  if (!/^[a-z0-9_]{5,32}$/.test(name)) throw fail();
  return name;
};
const leaseId = (id) => {
  if (!UUID.test(String(id || ''))) throw fail();
  return id;
};
const offset = (n) => {
  if (!Number.isSafeInteger(n) || n < 0) throw fail();
  return n;
};
const date = (value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw fail();
  return value;
};
const instant = (options = {}) => {
  const now = new Date(options.now || Date.now());
  if (!Number.isFinite(now.getTime())) throw fail();
  return now.toISOString();
};
const retrySeconds = (value = 0) => {
  if (!Number.isFinite(value) || value < 0 || value > 2147483647) throw fail();
  return Math.ceil(value);
};
async function rpc(name, args, options = {}) {
  const { data, error } = await (options.db || supabase).rpc(name, args);
  if (error) throw error;
  if (data?.error) throw fail(data.error);
  return data;
}
async function observeUser(user, options = {}) {
  const id = userId(user.id ?? user.userId);
  const chat = userId(user.chatId);
  if (user.private !== true || chat !== id || user.isBot === true || user.is_bot === true)
    throw fail();
  const owner = options.ownerUserId ?? process.env.PHOTO_REPORT_TELEGRAM_OWNER_ID;
  return rpc(
    'observe_photo_report_telegram_user',
    {
      p_user_id: id,
      p_chat_id: chat,
      p_username: user.username ? username(user.username) : null,
      p_owner_username: username(
        options.ownerUsername || process.env.PHOTO_REPORT_TELEGRAM_OWNER_USERNAME || 'amandyk7292',
      ),
      p_owner_user_id: owner ? userId(owner) : null,
      p_now: instant(options),
    },
    options,
  );
}
const getSettings = (options) => rpc('photo_report_telegram_settings', {}, options);
const commandArgs = (actor, options = {}) => ({
  p_actor: userId(actor),
  p_lease: options.leaseId ? leaseId(options.leaseId) : null,
  p_update: options.updateId === undefined ? null : offset(options.updateId),
  p_now: instant(options),
});
const addAdmin = (actor, name, options) =>
  rpc(
    'add_photo_report_telegram_admin',
    { ...commandArgs(actor, options), p_username: username(name) },
    options,
  );
const removeAdmin = (actor, name, options) =>
  rpc(
    'remove_photo_report_telegram_admin',
    { ...commandArgs(actor, options), p_username: username(name) },
    options,
  );
const listAdmins = (actor, options) =>
  rpc('list_photo_report_telegram_admins', { p_actor: userId(actor) }, options);
function setSendTime(actor, time, options) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) throw fail();
  return rpc(
    'set_photo_report_telegram_time',
    { ...commandArgs(actor, options), p_time: time },
    options,
  );
}
const poll = (action, lease, nextOffset, options) =>
  rpc(
    'photo_report_telegram_poll_lease',
    {
      p_action: action,
      p_lease: leaseId(lease),
      p_offset: nextOffset === null ? null : offset(nextOffset),
      p_now: instant(options),
    },
    options,
  );
const acquirePollingLease = (lease, options) => poll('acquire', lease, null, options);
const renewPollingLease = (lease, options) => poll('renew', lease, null, options);
const advancePollingLease = (lease, nextOffset, options) =>
  poll('advance', lease, nextOffset, options);
const releasePollingLease = (lease, options) => poll('release', lease, null, options);
const update = (action, id, lease, parts, retry, options) =>
  rpc(
    'photo_report_telegram_bot_update',
    {
      p_action: action,
      p_update: offset(id),
      p_lease: leaseId(lease),
      p_parts: parts,
      p_requires_report_access: options?.requiresReportAccess === true,
      p_retry: retry,
      p_now: instant(options),
    },
    options,
  );
const claimBotUpdate = (id, lease, options) => update('claim', id, lease, null, 0, options);
const getBotReply = (id, lease, options) => update('get_reply', id, lease, null, 0, options);
const markBotReplyAttempted = (id, lease, options) => update('reply', id, lease, null, 0, options);
function prepareBotReply(id, lease, text, options) {
  const parts = typeof text === 'string' ? [text] : text;
  if (
    !Array.isArray(parts) ||
    parts.length < 1 ||
    parts.length > 20 ||
    parts.some((p) => typeof p !== 'string' || !p.length || p.length > 4096)
  )
    throw fail();
  return update('prepare', id, lease, parts, 0, options);
}
const markBotReplyRetryable = (id, lease, options = {}) =>
  update('retry_reply', id, lease, null, retrySeconds(options.retryAfter), options);
const completeBotUpdate = (id, lease, options) => update('complete', id, lease, null, 0, options);
const advanceBotReplyPart = (id, lease, options) =>
  update('advance_part', id, lease, null, 0, options);
function enqueueDigest(reportDate, parts, options) {
  if (
    !Array.isArray(parts) ||
    parts.length < 1 ||
    parts.length > 20 ||
    parts.some((p) => typeof p !== 'string' || p.length < 1 || p.length > 4096)
  )
    throw fail();
  return rpc(
    'enqueue_photo_report_telegram_digest',
    { p_date: date(reportDate), p_parts: parts, p_now: instant(options) },
    options,
  );
}
async function digestExists(reportDate, options = {}) {
  const { data, error } = await (options.db || supabase)
    .from('photo_report_telegram_digests')
    .select('report_date')
    .eq('report_date', date(reportDate))
    .maybeSingle();
  if (error) throw error;
  return !!data;
}
function claimDeliveries(limit = 20, options) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw fail();
  return rpc(
    'claim_photo_report_telegram_deliveries',
    { p_limit: limit, p_now: instant(options) },
    options,
  );
}
const deliveryArgs = (id, token, options) => ({
  p_id: leaseId(id),
  p_lease: leaseId(token),
  p_now: instant(options),
});
const deliveryAuthorized = (id, token, options) =>
  rpc('authorize_photo_report_telegram_delivery', deliveryArgs(id, token, options), options);
function completeDelivery(id, token, messageId, options) {
  const message = userId(messageId);
  return rpc(
    'complete_photo_report_telegram_delivery',
    { ...deliveryArgs(id, token, options), p_message_id: message },
    options,
  );
}
const failDelivery = (
  id,
  token,
  { retryAfter = 0, permanent = false, uncertain = false } = {},
  options,
) =>
  rpc(
    'fail_photo_report_telegram_delivery',
    {
      ...deliveryArgs(id, token, options),
      p_retry: retrySeconds(retryAfter),
      p_permanent: permanent === true,
      p_uncertain: uncertain === true,
    },
    options,
  );
const disableRecipient = (id, options) =>
  rpc(
    'disable_photo_report_telegram_recipient',
    { p_id: leaseId(id), p_now: instant(options) },
    options,
  );
const getUnresolvedDeliveryCounts = (options) =>
  rpc('unresolved_photo_report_telegram_deliveries', { p_now: instant(options) }, options);
module.exports = {
  observeUser,
  getSettings,
  addAdmin,
  removeAdmin,
  listAdmins,
  setSendTime,
  acquirePollingLease,
  renewPollingLease,
  advancePollingLease,
  releasePollingLease,
  claimBotUpdate,
  getBotReply,
  prepareBotReply,
  markBotReplyAttempted,
  markBotReplyRetryable,
  completeBotUpdate,
  advanceBotReplyPart,
  enqueueDigest,
  digestExists,
  claimDeliveries,
  deliveryAuthorized,
  completeDelivery,
  failDelivery,
  disableRecipient,
  getUnresolvedDeliveryCounts,
};

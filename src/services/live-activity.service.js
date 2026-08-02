const crypto = require('crypto');
const http2 = require('http2');
const { supabase } = require('../config/supabase');

const liveActivityError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const base64Url = (value) => Buffer.from(value).toString('base64url');

function apnsConfiguration() {
  const teamId = String(process.env.APPLE_APNS_TEAM_ID || '').trim();
  const keyId = String(process.env.APPLE_APNS_KEY_ID || '').trim();
  const privateKey = String(process.env.APPLE_APNS_PRIVATE_KEY || '')
    .replace(/\\n/g, '\n')
    .trim();
  const bundleId = String(process.env.APPLE_APNS_BUNDLE_ID || 'com.bulka.bonus').trim();
  if (!teamId || !keyId || !privateKey || !bundleId) return null;
  return { teamId, keyId, privateKey, bundleId };
}

function createProviderToken(config, now = new Date()) {
  const header = base64Url(JSON.stringify({ alg: 'ES256', kid: config.keyId }));
  const claims = base64Url(
    JSON.stringify({ iss: config.teamId, iat: Math.floor(now.getTime() / 1000) }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: config.privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${signature.toString('base64url')}`;
}

const progressForOrder = (order) => {
  if (order.delivery_status === 'delivered' || order.fulfillment_status === 'completed') return 1;
  if (['picked_up', 'en_route'].includes(order.delivery_status)) return 0.82;
  if (order.fulfillment_status === 'ready') return 0.68;
  if (order.fulfillment_status === 'preparing') return 0.42;
  if (order.fulfillment_status === 'accepted') return 0.22;
  return 0.08;
};

function buildContentState(order) {
  const status =
    order.delivery_status && order.delivery_status !== 'unassigned'
      ? order.delivery_status
      : order.fulfillment_status || 'new';
  const eta =
    order.eta_max_at ||
    order.estimated_delivery_at ||
    order.promised_ready_at ||
    order.scheduled_at ||
    null;
  return {
    status,
    orderStatus: order.fulfillment_status || 'new',
    deliveryStatus: order.delivery_status || 'unassigned',
    etaTimestamp: eta ? Math.floor(new Date(eta).getTime() / 1000) : null,
    etaMinTimestamp: order.eta_min_at
      ? Math.floor(new Date(order.eta_min_at).getTime() / 1000)
      : null,
    etaMaxTimestamp: order.eta_max_at
      ? Math.floor(new Date(order.eta_max_at).getTime() / 1000)
      : null,
    etaConfidence: order.eta_confidence || null,
    progress: progressForOrder(order),
    courierName: order.couriers?.name || order.courier_name || '',
    updatedAtTimestamp: Math.floor(Date.now() / 1000),
  };
}

async function registerLiveActivityToken(customerId, payload = {}) {
  const pushToken = String(payload.pushToken || '')
    .trim()
    .toLowerCase();
  const activityId = String(payload.activityId || '')
    .trim()
    .slice(0, 120);
  const installationId = String(payload.installationId || '')
    .trim()
    .slice(0, 120);
  const orderId = String(payload.orderId || '').trim();
  const environment = payload.environment === 'sandbox' ? 'sandbox' : 'production';
  if (!/^[a-f0-9]{64,256}$/.test(pushToken)) throw liveActivityError('Некорректный APNs-токен');
  if (!activityId || !installationId || !orderId)
    throw liveActivityError('Не хватает данных Live Activity');
  const { data: order, error: orderError } = await supabase
    .from('kaspi_orders')
    .select('id')
    .eq('id', orderId)
    .eq('customer_id', customerId)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order) throw liveActivityError('Заказ не найден', 404);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('customer_live_activity_tokens')
    .upsert(
      {
        customer_id: customerId,
        installation_id: installationId,
        activity_id: activityId,
        push_token: pushToken,
        order_id: orderId,
        environment,
        active: true,
        updated_at: now,
      },
      { onConflict: 'customer_id,installation_id,activity_id' },
    )
    .select('id,activity_id,order_id,environment,active')
    .single();
  if (error) throw error;
  return data;
}

async function deactivateLiveActivityToken(customerId, payload = {}) {
  let query = supabase
    .from('customer_live_activity_tokens')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('customer_id', customerId);
  if (payload.activityId) query = query.eq('activity_id', String(payload.activityId));
  if (payload.orderId) query = query.eq('order_id', String(payload.orderId));
  const { error } = await query;
  if (error) throw error;
}

function sendApnsRequest({ token, environment, payload, config }) {
  return new Promise((resolve) => {
    const host =
      environment === 'sandbox'
        ? 'https://api.sandbox.push.apple.com'
        : 'https://api.push.apple.com';
    const client = http2.connect(host);
    let responseBody = '';
    let status = 0;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      client.close();
      resolve(result);
    };
    client.once('error', (error) => finish({ ok: false, error: error.message }));
    const request = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${createProviderToken(config)}`,
      'apns-push-type': 'liveactivity',
      'apns-priority': '10',
      'apns-topic': `${config.bundleId}.push-type.liveactivity`,
    });
    request.setEncoding('utf8');
    request.on('response', (headers) => {
      status = Number(headers[':status'] || 0);
    });
    request.on('data', (chunk) => {
      responseBody += chunk;
    });
    request.on('end', () => finish({ ok: status === 200, status, body: responseBody }));
    request.on('error', (error) => finish({ ok: false, error: error.message }));
    request.end(JSON.stringify(payload));
  });
}

async function sendOrderLiveActivity(order, { end = false } = {}) {
  if (!order?.id) return { attempted: 0, delivered: 0, skipped: 'order' };
  const config = apnsConfiguration();
  if (!config) return { attempted: 0, delivered: 0, skipped: 'configuration' };
  const { data: tokens, error } = await supabase
    .from('customer_live_activity_tokens')
    .select('id,push_token,environment')
    .eq('order_id', order.id)
    .eq('active', true);
  if (error) {
    if (['42P01', 'PGRST205'].includes(String(error.code || ''))) {
      return { attempted: 0, delivered: 0, skipped: 'schema' };
    }
    throw error;
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = {
    aps: {
      timestamp,
      event: end ? 'end' : 'update',
      'content-state': buildContentState(order),
      ...(end ? { 'dismissal-date': timestamp + 300 } : {}),
    },
  };
  const results = await Promise.all(
    (tokens || []).map((row) =>
      sendApnsRequest({
        token: row.push_token,
        environment: row.environment,
        payload,
        config,
      }).then(async (result) => {
        if (end || [400, 410].includes(result.status)) {
          await supabase
            .from('customer_live_activity_tokens')
            .update({ active: false, updated_at: new Date().toISOString() })
            .eq('id', row.id);
        }
        return result;
      }),
    ),
  );
  return {
    attempted: results.length,
    delivered: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
  };
}

module.exports = {
  apnsConfiguration,
  buildContentState,
  createProviderToken,
  deactivateLiveActivityToken,
  registerLiveActivityToken,
  sendOrderLiveActivity,
};

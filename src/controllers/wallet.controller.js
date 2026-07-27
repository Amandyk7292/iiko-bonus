const {
  createWalletToken,
  resolveWalletToken,
  buildApplePassBuffer,
  generateGoogleWalletUrl,
  getApplePassTypeIdentifier,
  resolveWalletTier,
  verifyApplePassAuthorization,
} = require('../services/wallet.service');
const { supabase } = require('../config/supabase');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APPLE_PASS_DESIGN_UPDATED_AT = Date.parse('2026-07-15T16:03:00.000Z');

function customerIdFromSerial(serialNumber) {
  const value = String(serialNumber || '');
  if (!value.startsWith('bulka-')) return null;
  const customerId = value.slice('bulka-'.length);
  return UUID_PATTERN.test(customerId) ? customerId : null;
}

function customerUpdateTag(customer) {
  const timestamp = Date.parse(customer?.updated_at || customer?.created_at || '');
  return Math.max(Number.isFinite(timestamp) ? timestamp : 0, APPLE_PASS_DESIGN_UPDATED_AT);
}

function setApplePassCacheHeaders(req, res, customer) {
  const updatedAt = customerUpdateTag(customer);
  res.set('Cache-Control', 'no-cache');
  if (updatedAt > 0) res.set('Last-Modified', new Date(updatedAt).toUTCString());
  const requestedAt = Date.parse(String(req.headers['if-modified-since'] || ''));
  return (
    Number.isFinite(requestedAt) &&
    updatedAt > 0 &&
    Math.floor(requestedAt / 1000) >= Math.floor(updatedAt / 1000)
  );
}

async function customerForToken(token) {
  const tokenData = resolveWalletToken(token);
  if (!tokenData) return { expired: true, customer: null };
  const { data: customer, error } = await supabase
    .from('customers')
    .select('*')
    .eq('phone', tokenData.phone)
    .maybeSingle();
  if (error) throw error;
  return { expired: false, customer };
}

async function createToken(req, res) {
  const { data: customer, error } = await supabase
    .from('customers')
    .select('phone')
    .eq('id', req.customerAuth.id)
    .single();
  if (error || !customer) return res.status(404).json({ error: 'Customer not found' });
  const token = createWalletToken(customer.phone);
  res.set('Cache-Control', 'no-store');
  res.json({
    url: `/wallet/${token}`,
    appleUrl: `/api/wallet/download/${token}`,
    googleUrl: `/api/wallet/google/download/${token}`,
  });
}

async function renderWalletChoice(req, res) {
  const token = req.params.token;
  if (!resolveWalletToken(token)) {
    return res.status(410).send('Ссылка истекла. Откройте карту заново в приложении Bulka.');
  }

  res.set('Cache-Control', 'no-store');
  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Сохранить карту Bulka</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #fff8e1; margin: 0; padding: 24px; text-align: center; color: #4e2c1e; }
        main { width: min(100%, 390px); padding: 32px 24px; background: white; border-radius: 28px; box-shadow: 0 18px 50px rgba(109, 51, 23, .14); }
        .logo { width: 112px; height: 112px; object-fit: contain; border-radius: 24px; margin-bottom: 20px; }
        h1 { font-size: 25px; margin: 0 0 10px; }
        p { color: #7b6a61; font-size: 16px; margin: 0 0 28px; }
        a { min-height: 54px; text-decoration: none; padding: 14px 20px; border-radius: 16px; font-size: 17px; font-weight: 650; display: flex; align-items: center; justify-content: center; width: 100%; margin-top: 14px; }
        a:focus-visible { outline: 3px solid #ffb300; outline-offset: 3px; }
        .apple { background: #111; color: white; }
        .google { background: white; color: #3c4043; border: 1px solid #dadce0; }
        svg { margin-right: 12px; width: 24px; height: 24px; flex: none; }
      </style>
    </head>
    <body>
      <main>
        <img src="/app/assets/assets/brand/bulka_logo.png" alt="Bulka" class="logo">
        <h1>Карта лояльности</h1>
        <p>Баланс обновляется автоматически после каждой операции.</p>
        <a href="/api/wallet/download/${token}" class="apple">
          <svg viewBox="0 0 384 512" fill="currentColor" aria-hidden="true"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>
          Добавить в Apple Wallet
        </a>
        <a href="/api/wallet/google/download/${token}" class="google">
          <svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" fill="#FFC107"/><path d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" fill="#FF3D00"/><path d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" fill="#4CAF50"/><path d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" fill="#1976D2"/></svg>
          Добавить в Google Wallet
        </a>
      </main>
    </body>
    </html>
  `);
}

async function downloadApplePass(req, res) {
  const { expired, customer } = await customerForToken(req.params.token);
  if (expired) return res.status(410).send('Ссылка истекла. Откройте карту заново в приложении.');
  if (!customer) return res.status(404).send('Customer not found');

  try {
    const passBuffer = await buildApplePassBuffer(customer);
    setApplePassCacheHeaders(req, res, customer);
    res.set('Content-Type', 'application/vnd.apple.pkpass');
    res.set('Content-Disposition', `attachment; filename="bulka-${customer.id}.pkpass"`);
    res.send(passBuffer);
  } catch (error) {
    console.error('Apple Wallet generation failed:', error.message);
    res.status(500).send('Apple Wallet pass is temporarily unavailable');
  }
}

async function downloadGooglePass(req, res) {
  const { expired, customer } = await customerForToken(req.params.token);
  if (expired) return res.status(410).send('Ссылка истекла. Откройте карту заново в приложении.');
  if (!customer) return res.status(404).send('Customer not found');

  try {
    const { settings, tier } = await resolveWalletTier(customer);
    const saveUrl = await generateGoogleWalletUrl(customer, settings, tier);
    res.set('Cache-Control', 'no-store');
    res.redirect(303, saveUrl);
  } catch (error) {
    console.error('Google Wallet generation failed:', error.message);
    res.status(500).send('Google Wallet pass is temporarily unavailable');
  }
}

async function handleAppleWalletWebService(req, res) {
  if (req.params.passTypeIdentifier !== getApplePassTypeIdentifier()) {
    return res.status(404).send();
  }
  const deviceId = req.params.deviceLibraryIdentifier;
  const serialNumber = req.params.serialNumber;
  const customerId = customerIdFromSerial(serialNumber);
  if (!customerId) return res.status(404).send();
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .maybeSingle();
  if (customerError) throw customerError;
  if (!customer) return res.status(404).send();
  if (!verifyApplePassAuthorization(req.headers.authorization, customerId)) {
    return res.status(401).send();
  }

  if (req.method === 'POST') {
    const pushToken = String(req.body?.pushToken || '').trim();
    if (!pushToken) return res.status(400).send();
    const passTypeIdentifier = getApplePassTypeIdentifier();
    const { data: existing, error: readError } = await supabase
      .from('wallet_registrations')
      .select('id')
      .eq('device_id', deviceId)
      .eq('serial_number', serialNumber)
      .maybeSingle();
    if (readError) throw readError;
    const { error } = await supabase.from('wallet_registrations').upsert(
      {
        device_id: deviceId,
        serial_number: serialNumber,
        push_token: pushToken,
        pass_type_id: passTypeIdentifier,
      },
      { onConflict: 'device_id,serial_number' },
    );
    if (error) throw error;
    return res.status(existing ? 200 : 201).send();
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase.from('wallet_registrations').delete().match({
      device_id: deviceId,
      serial_number: serialNumber,
      pass_type_id: getApplePassTypeIdentifier(),
    });
    if (error) throw error;
    return res.status(200).send();
  }

  if (setApplePassCacheHeaders(req, res, customer)) return res.status(304).send();
  const passBuffer = await buildApplePassBuffer(customer);
  res.set('Content-Type', 'application/vnd.apple.pkpass');
  return res.send(passBuffer);
}

async function listAppleWalletRegistrations(req, res) {
  if (req.params.passTypeIdentifier !== getApplePassTypeIdentifier()) {
    return res.status(404).send();
  }
  const { data: registrations, error } = await supabase
    .from('wallet_registrations')
    .select('serial_number')
    .eq('device_id', req.params.deviceLibraryIdentifier)
    .eq('pass_type_id', getApplePassTypeIdentifier());
  if (error) throw error;
  if (!registrations?.length) return res.status(204).send();

  const serialNumbers = [...new Set(registrations.map((row) => row.serial_number))];
  const customerIds = serialNumbers.map(customerIdFromSerial).filter(Boolean);
  if (customerIds.length === 0) return res.status(204).send();
  const { data: customers, error: customerError } = await supabase
    .from('customers')
    .select('id,updated_at,created_at')
    .in('id', customerIds);
  if (customerError) throw customerError;
  const updateTags = new Map(
    (customers || []).map((customer) => [customer.id, customerUpdateTag(customer)]),
  );
  const since = Number(req.query.passesUpdatedSince);
  const hasSince = Number.isFinite(since) && since >= 0;
  const changed = serialNumbers.filter((serialNumber) => {
    const customerId = customerIdFromSerial(serialNumber);
    const tag = updateTags.get(customerId);
    return Number.isFinite(tag) && (!hasSince || tag > since);
  });
  if (changed.length === 0) return res.status(204).send();
  const lastUpdated = Math.max(
    ...changed.map((serialNumber) => updateTags.get(customerIdFromSerial(serialNumber)) || 0),
  );
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res.json({ lastUpdated: String(lastUpdated), serialNumbers: changed });
}

async function logAppleWalletError(req, res) {
  const logs = Array.isArray(req.body?.logs) ? req.body.logs.slice(0, 10) : [];
  console.warn('Apple Wallet client error:', logs.join(' | ').slice(0, 2000));
  res.status(200).send();
}

module.exports = {
  createToken,
  renderWalletChoice,
  downloadApplePass,
  downloadGooglePass,
  handleAppleWalletWebService,
  listAppleWalletRegistrations,
  logAppleWalletError,
  customerIdFromSerial,
  customerUpdateTag,
};

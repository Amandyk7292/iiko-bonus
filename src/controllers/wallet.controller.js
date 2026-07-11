const {
  createWalletToken,
  resolveWalletToken,
  buildApplePassBuffer,
  generateGoogleWalletUrl,
  verifyApplePassAuthorization,
} = require('../services/wallet.service');
const { supabase } = require('../config/supabase');
const { getSettings } = require('../services/settings.service');
const { getActiveLoyaltyTiers } = require('../services/tier.service');
const { getTierInfo } = require('../utils/tier.util');

async function createToken(req, res) {
  const { data: customer, error } = await supabase
    .from('customers')
    .select('phone')
    .eq('id', req.customerAuth.id)
    .single();
  if (error || !customer) return res.status(404).json({ error: 'Customer not found' });
  const phone = customer.phone;

  const token = createWalletToken(phone);

  res.json({
    url: `/wallet/${token}`,
    appleUrl: `/api/wallet/download/${token}`,
    googleUrl: `/api/wallet/google/download/${token}`,
  });
}

async function renderWalletChoice(req, res) {
  const token = req.params.token;
  if (!resolveWalletToken(token)) {
    return res
      .status(410)
      .send('Ссылка истекла. Пожалуйста, запросите новую ссылку в Telegram боте.');
  }

  const html = `
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Сохранить карту</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background-color: #f9fafb; margin: 0; padding: 20px; text-align: center; }
        .logo { max-width: 150px; border-radius: 20px; margin-bottom: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        h1 { color: #111827; font-size: 24px; margin-bottom: 10px; }
        p { color: #6b7280; font-size: 16px; margin-bottom: 40px; }
        .btn-apple { background-color: #000; color: white; text-decoration: none; padding: 14px 24px; border-radius: 12px; font-size: 18px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; width: 100%; max-width: 300px; margin-bottom: 16px; transition: transform 0.2s; }
        .btn-apple:active { transform: scale(0.98); }
        .btn-google { background-color: #fff; color: #3c4043; border: 1px solid #dadce0; text-decoration: none; padding: 14px 24px; border-radius: 12px; font-size: 18px; font-weight: 500; display: inline-flex; align-items: center; justify-content: center; width: 100%; max-width: 300px; transition: transform 0.2s, background-color 0.2s; }
        .btn-google:active { transform: scale(0.98); background-color: #f8f9fa; }
        .btn-apple svg, .btn-google svg { margin-right: 12px; height: 24px; }
      </style>
    </head>
    <body>
      <img src="https://i.imgur.com/gK9M3Oq.png" alt="Bulka Logo" class="logo">
      <h1>Ваша карта лояльности</h1>
      <p>Выберите, куда сохранить карту</p>
      
      <a href="/api/wallet/download/${token}" class="btn-apple">
        <svg viewBox="0 0 384 512" fill="currentColor"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>
        Apple Wallet
      </a>
      
      <a href="/api/wallet/google/download/${token}" class="btn-google">
        <svg viewBox="0 0 48 48" fill="none"><path d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" fill="#FFC107"/><path d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" fill="#FF3D00"/><path d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" fill="#4CAF50"/><path d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" fill="#1976D2"/></svg>
        Google Wallet
      </a>
    </body>
    </html>
  `;
  res.send(html);
}

async function downloadApplePass(req, res) {
  const token = req.params.token;
  const tokenData = resolveWalletToken(token);

  if (!tokenData) {
    return res
      .status(410)
      .send('Ссылка истекла. Пожалуйста, запросите новую ссылку в Telegram боте.');
  }

  try {
    const phone = tokenData.phone;
    const { data: customer } = await supabase
      .from('customers')
      .select('*')
      .eq('phone', phone)
      .single();
    if (!customer) return res.status(404).send('Customer not found');

    const passBuffer = await buildApplePassBuffer(customer);
    res.set('Content-Type', 'application/vnd.apple.pkpass');
    res.set('Content-Disposition', `attachment; filename="bulka-${customer.id}.pkpass"`);
    res.send(passBuffer);
  } catch (err) {
    console.error('Wallet generation error:', err);
    res.status(500).send('Error generating pass');
  }
}

async function downloadGooglePass(req, res) {
  const token = req.params.token;
  const tokenData = resolveWalletToken(token);

  if (!tokenData) {
    return res.status(410).send('Ссылка истекла. Запросите новую через Telegram-бота.');
  }

  try {
    const phone = tokenData.phone;
    const { data: customer } = await supabase
      .from('customers')
      .select('*')
      .eq('phone', phone)
      .single();
    if (!customer) return res.status(404).send('Customer not found');

    const settings = await getSettings();
    const tiers = await getActiveLoyaltyTiers(settings);
    const tier = getTierInfo(customer.total_spent, tiers, settings);
    const saveUrl = await generateGoogleWalletUrl(customer, settings, tier);

    res.redirect(saveUrl);
  } catch (err) {
    console.error('Google Wallet generation error:', err);
    res.status(500).send('Error generating Google Wallet pass: ' + err.message);
  }
}

async function handleAppleWalletWebService(req, res) {
  const deviceId = req.params.deviceLibraryIdentifier;
  const serialNumber = req.params.serialNumber;
  const customerId = serialNumber.replace('bulka-', '');
  const { data: customer } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .single();
  if (!customer) return res.status(404).send();
  if (!verifyApplePassAuthorization(req.headers.authorization, customerId))
    return res.status(401).send();
  const pushToken = req.body?.pushToken;

  if (req.method === 'POST' && req.path.includes('/devices/')) {
    if (!pushToken) return res.status(400).send();
    const { error } = await supabase.from('wallet_registrations').upsert(
      {
        device_id: deviceId,
        serial_number: serialNumber,
        push_token: pushToken,
        pass_type_id: 'pass.com.bulka.bonus',
      },
      { onConflict: 'device_id,serial_number' },
    );
    if (error) throw error;
    res.status(201).send();
  } else if (req.method === 'DELETE') {
    const { error } = await supabase
      .from('wallet_registrations')
      .delete()
      .match({ device_id: deviceId, serial_number: serialNumber });
    if (error) throw error;
    res.status(200).send();
  } else if (req.method === 'GET' && req.path.includes('/passes/')) {
    try {
      const passBuffer = await buildApplePassBuffer(customer);
      res.set('Content-Type', 'application/vnd.apple.pkpass');
      res.send(passBuffer);
    } catch (err) {
      console.error(err);
      res.status(500).send();
    }
  } else {
    res.status(200).send();
  }
}

async function listAppleWalletRegistrations(req, res) {
  const { data, error } = await supabase
    .from('wallet_registrations')
    .select('serial_number')
    .eq('device_id', req.params.deviceLibraryIdentifier)
    .eq('pass_type_id', 'pass.com.bulka.bonus');
  if (error) throw error;
  if (!data || data.length === 0) return res.status(204).send();
  res.json({
    lastUpdated: new Date().toISOString(),
    serialNumbers: [...new Set(data.map((row) => row.serial_number))],
  });
}

async function logAppleWalletError(req, res) {
  console.warn('Apple Wallet client reported an error');
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
};

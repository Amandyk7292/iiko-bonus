const apn = require('@parse/node-apn');
const jwt = require('jsonwebtoken');
const { PKPass } = require('passkit-generator');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { supabase } = require('../config/supabase');
const { readSecretBuffer } = require('../utils/cert.util');
const { getSecretWalletCardNumber } = require('./customer.service');
const { getTierInfo } = require('../utils/tier.util');
const { getSettings } = require('./settings.service');
const { getActiveLoyaltyTiers } = require('./tier.service');
const { safeEqual, signWalletToken, verifyToken } = require('./auth.service');

function createWalletToken(phone) {
  return signWalletToken(phone);
}

function resolveWalletToken(token) {
  try {
    const payload = verifyToken(token, 'bulka-wallet');
    if (payload.role !== 'wallet' || !payload.phone) return null;
    return { phone: String(payload.phone) };
  } catch (_error) {
    return null;
  }
}

// APNs Setup
let apnProvider = null;
try {
  if (process.env.WALLET_CERT && process.env.WALLET_KEY) {
    apnProvider = new apn.Provider({
      cert: Buffer.from(process.env.WALLET_CERT, 'base64'),
      key: Buffer.from(process.env.WALLET_KEY, 'base64'),
      production: true,
    });
  }
} catch (e) {
  console.error('APN setup failed', e);
}

async function sendAppleWalletPush(customerId) {
  if (!apnProvider) return;
  const serialNumber = `bulka-${customerId}`;
  const { data: registrations } = await supabase
    .from('wallet_registrations')
    .select('push_token')
    .eq('serial_number', serialNumber);
  if (registrations && registrations.length > 0) {
    const notification = new apn.Notification();
    registrations.forEach((reg) => {
      apnProvider
        .send(notification, reg.push_token)
        .catch((err) => console.error('APN push err:', err));
    });
  }
}

function getApplePassAuthToken(customerId) {
  const secret = process.env.WALLET_AUTH_SECRET || process.env.BULKA_SECRET || '';
  if (secret.length < 32)
    throw new Error('WALLET_AUTH_SECRET or BULKA_SECRET must contain at least 32 characters');
  return crypto.createHmac('sha256', secret).update(String(customerId)).digest('hex');
}

function verifyApplePassAuthorization(header, customerId) {
  const value = String(header || '');
  if (!value.startsWith('ApplePass ')) return false;
  return safeEqual(value.slice('ApplePass '.length).trim(), getApplePassAuthToken(customerId));
}

function getPublicBaseUrl() {
  const value = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!/^https:\/\//.test(value)) throw new Error('PUBLIC_BASE_URL must be an https URL');
  return value;
}

async function buildApplePassBuffer(customer) {
  const settings = await getSettings();
  const tiers = await getActiveLoyaltyTiers(settings);
  const tier = getTierInfo(customer.total_spent, tiers, settings);

  const signerCert = readSecretBuffer('WALLET_CERT', 'wallet_cert.pem');
  const signerKey = readSecretBuffer('WALLET_KEY', 'wallet_private_key.pem');
  const wwdr = readSecretBuffer('WALLET_WWDR', 'wwdr.pem');

  const authToken = getApplePassAuthToken(customer.id);

  const passJson = {
    formatVersion: 1,
    passTypeIdentifier: 'pass.com.bulka.bonus',
    serialNumber: `bulka-${customer.id}`,
    teamIdentifier: 'GKRRT4JU9G',
    webServiceURL: `${getPublicBaseUrl()}/api/wallet`,
    authenticationToken: authToken,
    organizationName: 'Bulka Bakery',
    description: 'Карта лояльности пекарни Bulka',
    foregroundColor: 'rgb(109, 51, 23)',
    backgroundColor: 'rgb(255, 179, 0)',
    labelColor: 'rgb(109, 51, 23)',
    barcode: {
      message: getSecretWalletCardNumber(customer),
      format: 'PKBarcodeFormatQR',
      messageEncoding: 'iso-8859-1',
    },
    barcodes: [
      {
        message: getSecretWalletCardNumber(customer),
        format: 'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1',
      },
    ],
    coupon: {
      headerFields: [{ key: 'balance', label: 'БАЛАНС', value: `${customer.balance || 0} ₸` }],
      primaryFields: [
        { key: 'name', label: 'ГОСТЬ', value: (customer.name || 'Гость').toUpperCase() },
      ],
      secondaryFields: [
        { key: 'status', label: 'СТАТУС', value: `${tier.name} ${tier.percent}%`.toUpperCase() },
        { key: 'phone', label: 'ТЕЛЕФОН', value: customer.phone },
      ],
    },
  };

  const pass = new PKPass(
    {
      'pass.json': Buffer.from(JSON.stringify(passJson)),
      'logo.png': fs.readFileSync(path.join(process.cwd(), 'src/assets/pass.model', 'logo.png')),
      'logo@2x.png': fs.readFileSync(
        path.join(process.cwd(), 'src/assets/pass.model', 'logo@2x.png'),
      ),
      'icon.png': fs.readFileSync(path.join(process.cwd(), 'src/assets/pass.model', 'icon.png')),
      'icon@2x.png': fs.readFileSync(
        path.join(process.cwd(), 'src/assets/pass.model', 'icon@2x.png'),
      ),
    },
    { signerCert, signerKey, wwdr },
  );

  return await pass.getAsBuffer();
}

async function generateGoogleWalletUrl(customer, settings, tier) {
  const issuerId = process.env.GOOGLE_ISSUER_ID || '3388000000022353346';
  const classId = process.env.GOOGLE_CLASS_ID || 'bulka_bonus_card';
  let credentialsRaw = process.env.GOOGLE_CREDENTIALS_JSON;
  if (!credentialsRaw && process.env.FIREBASE_SERVICE_ACCOUNT) {
    credentialsRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  }

  if (!credentialsRaw) {
    throw new Error('Google Wallet is not configured on the server (missing credentials).');
  }

  let credentials;
  try {
    credentials = JSON.parse(credentialsRaw);
  } catch (error) {
    throw new Error('Invalid credentials format.', { cause: error });
  }

  const objectId = `${issuerId}.bulka-${customer.id}`;

  const loyaltyObject = {
    id: objectId,
    classId: `${issuerId}.${classId}`,
    state: 'ACTIVE',
    accountId: customer.phone,
    accountName: customer.name || 'Гость',
    barcode: {
      type: 'QR_CODE',
      value: getSecretWalletCardNumber(customer),
      alternateText: 'Сканируйте на кассе',
    },
    textModulesData: [
      {
        id: 'balance',
        header: 'Баланс',
        body: `${customer.balance || 0} ₸`,
      },
      {
        id: 'status',
        header: 'Статус',
        body: `${tier.name} ${tier.percent}%`,
      },
    ],
  };

  const claims = {
    iss: credentials.client_email,
    aud: 'google',
    origins: [],
    typ: 'savetowallet',
    payload: {
      loyaltyObjects: [loyaltyObject],
    },
  };

  const jwtToken = jwt.sign(claims, credentials.private_key, { algorithm: 'RS256' });
  return `https://pay.google.com/gp/v/save/${jwtToken}`;
}

module.exports = {
  createWalletToken,
  resolveWalletToken,
  sendAppleWalletPush,
  buildApplePassBuffer,
  generateGoogleWalletUrl,
  getApplePassAuthToken,
  verifyApplePassAuthorization,
};

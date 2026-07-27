const apn = require('@parse/node-apn');
const jwt = require('jsonwebtoken');
const { auth } = require('google-auth-library');
const { PKPass } = require('passkit-generator');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { supabase } = require('../config/supabase');
const { readSecretBuffer } = require('../utils/cert.util');
const { getSecretWalletCardNumber } = require('../utils/wallet-card.util');
const { getTierInfo } = require('../utils/tier.util');
const { getSettings } = require('./settings.service');
const { getActiveLoyaltyTiers } = require('./tier.service');
const { safeEqual, signWalletToken, verifyToken } = require('./auth.service');

const GOOGLE_WALLET_SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';
const GOOGLE_WALLET_API = 'https://walletobjects.googleapis.com/walletobjects/v1';

let apnProvider;
let apnProviderInitialized = false;
let googleClientPromise;

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

function getApplePassTypeIdentifier() {
  return String(process.env.APPLE_PASS_TYPE_ID || 'pass.com.bulka.bonus').trim();
}

function getAppleTeamIdentifier() {
  return String(
    process.env.APPLE_WALLET_TEAM_ID || process.env.APPLE_TEAM_ID || 'GKRRT4JU9G',
  ).trim();
}

function getApnProvider() {
  if (apnProviderInitialized) return apnProvider;
  apnProviderInitialized = true;
  try {
    apnProvider = new apn.Provider({
      cert: readSecretBuffer('WALLET_CERT', 'wallet_cert.pem'),
      key: readSecretBuffer('WALLET_KEY', 'wallet_private_key.pem'),
      passphrase: process.env.WALLET_KEY_PASSPHRASE || undefined,
      production: process.env.WALLET_APNS_PRODUCTION !== 'false',
    });
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      console.error('Apple Wallet APNs setup failed:', error.message);
    }
    apnProvider = null;
  }
  return apnProvider;
}

async function removeInvalidApplePushTokens(failures) {
  const invalidTokens = failures
    .filter((failure) =>
      ['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered'].includes(
        failure?.response?.reason,
      ),
    )
    .map((failure) => String(failure.device || ''))
    .filter(Boolean);
  if (invalidTokens.length === 0) return;
  const { error } = await supabase
    .from('wallet_registrations')
    .delete()
    .in('push_token', invalidTokens);
  if (error) console.error('Could not remove invalid Apple Wallet tokens:', error.message);
}

function createAppleWalletNotification(passTypeIdentifier) {
  const notification = new apn.Notification();
  notification.topic = passTypeIdentifier;
  notification.expiry = Math.floor(Date.now() / 1000) + 60 * 60;
  // @parse/node-apn drops a literal {}, so preserve Apple's empty pass-update payload.
  notification.rawPayload = { aps: {} };
  return notification;
}

async function sendAppleWalletPush(customerId) {
  const provider = getApnProvider();
  if (!provider) return { configured: false, sent: 0, failed: 0 };
  const serialNumber = `bulka-${customerId}`;
  const passTypeIdentifier = getApplePassTypeIdentifier();
  const { data: registrations, error } = await supabase
    .from('wallet_registrations')
    .select('push_token')
    .eq('serial_number', serialNumber)
    .eq('pass_type_id', passTypeIdentifier);
  if (error) throw error;
  const tokens = [...new Set((registrations || []).map((row) => row.push_token).filter(Boolean))];
  if (tokens.length === 0) return { configured: true, sent: 0, failed: 0 };

  const notification = createAppleWalletNotification(passTypeIdentifier);
  const result = await provider.send(notification, tokens);
  await removeInvalidApplePushTokens(result.failed || []);
  return {
    configured: true,
    sent: result.sent?.length || 0,
    failed: result.failed?.length || 0,
  };
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
  const value = String(
    process.env.PUBLIC_BASE_URL || process.env.ANDROID_BASE_URL || 'https://bulka.com.kz',
  ).replace(/\/$/, '');
  if (!/^https:\/\//.test(value)) throw new Error('PUBLIC_BASE_URL must be an https URL');
  return value;
}

function formatWalletAmount(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '0';
  return amount
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
}

function googleBalance(value) {
  const amount = Number(Number(value || 0).toFixed(2));
  return Number.isInteger(amount) ? { int: amount } : { double: amount };
}

function localizedString(defaultLanguage, defaultValue, translations = {}) {
  return {
    defaultValue: { language: defaultLanguage, value: defaultValue },
    translatedValues: Object.entries(translations).map(([language, value]) => ({
      language,
      value,
    })),
  };
}

async function resolveWalletTier(customer) {
  const settings = await getSettings();
  let tiers = null;
  try {
    tiers = await getActiveLoyaltyTiers(settings);
  } catch (error) {
    console.warn('Could not load Wallet loyalty tiers, using defaults:', error.message);
  }
  const tier = getTierInfo(customer.total_spent, tiers || settings, settings);
  return { settings, tier };
}

async function buildApplePassBuffer(customer) {
  const { tier } = await resolveWalletTier(customer);

  const signerCert = readSecretBuffer('WALLET_CERT', 'wallet_cert.pem');
  const signerKey = readSecretBuffer('WALLET_KEY', 'wallet_private_key.pem');
  const wwdr = readSecretBuffer('WALLET_WWDR', 'wwdr.pem');
  const passTypeIdentifier = getApplePassTypeIdentifier();
  const authToken = getApplePassAuthToken(customer.id);

  const passJson = {
    formatVersion: 1,
    passTypeIdentifier,
    serialNumber: `bulka-${customer.id}`,
    teamIdentifier: getAppleTeamIdentifier(),
    webServiceURL: `${getPublicBaseUrl()}/api/wallet`,
    authenticationToken: authToken,
    organizationName: 'Bulka',
    description: 'Карта лояльности пекарни Bulka',
    foregroundColor: 'rgb(255, 250, 242)',
    backgroundColor: 'rgb(27, 13, 8)',
    labelColor: 'rgb(242, 190, 73)',
    suppressStripShine: true,
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
    storeCard: {
      headerFields: [
        {
          key: 'balance',
          label: 'БАЛАНС',
          value: Number(customer.balance || 0),
          currencyCode: 'KZT',
          changeMessage: 'Бонусный баланс обновлён: %@',
        },
      ],
      primaryFields: [
        { key: 'name', label: 'ГОСТЬ', value: (customer.name || 'Гость').toUpperCase() },
      ],
      secondaryFields: [
        { key: 'status', label: 'СТАТУС', value: `${tier.name} ${tier.percent}%`.toUpperCase() },
        { key: 'phone', label: 'ТЕЛЕФОН', value: customer.phone },
      ],
      backFields: [
        {
          key: 'balanceInfo',
          label: 'БОНУСНЫЙ БАЛАНС',
          value: `${formatWalletAmount(customer.balance)} ₸`,
        },
        {
          key: 'rules',
          label: 'КАК ИСПОЛЬЗОВАТЬ БОНУСЫ',
          value: '1 бонус = 1 ₸. Бонусами можно оплатить до 50% стоимости заказа.',
        },
        {
          key: 'website',
          label: 'BULKA',
          value: getPublicBaseUrl(),
        },
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
      'logo@3x.png': fs.readFileSync(
        path.join(process.cwd(), 'src/assets/pass.model', 'logo@3x.png'),
      ),
      'icon.png': fs.readFileSync(path.join(process.cwd(), 'src/assets/pass.model', 'icon.png')),
      'icon@2x.png': fs.readFileSync(
        path.join(process.cwd(), 'src/assets/pass.model', 'icon@2x.png'),
      ),
      'icon@3x.png': fs.readFileSync(
        path.join(process.cwd(), 'src/assets/pass.model', 'icon@3x.png'),
      ),
      'strip.png': fs.readFileSync(path.join(process.cwd(), 'src/assets/pass.model', 'strip.png')),
      'strip@2x.png': fs.readFileSync(
        path.join(process.cwd(), 'src/assets/pass.model', 'strip@2x.png'),
      ),
      'strip@3x.png': fs.readFileSync(
        path.join(process.cwd(), 'src/assets/pass.model', 'strip@3x.png'),
      ),
    },
    { signerCert, signerKey, wwdr },
  );

  return pass.getAsBuffer();
}

function parseGoogleCredentials() {
  const raw = process.env.GOOGLE_CREDENTIALS_JSON || process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  let credentials;
  try {
    credentials = typeof raw === 'string' ? JSON.parse(raw.trim()) : raw;
  } catch (error) {
    throw new Error('Invalid Google Wallet credentials format', { cause: error });
  }
  if (!credentials?.client_email || !credentials?.private_key) {
    throw new Error('Google Wallet credentials require client_email and private_key');
  }
  return {
    ...credentials,
    private_key: String(credentials.private_key).replace(/\\n/g, '\n'),
  };
}

function getGoogleWalletIdentifiers(customerId) {
  const issuerId = String(process.env.GOOGLE_ISSUER_ID || '').trim();
  const classSuffix = String(process.env.GOOGLE_CLASS_ID || 'bulka_bonus_card').trim();
  if (!issuerId) throw new Error('GOOGLE_ISSUER_ID is required');
  const classId = classSuffix.startsWith(`${issuerId}.`)
    ? classSuffix
    : `${issuerId}.${classSuffix}`;
  return { issuerId, classId, objectId: `${issuerId}.bulka-${customerId}` };
}

function buildGoogleLoyaltyObject(customer, tier) {
  const { classId, objectId } = getGoogleWalletIdentifiers(customer.id);
  return {
    id: objectId,
    classId,
    state: 'ACTIVE',
    accountId: String(customer.phone || '').slice(0, 20),
    accountName: String(customer.name || 'Гость').slice(0, 20),
    loyaltyPoints: {
      label: 'Бонусы',
      localizedLabel: localizedString('ru', 'Бонусы', {
        kk: 'Бонустар',
        en: 'Points',
      }),
      balance: googleBalance(customer.balance),
    },
    barcode: {
      type: 'QR_CODE',
      value: getSecretWalletCardNumber(customer),
      alternateText: 'Сканируйте на кассе',
    },
    textModulesData: [
      {
        id: 'status',
        header: 'Статус',
        body: `${tier.name} ${tier.percent}%`,
      },
    ],
  };
}

async function getGoogleWalletClient() {
  if (!googleClientPromise) {
    const credentials = parseGoogleCredentials();
    if (!credentials) return null;
    googleClientPromise = Promise.resolve().then(async () => {
      const client = auth.fromJSON(credentials);
      client.scopes = [GOOGLE_WALLET_SCOPE];
      await client.authorize();
      return client;
    });
    googleClientPromise.catch(() => {
      googleClientPromise = null;
    });
  }
  return googleClientPromise;
}

function buildGoogleWalletUpdatePayload(loyaltyObject) {
  return {
    accountName: loyaltyObject.accountName,
    accountId: loyaltyObject.accountId,
    loyaltyPoints: loyaltyObject.loyaltyPoints,
    barcode: loyaltyObject.barcode,
    textModulesData: loyaltyObject.textModulesData,
    notifyPreference: 'NOTIFY_ON_UPDATE',
  };
}

async function updateGoogleWalletObject(customer, tier) {
  const client = await getGoogleWalletClient();
  if (!client) return { configured: false, updated: false };
  const loyaltyObject = buildGoogleLoyaltyObject(customer, tier);
  try {
    await client.request({
      url: `${GOOGLE_WALLET_API}/loyaltyObject/${encodeURIComponent(loyaltyObject.id)}`,
      method: 'PATCH',
      data: buildGoogleWalletUpdatePayload(loyaltyObject),
    });
    return { configured: true, updated: true };
  } catch (error) {
    if (Number(error?.response?.status || error?.code) === 404) {
      return { configured: true, updated: false, reason: 'not-saved' };
    }
    throw error;
  }
}

async function generateGoogleWalletUrl(customer, _settings, tier) {
  const credentials = parseGoogleCredentials();
  if (!credentials) {
    throw new Error('Google Wallet is not configured on the server');
  }
  const loyaltyObject = buildGoogleLoyaltyObject(customer, tier);
  const claims = {
    iss: credentials.client_email,
    aud: 'google',
    origins: [],
    typ: 'savetowallet',
    payload: { loyaltyObjects: [loyaltyObject] },
  };
  const jwtToken = jwt.sign(claims, credentials.private_key, { algorithm: 'RS256' });
  return `https://pay.google.com/gp/v/save/${jwtToken}`;
}

module.exports = {
  createWalletToken,
  resolveWalletToken,
  createAppleWalletNotification,
  sendAppleWalletPush,
  buildApplePassBuffer,
  buildGoogleLoyaltyObject,
  buildGoogleWalletUpdatePayload,
  generateGoogleWalletUrl,
  updateGoogleWalletObject,
  resolveWalletTier,
  getApplePassAuthToken,
  getApplePassTypeIdentifier,
  verifyApplePassAuthorization,
  formatWalletAmount,
};

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

const walletTokens = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [token, data] of walletTokens) {
    if (now > data.expiresAt) {
      walletTokens.delete(token);
    }
  }
}, 60 * 1000);

// APNs Setup
let apnProvider = null;
try {
  if (process.env.WALLET_CERT && process.env.WALLET_KEY) {
    apnProvider = new apn.Provider({
      cert: Buffer.from(process.env.WALLET_CERT, 'base64'),
      key: Buffer.from(process.env.WALLET_KEY, 'base64'),
      production: true
    });
  }
} catch (e) {
  console.error("APN setup failed", e);
}

async function sendAppleWalletPush(customerId) {
  if (!apnProvider) return;
  const serialNumber = `bulka-${customerId}`;
  const { data: registrations } = await supabase.from('wallet_registrations').select('push_token').eq('serial_number', serialNumber);
  if (registrations && registrations.length > 0) {
    const notification = new apn.Notification();
    registrations.forEach(reg => {
      apnProvider.send(notification, reg.push_token).catch(err => console.error("APN push err:", err));
    });
  }
}

async function buildApplePassBuffer(customer, host) {
    const settings = await getSettings();
    const tier = getTierInfo(customer.total_spent, settings);

    const signerCert = readSecretBuffer('WALLET_CERT', 'wallet_cert.pem');
    const signerKey = readSecretBuffer('WALLET_KEY', 'wallet_private_key.pem');
    const wwdr = readSecretBuffer('WALLET_WWDR', 'wwdr.pem');
    
    const authToken = crypto.createHash('sha256').update(customer.id.toString() + 'bulka').digest('hex');

    const passJson = {
      formatVersion: 1,
      passTypeIdentifier: 'pass.com.bulka.bonus',
      serialNumber: `bulka-${customer.id}`,
      teamIdentifier: 'GKRRT4JU9G',
      webServiceURL: `https://${host}/api/wallet`,
      authenticationToken: authToken,
      organizationName: 'Bulka Bakery',
      description: 'Карта лояльности пекарни Bulka',
      foregroundColor: 'rgb(109, 51, 23)',
      backgroundColor: 'rgb(255, 179, 0)',
      labelColor: 'rgb(109, 51, 23)',
      barcode: { message: getSecretWalletCardNumber(customer), format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1' },
      barcodes: [{ message: getSecretWalletCardNumber(customer), format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1' }],
      coupon: {
        headerFields: [{ key: 'balance', label: 'БАЛАНС', value: `${customer.balance || 0} ₸` }],
        primaryFields: [{ key: 'name', label: 'ГОСТЬ', value: (customer.name || 'Гость').toUpperCase() }],
        secondaryFields: [{ key: 'status', label: 'СТАТУС', value: `${tier.name} ${tier.percent}%`.toUpperCase() }, { key: 'phone', label: 'ТЕЛЕФОН', value: customer.phone }]
      }
    };

    const pass = new PKPass({
      'pass.json': Buffer.from(JSON.stringify(passJson)),
      'logo.png': fs.readFileSync(path.join(process.cwd(), 'src/assets/pass.model', 'logo.png')),
      'logo@2x.png': fs.readFileSync(path.join(process.cwd(), 'src/assets/pass.model', 'logo@2x.png')),
      'icon.png': fs.readFileSync(path.join(process.cwd(), 'src/assets/pass.model', 'icon.png')),
      'icon@2x.png': fs.readFileSync(path.join(process.cwd(), 'src/assets/pass.model', 'icon@2x.png'))
    }, { signerCert, signerKey, wwdr });

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
  } catch (e) {
    throw new Error('Invalid credentials format.');
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
      alternateText: 'Сканируйте на кассе'
    },
    textModulesData: [
      {
        id: 'balance',
        header: 'Баланс',
        body: `${customer.balance || 0} ₸`
      },
      {
        id: 'status',
        header: 'Статус',
        body: `${tier.name} ${tier.percent}%`
      }
    ]
  };

  const claims = {
    iss: credentials.client_email,
    aud: 'google',
    origins: [],
    typ: 'savetowallet',
    payload: {
      loyaltyObjects: [loyaltyObject]
    }
  };

  const jwtToken = jwt.sign(claims, credentials.private_key, { algorithm: 'RS256' });
  return `https://pay.google.com/gp/v/save/${jwtToken}`;
}

module.exports = {
  walletTokens,
  sendAppleWalletPush,
  buildApplePassBuffer,
  generateGoogleWalletUrl
};

require('dotenv').config();
const { auth } = require('google-auth-library');
const fetch = require('node-fetch');

const GOOGLE_WALLET_API = 'https://walletobjects.googleapis.com/walletobjects/v1';
const GOOGLE_WALLET_SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';

function localizedString(defaultLanguage, defaultValue, translations = {}) {
  return {
    defaultValue: { language: defaultLanguage, value: defaultValue },
    translatedValues: Object.entries(translations).map(([language, value]) => ({ language, value })),
  };
}

function walletImage(uri, description) {
  return {
    sourceUri: { uri },
    contentDescription: localizedString('ru', description, {
      kk: description,
      en: description,
    }),
  };
}

function buildLoyaltyClass(classId, publicBaseUrl, reviewStatus = 'UNDER_REVIEW') {
  const assetBase = `${publicBaseUrl}/app/assets/wallet`;
  return {
    id: classId,
    issuerName: 'Bulka',
    localizedIssuerName: localizedString('ru', 'Bulka', { kk: 'Bulka', en: 'Bulka' }),
    programName: 'Bulka Bonus',
    localizedProgramName: localizedString('ru', 'Bulka Bonus', {
      kk: 'Bulka Bonus',
      en: 'Bulka Bonus',
    }),
    programLogo: walletImage(`${assetBase}/bulka-wallet-logo.png`, 'Логотип Bulka'),
    wideProgramLogo: walletImage(
      `${assetBase}/bulka-wallet-wide-logo.png`,
      'Логотип Bulka Bonus',
    ),
    heroImage: walletImage(`${assetBase}/bulka-wallet-hero.png`, 'Свежая выпечка Bulka'),
    hexBackgroundColor: '#1E140C',
    countryCode: 'KZ',
    accountNameLabel: 'Гость',
    localizedAccountNameLabel: localizedString('ru', 'Гость', {
      kk: 'Қонақ',
      en: 'Member',
    }),
    accountIdLabel: 'Телефон',
    localizedAccountIdLabel: localizedString('ru', 'Телефон', {
      kk: 'Телефон',
      en: 'Phone',
    }),
    rewardsTierLabel: 'Статус',
    localizedRewardsTierLabel: localizedString('ru', 'Статус', {
      kk: 'Деңгей',
      en: 'Tier',
    }),
    homepageUri: {
      uri: publicBaseUrl,
      description: 'Bulka',
    },
    textModulesData: [
      {
        id: 'balance_info',
        header: 'Как использовать бонусы?',
        body: '1 бонус = 1 ₸. Бонусами можно оплатить до 50% стоимости заказа.',
      },
    ],
    classTemplateInfo: {
      cardTemplateOverride: {
        cardRowTemplateInfos: [
          {
            twoItems: {
              startItem: {
                firstValue: {
                  fields: [{ fieldPath: 'object.loyaltyPoints.balance' }],
                },
              },
              endItem: {
                firstValue: {
                  fields: [{ fieldPath: "object.textModulesData['status']" }],
                },
              },
            },
          },
        ],
      },
    },
    securityAnimation: { animationType: 'FOIL_SHIMMER' },
    reviewStatus,
  };
}

async function googleWalletClient() {
  const raw = process.env.GOOGLE_CREDENTIALS_JSON || process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('GOOGLE_CREDENTIALS_JSON is required');
  const credentials = JSON.parse(raw);
  credentials.private_key = String(credentials.private_key || '').replace(/\\n/g, '\n');
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Google Wallet credentials are incomplete');
  }
  const client = auth.fromJSON(credentials);
  client.scopes = [GOOGLE_WALLET_SCOPE];
  await client.authorize();
  const token = await client.getAccessToken();
  const accessToken = typeof token === 'string' ? token : token?.token;
  if (!accessToken) throw new Error('Google authorization did not return an access token');
  return accessToken;
}

async function requestGoogleWallet(path, accessToken, options = {}) {
  const response = await fetch(`${GOOGLE_WALLET_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function createOrUpdateGoogleWalletClass() {
  const issuerId = String(process.env.GOOGLE_ISSUER_ID || '').trim();
  const classSuffix = String(process.env.GOOGLE_CLASS_ID || 'bulka_bonus_card').trim();
  if (!issuerId) throw new Error('GOOGLE_ISSUER_ID is required');
  const classId = classSuffix.startsWith(`${issuerId}.`)
    ? classSuffix
    : `${issuerId}.${classSuffix}`;
  const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || 'https://bulka.com.kz').replace(
    /\/$/,
    '',
  );
  if (!/^https:\/\//.test(publicBaseUrl)) throw new Error('PUBLIC_BASE_URL must use HTTPS');

  console.log('Авторизация в Google Wallet API...');
  const accessToken = await googleWalletClient();
  const resourcePath = `/loyaltyClass/${encodeURIComponent(classId)}`;
  const current = await requestGoogleWallet(resourcePath, accessToken);

  let result;
  if (current.response.ok) {
    console.log(`Обновление класса ${classId} через PATCH...`);
    result = await requestGoogleWallet(resourcePath, accessToken, {
      method: 'PATCH',
      body: JSON.stringify(buildLoyaltyClass(classId, publicBaseUrl)),
    });
  } else if (current.response.status === 404) {
    console.log(`Создание класса ${classId}...`);
    result = await requestGoogleWallet('/loyaltyClass', accessToken, {
      method: 'POST',
      body: JSON.stringify(buildLoyaltyClass(classId, publicBaseUrl)),
    });
  } else {
    throw new Error(`Google Wallet GET failed: ${JSON.stringify(current.data)}`);
  }

  if (!result.response.ok) {
    throw new Error(`Google Wallet update failed: ${JSON.stringify(result.data)}`);
  }
  console.log(`Готово: ${result.data.id}; статус проверки: ${result.data.reviewStatus}`);
}

createOrUpdateGoogleWalletClass().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

module.exports = { buildLoyaltyClass, localizedString };

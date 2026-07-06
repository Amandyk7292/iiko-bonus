const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { PKPass } = require('passkit-generator');
const apn = require('@parse/node-apn');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { supabase } = require('./supabase');
const iikoApi = require('./iiko-api');
const { getStories, addStory, updateStory, deleteStory } = require('./stories');

// APNs Setup
let apnProvider = null;
try {
  if (process.env.WALLET_CERT && process.env.WALLET_KEY) {
    apnProvider = new apn.Provider({
      cert: Buffer.from(process.env.WALLET_CERT, 'base64'),
      key: Buffer.from(process.env.WALLET_KEY, 'base64'),
      production: true // or false depending on env, usually true for passes
    });
  }
} catch (e) {
  console.error("APN setup failed", e);
}

async function sendAppleWalletPush(customerId) {
  if (!apnProvider) return;
  const serialNumber = `bulka-${customerId}`;
  const { supabase } = require('./supabase');
  const { data: registrations } = await supabase.from('wallet_registrations').select('push_token').eq('serial_number', serialNumber);
  if (registrations && registrations.length > 0) {
    const notification = new apn.Notification();
    registrations.forEach(reg => {
      apnProvider.send(notification, reg.push_token).catch(err => console.error("APN push err:", err));
    });
  }
}

function readSecretBuffer(envKey, localFile) {
  if (process.env[envKey]) return Buffer.from(process.env[envKey], 'base64');
  if (!isProduction) {
    const filePath = path.join(__dirname, localFile);
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath);
  }
  throw new Error(`${envKey} is required`);
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
      'logo.png': fs.readFileSync(path.join(__dirname, 'pass.model', 'logo.png')),
      'logo@2x.png': fs.readFileSync(path.join(__dirname, 'pass.model', 'logo@2x.png')),
      'icon.png': fs.readFileSync(path.join(__dirname, 'pass.model', 'icon.png')),
      'icon@2x.png': fs.readFileSync(path.join(__dirname, 'pass.model', 'icon@2x.png'))
    }, { signerCert, signerKey, wwdr });

    return await pass.getAsBuffer();
}


const { getCustomerByPhone, getOrCreateCustomerByPhone, searchCustomers, updateCustomerBalance, updateCustomerInfo, logTransaction, getAllCustomers, getTransactions, getStats, addManualBonus, checkAndExpireInactiveBonuses, checkAndNotifyInactiveCustomers, updateFcmToken, getSecretWalletCardNumber, applyLoyaltyTransaction } = require('./customers');
const { sendPushNotification } = require('./push-notifications');
const { getSettings, updateSettings } = require('./settings');
const { sendWhatsAppMessage, initWhatsApp } = require('./whatsapp-baileys');

const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER || process.env.VERCEL;
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'API_TOKEN', 'ADMIN_PASSWORD', 'BULKA_SECRET'];
const missingRequiredEnv = requiredEnvVars.filter(key => !process.env[key]);
if (missingRequiredEnv.length > 0) {
  const message = `Missing required environment variables: ${missingRequiredEnv.join(', ')}`;
  if (isProduction) {
    throw new Error(message);
  }
  console.warn(`WARNING: ${message}`);
}

const API_TOKEN = process.env.API_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

function normalizePhone(phone) {
  return String(phone || '').replace(/[^0-9+]/g, '');
}

function buildDynamicQrToken(phone, timeWindow = Math.floor(Date.now() / 300000)) {
  const digitsOnly = String(phone || '').replace(/[^0-9]/g, '');
  if (digitsOnly.length < 10) {
    const err = new Error('Valid phone required');
    err.statusCode = 400;
    throw err;
  }
  if (!process.env.BULKA_SECRET) throw new Error('BULKA_SECRET is required');
  const hash = crypto
    .createHash('sha256')
    .update(`${digitsOnly}:${timeWindow}:${process.env.BULKA_SECRET}`)
    .digest('hex')
    .slice(0, 8);
  const expiresAt = (timeWindow + 1) * 300000;
  return {
    token: `BULKA-OTP-${digitsOnly}-${timeWindow}-${hash}`,
    expiresAt,
    ttlSeconds: Math.max(1, Math.floor((expiresAt - Date.now()) / 1000))
  };
}

function parseMoney(value, fieldName, { min = 0 } = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < min) {
    const err = new Error(`${fieldName} must be a number >= ${min}`);
    err.statusCode = 400;
    throw err;
  }
  return Math.round(amount * 100) / 100;
}

function makeRateLimiter({ windowMs, max, key = req => req.ip, message = 'Too many requests' }) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const bucketKey = key(req);
    const bucket = buckets.get(bucketKey);
    if (!bucket || now > bucket.resetAt) {
      buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}

const authRateLimit = makeRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 8,
  key: req => `${req.ip}:${normalizePhone(req.body?.phone)}`,
  message: 'Слишком много попыток. Попробуйте позже.'
});

const adminRateLimit = makeRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 120,
  message: 'Слишком много запросов к админке.'
});

const walletRateLimit = makeRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  key: req => `${req.ip}:${normalizePhone(req.body?.phone)}`,
  message: 'Слишком много запросов Wallet-ссылки.'
});

function getTierInfo(totalSpent, settings) {
  const spent = Number(totalSpent) || 0;
  if (spent >= settings.tier_platinum_th) {
    return { name: 'Платина', percent: settings.tier_platinum_cb, nextTier: null, nextTh: null, remaining: 0, progress: 100 };
  } else if (spent >= settings.tier_gold_th) {
    return { name: 'Золото', percent: settings.tier_gold_cb, nextTier: 'Платина', nextTh: settings.tier_platinum_th, remaining: settings.tier_platinum_th - spent, progress: (spent / settings.tier_platinum_th) * 100 };
  } else if (spent >= settings.tier_silver_th) {
    return { name: 'Серебро', percent: settings.tier_silver_cb, nextTier: 'Золото', nextTh: settings.tier_gold_th, remaining: settings.tier_gold_th - spent, progress: (spent / settings.tier_gold_th) * 100 };
  } else {
    return { name: 'Бронза', percent: settings.base_cashback_percent, nextTier: 'Серебро', nextTh: settings.tier_silver_th, remaining: settings.tier_silver_th - spent, progress: (spent / settings.tier_silver_th) * 100 };
  }
}

const app = express();
app.set('trust proxy', 1);
app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  }
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // Для form submit

// Хранилище OTP кодов
const { otpStore } = require('./otpStore');

// ==========================================
// 1. ВЕБ-ИНТЕРФЕЙС (РЕГИСТРАЦИЯ КЛИЕНТОВ)
// ==========================================

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Регистрация в Бонусной Системе</title>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
      <style>
        body { 
          font-family: 'Inter', sans-serif; 
          background-color: #fcfbf9; 
          display: flex; 
          justify-content: center; 
          align-items: center; 
          height: 100vh; 
          margin: 0; 
          color: #333333;
        }
        .card { 
          background: #ffffff; 
          padding: 3rem 2.5rem; 
          border-radius: 12px; 
          border: 1px solid #efe6d5;
          box-shadow: 0 10px 30px rgba(184, 140, 90, 0.05); 
          max-width: 400px; 
          width: 100%; 
          text-align: center;
        }
        h1 { 
          font-family: 'Playfair Display', serif;
          margin-top: 0; 
          font-size: 2rem; 
          color: #7e5d40; 
          margin-bottom: 0.5rem;
        }
        p {
          color: #666;
          font-size: 0.9rem;
          margin-bottom: 2rem;
          line-height: 1.5;
        }
        label { 
          display: block; 
          text-align: left;
          margin-bottom: 0.4rem; 
          color: #9a714a; 
          font-weight: 500; 
          font-size: 0.85rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        input { 
          width: 100%; 
          padding: 0.85rem 1rem; 
          margin-bottom: 1.5rem; 
          border: 1px solid #e3d2b7; 
          background: #fdfbf7;
          border-radius: 8px; 
          box-sizing: border-box; 
          font-size: 1rem;
          color: #4a4a4a;
          transition: all 0.2s;
        }
        input:focus {
          outline: none;
          border-color: #b88c5a;
          box-shadow: 0 0 0 3px rgba(184, 140, 90, 0.1);
        }
        button { 
          width: 100%; 
          padding: 1rem; 
          background-color: #b88c5a; 
          color: white; 
          border: none; 
          border-radius: 8px; 
          font-size: 1rem; 
          font-weight: 500; 
          cursor: pointer; 
          transition: all 0.2s;
        }
        button:hover { 
          background-color: #9a714a; 
          transform: translateY(-1px);
        }
        .success { color: #2f855a; background: #f0fff4; padding: 1rem; border-radius: 8px; display: none; margin-bottom: 1.5rem; font-size: 0.9rem; border: 1px solid #c6f6d5; }
        .error { color: #c53030; background: #fff5f5; padding: 1rem; border-radius: 8px; display: none; margin-bottom: 1.5rem; font-size: 0.9rem; border: 1px solid #fed7d7; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Карта Лояльности</h1>
        <p>Зарегистрируйтесь, чтобы получать кэшбэк и оплачивать покупки баллами.</p>
        
        <div id="successMessage" class="success">Вы успешно зарегистрированы! Называйте свой номер на кассе.</div>
        <div id="errorMessage" class="error">Произошла ошибка при регистрации.</div>

        <form id="regForm">
          <label>Ваше Имя</label>
          <input type="text" id="name" placeholder="Иван" required>
          
          <label>Номер телефона</label>
          <input type="tel" id="phone" placeholder="+7 (___) ___-__-__" required>
          
          <button type="submit" id="submitBtn">Выпустить карту</button>
        </form>
      </div>

      <script>
        const phoneInput = document.getElementById('phone');
        
        phoneInput.addEventListener('input', function (e) {
            // Внутри шаблонной строки (backticks) слеши теряются, поэтому используем [^0-9]
            let val = e.target.value.replace(/[^0-9]/g, '');
            
            if (!val) {
                e.target.value = '';
                return;
            }
            
            if (val[0] === '8') val = '7' + val.substring(1);
            if (val[0] !== '7') val = '7' + val;
            
            val = val.substring(0, 11);
            
            let formatted = '+7';
            if (val.length > 1) formatted += ' (' + val.substring(1, 4);
            if (val.length >= 5) formatted += ') ' + val.substring(4, 7);
            if (val.length >= 8) formatted += '-' + val.substring(7, 9);
            if (val.length >= 10) formatted += '-' + val.substring(9, 11);
            
            e.target.value = formatted;
        });

        document.getElementById('regForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          // Проверяем, что номер введен полностью (должно быть 11 цифр)
          const rawPhone = phoneInput.value.replace(/[^0-9]/g, '');
          if (rawPhone.length !== 11) {
            alert('Пожалуйста, введите корректный номер телефона полностью.');
            return;
          }

          const btn = document.getElementById('submitBtn');
          const successDiv = document.getElementById('successMessage');
          const errorDiv = document.getElementById('errorMessage');
          
          btn.disabled = true;
          btn.innerText = 'Регистрация...';
          successDiv.style.display = 'none';
          errorDiv.style.display = 'none';
          
          try {
            const res = await fetch('/api/register-iiko', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: document.getElementById('name').value,
                phone: rawPhone
              })
            });
            
            const data = await res.json();
            if (res.ok) {
              successDiv.style.display = 'block';
              document.getElementById('regForm').reset();
            } else {
              throw new Error(data.error || 'Ошибка');
            }
          } catch (err) {
            errorDiv.innerText = err.message;
            errorDiv.style.display = 'block';
          } finally {
            btn.disabled = false;
            btn.innerText = 'Выпустить карту';
          }
        });
      </script>
    </body>
    </html>
  `);
});

// ==========================================
// 2. API РЕГИСТРАЦИИ (ТЕПЕРЬ В SUPABASE, БЕЗ IIKOCARD)
// ==========================================
app.post('/api/register-iiko', async (req, res) => {
  try {
    const { phone, name } = req.body;
    if (!phone) return res.status(400).json({ error: 'Номер телефона обязателен' });

    console.log(`Регистрация гостя в Supabase: ${name}, ${phone}`);
    
    // Сначала проверяем, не существует ли уже такой клиент
    const existingCustomer = await getCustomerByPhone(phone);
    if (existingCustomer) {
      return res.status(400).json({ error: 'Этот номер телефона уже зарегистрирован в бонусной системе.' });
    }

    // Сохраняем в нашу собственную базу Supabase
    const customer = await getOrCreateCustomerByPhone(phone, name);
    
    // Отправляем WhatsApp уведомление (отключено по просьбе пользователя)
    // sendWhatsAppMessage(phone, `Добро пожаловать, ${name}!\nВы успешно зарегистрированы в нашей бонусной системе. Ваш баланс: 0 бонусов.\n\nНазывайте этот номер телефона на кассе, чтобы копить кэшбэк!`);

    res.json({ success: true, customerId: customer.id });
  } catch (err) {
    console.error('Registration error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. ВНЕШНЯЯ СИСТЕМА ЛОЯЛЬНОСТИ (WEBHOOKS)
// Если вы используете встроенный iikoCard, эти эндпоинты вам не нужны, 
// так как iikoFront сам общается с iikoCloud.
// ==========================================

// Авторизация по токену для вебхуков
const webhookMiddleware = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!API_TOKEN || token !== `Bearer ${API_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

async function logIikoOperation(entry) {
  try {
    await supabase.from('iiko_operation_logs').insert([{
      order_id: entry.orderId || 'UNKNOWN',
      customer_id: entry.customerId || null,
      status: entry.status,
      duplicate: Boolean(entry.duplicate),
      discount_amount: entry.discountAmount || 0,
      earned_bonus: entry.earnedBonus || 0,
      order_total: entry.orderTotal || 0,
      cashback_percent: entry.cashbackPercent ?? null,
      balance: entry.balance ?? null,
      error_message: entry.errorMessage || null,
      payload: entry.payload || null
    }]);
  } catch (err) {
    console.error('Failed to log iiko operation:', err.message);
  }
}

app.get('/api/loyalty/config-check', webhookMiddleware, async (req, res) => {
  try {
    const settings = await getSettings();
    res.json({
      success: true,
      service: 'Bulka Bonus loyalty',
      timestamp: new Date().toISOString(),
      settings: {
        base_cashback_percent: settings.base_cashback_percent,
        tier_silver_th: settings.tier_silver_th,
        tier_silver_cb: settings.tier_silver_cb,
        tier_gold_th: settings.tier_gold_th,
        tier_gold_cb: settings.tier_gold_cb,
        tier_platinum_th: settings.tier_platinum_th,
        tier_platinum_cb: settings.tier_platinum_cb,
        max_discount_percent: settings.max_discount_percent
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.post('/api/loyalty/customer', webhookMiddleware, async (req, res) => {
  try {
    const { phone, name } = req.body;
    const customer = await getOrCreateCustomerByPhone(phone, name || 'Новый Гость');
    const settings = await getSettings();
    
    // Определяем текущий процент кэшбэка
    const tier = getTierInfo(customer.total_spent, settings);
    const currentCashbackPercent = tier.percent;

    res.json({
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        createdAt: customer.created_at || '',
        totalSpent: customer.total_spent || 0,
        cashbackPercent: currentCashbackPercent,
        tier: tier,
        maxDiscountPercent: settings.max_discount_percent,
        balances: [{ walletId: 'bonus-wallet', name: 'Бонусы', balance: customer.balance }]
      }
    });
  } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/loyalty/search', webhookMiddleware, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query is required' });

    const customers = await searchCustomers(query);
    const settings = await getSettings();

    const formattedCustomers = customers.map(customer => {
      const tier = getTierInfo(customer.total_spent, settings);
      const currentCashbackPercent = tier.percent;

      return {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        createdAt: customer.created_at || '',
        totalSpent: customer.total_spent || 0,
        cashbackPercent: currentCashbackPercent,
        tier: tier,
        maxDiscountPercent: settings.max_discount_percent,
        balances: [{ walletId: 'bonus-wallet', name: 'Бонусы', balance: customer.balance }]
      };
    });

    res.json({ customers: formattedCustomers });
  } catch (error) { 
    console.error(error); 
    res.status(500).json({ error: 'Internal server error' }); 
  }
});

app.post('/api/loyalty/calculate', webhookMiddleware, async (req, res) => {
  try {
    const { customerId, orderTotal, requestedBonusAmount } = req.body;
    const total = parseMoney(orderTotal, 'orderTotal');
    const requested = parseMoney(requestedBonusAmount || 0, 'requestedBonusAmount');
    const maxAllowedDiscount = Math.min(requested, total);
    res.json({ discountAmount: maxAllowedDiscount, message: "Расчет успешен" });
  } catch (error) { res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Internal server error' }); }
});

app.post('/api/loyalty/apply', webhookMiddleware, async (req, res) => {
  let logPayload = null;
  try {
    const { customerId, orderId, discountAmount, orderTotal } = req.body;
    const discount = parseMoney(discountAmount || 0, 'discountAmount');
    const total = parseMoney(orderTotal, 'orderTotal');
    if (!customerId || !orderId) return res.status(400).json({ error: 'customerId and orderId are required' });
    logPayload = { customerId, orderId, discountAmount: discount, orderTotal: total, payload: req.body };
    const settings = await getSettings();

    // Проверка лимита списания
    const maxAllowedDiscount = total * (settings.max_discount_percent / 100);
    if (discount > maxAllowedDiscount) {
      await logIikoOperation({
        ...logPayload,
        status: 'error',
        errorMessage: `Списание превышает лимит ${settings.max_discount_percent}%`,
        payload: req.body
      });
      return res.status(400).json({ error: `Списание превышает лимит ${settings.max_discount_percent}%` });
    }

    const realMoneyPaid = total - discount;

    // Получаем текущие траты клиента для определения процента
    const { supabase } = require('./supabase');
    const { data: customer } = await supabase.from('customers').select('total_spent, phone, telegram_id, balance').eq('id', customerId).single();
    const tier = getTierInfo(customer?.total_spent, settings);
    const cashbackPercent = tier.percent;

    const earnedBonus = Number((realMoneyPaid * (cashbackPercent / 100)).toFixed(2));
    const applyResult = await applyLoyaltyTransaction({
      customerId,
      orderId,
      discountAmount: discount,
      earnedBonus,
      orderTotal: total,
      realMoneyPaid
    });

    // Отправка Telegram и Push уведомлений
    if (!applyResult.duplicate && customer && (discount > 0 || earnedBonus > 0)) {
      const { sendMessage } = require('./telegram');
      let msg = `<b>Ваш заказ успешно оплачен!</b>\n\n`;
      msg += `<b>Сумма чека:</b> ${total} тнг\n`;
      if (discount > 0) msg += `<b>Списано:</b> ${discount} бонусов\n`;
      if (earnedBonus > 0) msg += `<b>Начислено:</b> ${earnedBonus} бонусов\n`;
      
      const newBalance = Number(applyResult.balance || 0);
      msg += `\n<b>Текущий баланс:</b> ${newBalance.toFixed(2)} бонусов\n\nСпасибо, что выбираете нас! `;
      
      if (customer.telegram_id) sendMessage(customer.telegram_id, msg).catch(err => console.error("Error sending TG msg:", err));
      if (customer.fcm_token) {
        const pushTitle = "Bulka Bonus: Заказ оплачен";
        let pushBody = `Чек: ${total} тнг. `;
        if (discount > 0) pushBody += `Списано: ${discount} бон. `;
        if (earnedBonus > 0) pushBody += `Начислено: ${earnedBonus} бон. `;
        pushBody += `Баланс: ${newBalance.toFixed(0)} бон.`;
        sendPushNotification(customer.fcm_token, pushTitle, pushBody).catch(err => console.error("Error sending Push msg:", err));
      }
    }

    if (!applyResult.duplicate) sendAppleWalletPush(customerId).catch(err => console.error('Push error:', err));
    await logIikoOperation({
      ...logPayload,
      status: 'success',
      duplicate: applyResult.duplicate,
      earnedBonus,
      cashbackPercent,
      balance: applyResult.balance
    });
    res.json({ success: true, duplicate: applyResult.duplicate, earnedBonus, cashbackPercent, balance: applyResult.balance });
  } catch (error) {
    console.error(error);
    if (logPayload || req.body) {
      await logIikoOperation({
        ...(logPayload || {}),
        orderId: logPayload?.orderId || req.body?.orderId || 'UNKNOWN',
        customerId: logPayload?.customerId || req.body?.customerId || null,
        status: 'error',
        errorMessage: error.message,
        payload: req.body || null
      });
    }
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Internal server error' });
  }
});

// ==========================================
// 3.5 WALLET API (Apple Wallet) — одноразовые токены
// ==========================================

// Хранилище одноразовых токенов: token -> { phone, expiresAt }
const walletTokens = new Map();

// Очистка устаревших токенов каждые 5 минут
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of walletTokens) {
    if (now > data.expiresAt) walletTokens.delete(token);
  }
}, 5 * 60 * 1000);

// API для генерации одноразового токена (вызывается из telegram.js)
app.post('/api/wallet/token', walletRateLimit, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    
    const token = crypto.randomBytes(32).toString('hex');
    walletTokens.set(token, {
      phone,
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 минут
    });
    
    const walletUrl = `https://${req.get('host')}/wallet/${token}`;
    res.json({ url: walletUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Промежуточная страница — открывается по одноразовому токену
app.get('/wallet/:token', async (req, res) => {
  const token = req.params.token;
  const tokenData = walletTokens.get(token);
  
  if (!tokenData || Date.now() > tokenData.expiresAt) {
    return res.status(410).send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ссылка истекла</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #1e140c; color: #fff;
    min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .card { background: #2a1e14; border-radius: 20px; padding: 40px 30px; text-align: center; max-width: 360px; }
  h1 { font-size: 22px; margin-bottom: 16px; } p { color: #aaa; font-size: 15px; line-height: 1.5; }
</style></head><body><div class="card">
  <h1>Ссылка истекла</h1>
  <p>Эта ссылка уже была использована или её срок действия истёк. Пожалуйста, откройте Telegram-бота и нажмите кнопку «Отправить номер телефона» заново.</p>
</div></body></html>`);
  }
  
  const appleDownloadUrl = `https://${req.get('host')}/api/wallet/download/${token}`;
  const googleDownloadUrl = `https://${req.get('host')}/api/wallet/google/download/${token}`;
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bulka Bonus — Добавить в Wallet</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: linear-gradient(135deg, #1e140c 0%, #3a2a1a 100%);
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 20px;
    }
    .card {
      background: #2a1e14; border-radius: 20px; padding: 40px 30px;
      text-align: center; max-width: 360px; width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1);
    }
    .logo { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; color: #fff; margin-bottom: 8px; }
    p { color: #baa68e; font-size: 15px; margin-bottom: 24px; line-height: 1.5; }
    
    .btn {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      width: 100%; padding: 14px 20px; border-radius: 12px; text-decoration: none;
      font-size: 17px; font-weight: 600; transition: transform 0.2s; margin-bottom: 12px;
    }
    .btn:active { transform: scale(0.96); }
    
    .btn-apple { background: #000; color: #fff; border: 1px solid #333; }
    .btn-google { background: #fff; color: #3c4043; border: 1px solid #dadce0; }
    
    .hint { margin-top: 20px; font-size: 12px; color: #665a4a; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo" style="font-weight:900; font-size:28px; color:#ffb300;">BULKA</div>
    <h1>Bulka Bonus Card</h1>
    <p>Выберите, куда сохранить вашу карту лояльности</p>
    
    <a href="${appleDownloadUrl}" class="btn btn-apple">
      <svg width="20" height="24" viewBox="0 0 384 512" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>
      Apple Wallet
    </a>
    
    <a href="${googleDownloadUrl}" class="btn btn-google">
      <svg width="24" height="24" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path fill="#4285F4" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/><path fill="#34A853" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/><path fill="#FBBC05" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/><path fill="#EA4335" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/></svg>
      Google Wallet
    </a>
    
    <p class="hint">Ссылки действуют 10 минут и являются одноразовыми</p>
  </div>
</body>
</html>`);
});

// Прямая ссылка на скачивание .pkpass файла (по токену)
app.get('/api/wallet/download/:token', async (req, res) => {
  const token = req.params.token;
  const tokenData = walletTokens.get(token);
  
  if (!tokenData || Date.now() > tokenData.expiresAt) {
    return res.status(410).send('Ссылка истекла. Запросите новую через Telegram-бота.');
  }
  
  // Удаляем токен — одноразовое использование
  walletTokens.delete(token);
  try {
    const phone = tokenData.phone;
    const { supabase } = require('./supabase');
    const { data: customer } = await supabase.from('customers').select('*').eq('phone', phone).single();
    if (!customer) return res.status(404).send('Customer not found');

    const buffer = await buildApplePassBuffer(customer, req.get('host'));
    
    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename=${customer.phone}.pkpass`
    });
    res.send(buffer);
  } catch (err) {
    console.error('Wallet generation error:', err);
    res.status(500).send('Error generating pass');
  }
});

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

// Ссылка на добавление в Google Wallet (генерация JWT по токену)
app.get('/api/wallet/google/download/:token', async (req, res) => {
  const token = req.params.token;
  const tokenData = walletTokens.get(token);
  
  if (!tokenData || Date.now() > tokenData.expiresAt) {
    return res.status(410).send('Ссылка истекла. Запросите новую через Telegram-бота.');
  }
  
  try {
    const phone = tokenData.phone;
    const { supabase } = require('./supabase');
    const { data: customer } = await supabase.from('customers').select('*').eq('phone', phone).single();
    if (!customer) return res.status(404).send('Customer not found');

    const settings = await getSettings();
    const tier = getTierInfo(customer.total_spent, settings);
    const saveUrl = await generateGoogleWalletUrl(customer, settings, tier);

    res.redirect(saveUrl);
  } catch (err) {
    console.error('Google Wallet generation error:', err);
    res.status(500).send('Error generating Google Wallet pass: ' + err.message);
  }
});

// Прямая ссылка на добавление в Google Wallet (по номеру телефона)
app.get('/api/wallet/google/direct', async (req, res) => {
  const phone = req.query.phone;
  if (!phone) return res.status(400).send('Phone required');
  
  try {
    const { supabase } = require('./supabase');
    const digitsOnly = phone.replace(/[^0-9]/g, '');
    const searchPattern = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : digitsOnly;
    const { data: customer } = await supabase.from('customers').select('*').ilike('phone', `%${searchPattern}%`).single();
    if (!customer) return res.status(404).send('Customer not found');

    const settings = await getSettings();
    const tier = getTierInfo(customer.total_spent, settings);
    const saveUrl = await generateGoogleWalletUrl(customer, settings, tier);

    res.redirect(saveUrl);
  } catch (err) {
    console.error('Google Wallet direct error:', err);
    res.status(500).send('Error generating Google Wallet pass: ' + err.message);
  }
});

// ==========================================
// 4. ADMIN PANEL UI & API
// ==========================================
const adminAuthMiddleware = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!ADMIN_PASSWORD || token !== `Bearer ${ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: 'Admin password is invalid or expired. Please log in again.' });
  }
  next();
};

app.use('/admin/api', adminRateLimit);

app.get('/admin/api/settings', adminAuthMiddleware, async (req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/admin/api/settings', adminAuthMiddleware, async (req, res) => {
  try {
    await updateSettings(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/admin/api/customers', adminAuthMiddleware, async (req, res) => {
  try {
    const data = await getAllCustomers();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/api/transactions', adminAuthMiddleware, async (req, res) => {
  try {
    const data = await getTransactions();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/api/stats', adminAuthMiddleware, async (req, res) => {
  try {
    const data = await getStats();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/api/iiko-operations', adminAuthMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('iiko_operation_logs')
      .select('*, customers(phone, name)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      if (error.code === '42P01') return res.json([]);
      throw error;
    }
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/api/customers/bonus', adminAuthMiddleware, async (req, res) => {
  try {
    const { customerId, amount, reason } = req.body;
    const parsedAmount = parseMoney(amount, 'amount', { min: -100000000 });
    await addManualBonus(customerId, parsedAmount, reason);
    sendAppleWalletPush(customerId).catch(err => console.error('Push error:', err));
    
    // Отправка уведомления гостю
    try {
      const { data: c } = await supabase.from('customers').select('*').eq('id', customerId).single();
      if (c) {
        const { sendMessage } = require('./telegram');
        const actionTxt = amount >= 0 ? `Начислено: +${amount} бонусов` : `Списано: ${amount} бонусов`;
        const msg = `<b>Изменение баланса баллов!</b>\n\n${actionTxt}\n<b>Причина:</b> ${reason || 'Корректировка администратором'}\n<b>Текущий баланс:</b> ${c.balance} бон.`;
        if (c.telegram_id) sendMessage(c.telegram_id, msg).catch(() => {});
        if (c.fcm_token) sendPushNotification(c.fcm_token, "Bulka Bonus: Баланс обновлен", `${actionTxt}. Баланс: ${c.balance} бон.`).catch(() => {});
      }
    } catch (e) { console.error("Notify bonus error:", e); }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/api/customers/update', adminAuthMiddleware, async (req, res) => {
  try {
    const { customerId, name, phone, balance, total_spent } = req.body;
    await updateCustomerInfo(customerId, { name, phone, balance, total_spent });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/api/customers/expire-inactive', adminAuthMiddleware, async (req, res) => {
  try {
    const days = req.body.days || 90;
    const result = await checkAndExpireInactiveBonuses(days);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/api/customers/notify-inactive', adminAuthMiddleware, async (req, res) => {
  try {
    const days = req.body.days || 30;
    const result = await checkAndNotifyInactiveCustomers(days);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/admin/api/customers/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const { deleteCustomer } = require('./customers');
    await deleteCustomer(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/api/broadcast', adminAuthMiddleware, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const { supabase } = require('./supabase');
    const { data: customers } = await supabase.from('customers').select('telegram_id').not('telegram_id', 'is', null);
    
    if (!customers || customers.length === 0) {
      return res.json({ success: true, count: 0 });
    }

    const { sendMessage } = require('./telegram');
    let count = 0;
    
    // Отправляем асинхронно, чтобы не блокировать ответ
    // Telegram limit is 30 msg/sec, so 1 msg per 50ms is safe. Let's use 100ms.
    (async () => {
      for (const c of customers) {
        if (c.telegram_id || c.fcm_token) {
          if (c.telegram_id) await sendMessage(c.telegram_id, message).catch(() => {});
          if (c.fcm_token) {
            const cleanText = message.replace(/<[^>]*>/g, '');
            await sendPushNotification(c.fcm_token, "Bulka Bonus: Новая акция!", cleanText).catch(() => {});
          }
          count++;
          await new Promise(r => setTimeout(r, 100)); // 100ms delay to prevent rate limiting
        }
      }
      console.log(`Broadcast finished. Sent to ${count} customers.`);
    })();

    res.json({ success: true, count: customers.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/api/stories', adminAuthMiddleware, async (req, res) => {
  try {
    const stories = await getStories();
    res.json({ success: true, stories });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/api/stories', adminAuthMiddleware, async (req, res) => {
  try {
    const story = await addStory(req.body);
    res.json({ success: true, story });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/admin/api/stories/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const story = await updateStory(req.params.id, req.body);
    res.json({ success: true, story });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/admin/api/stories/:id', adminAuthMiddleware, async (req, res) => {
  try {
    await deleteStory(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/api/upload', adminAuthMiddleware, async (req, res) => {
  try {
    const { imageBase64, filename } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'No image provided' });
    if (!/^data:image\/(jpeg|jpg|png|webp|gif);base64,/.test(imageBase64)) {
      return res.status(400).json({ error: 'Unsupported image type' });
    }

    const { supabase } = require('./supabase');
    
    // Auto-create public bucket 'stories' if not exists
    try {
      const { data: buckets } = await supabase.storage.listBuckets();
      if (buckets && !buckets.some(b => b.name === 'stories')) {
        await supabase.storage.createBucket('stories', {
          public: true,
          fileSizeLimit: 10485760
        });
      }
    } catch (e) {
      console.error('Bucket check note:', e.message);
    }

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image is too large' });
    }
    const extRaw = filename ? filename.split('.').pop() : 'jpg';
    const ext = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(String(extRaw).toLowerCase()) ? String(extRaw).toLowerCase() : 'jpg';
    const filePath = `photo_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;

    const { data, error } = await supabase.storage
      .from('stories')
      .upload(filePath, buffer, {
        contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
        upsert: true
      });

    if (error) {
      console.error('Supabase storage upload error:', error);
      return res.status(500).json({ error: error.message });
    }

    const { data: { publicUrl } } = supabase.storage
      .from('stories')
      .getPublicUrl(filePath);

    res.json({ success: true, url: publicUrl });
  } catch (err) {
    console.error('Upload handler exception:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ==========================================
// 5. GUEST MINI APP API & UI
// ==========================================
app.post('/api/auth/request-otp', authRateLimit, async (req, res) => {
  try {
    const { token } = req.body;
    const phone = normalizePhone(req.body.phone);
    if (!phone || phone.replace(/[^0-9]/g, '').length < 10) return res.status(400).json({ error: 'Valid phone required' });
    
    let customer = await getOrCreateCustomerByPhone(phone, 'Гость (Android App)');
    
    // If a token was provided, save it so the WhatsApp bot can map it to this phone number
    if (token) {
        await supabase.from('whatsapp_sessions').upsert({ 
            id: `token_${token}`, 
            data: JSON.stringify({ phone, expires: Date.now() + 10 * 60 * 1000 }) 
        });
        console.log(`[AUTH] Saved token ${token} for phone ${phone}`);
    }
    
    // Check if valid OTP already exists (e.g. from WhatsApp bot)
    let code;
    const existing = await otpStore.get(phone);
    if (existing && existing.expires > Date.now()) {
        code = existing.code;
    } else {
        code = Math.floor(1000 + Math.random() * 9000).toString();
        await otpStore.set(phone, { code, expires: Date.now() + 5 * 60 * 1000 });
    }
    
    res.json({ success: true, viaTelegram: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/verify-otp', authRateLimit, async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const { code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'Phone and code required' });
    
    console.log(`[VERIFY-OTP] Attempting verify for phone="${phone}", code="${code}"`);
    const stored = await otpStore.get(phone);
    if (!stored) {
        return res.json({ success: false, error: 'expired', message: 'Код устарел или не был запрошен' });
    }
    
    if (Date.now() > stored.expires) {
        await otpStore.delete(phone);
        return res.json({ success: false, error: 'expired', message: 'Время действия кода истекло' });
    }
    
    if (stored.code !== code) {
        return res.json({ success: false, error: 'invalid', message: 'Неверный код' });
    }
    
    // Success - clear OTP and return profile
    await otpStore.delete(phone);
    
    let customer = await getCustomerByPhone(phone);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    
    const settings = await getSettings();
    const tier = getTierInfo(customer.total_spent, settings);
    const vipThreshold = settings.vip_threshold || 300000;
    const isVip = tier.name === 'Платина';
    const cashbackPercent = tier.percent;

    const { data: transactions } = await supabase
      .from('transactions')
      .select('*')
      .eq('customer_id', customer.id)
      .order('timestamp', { ascending: false })
      .limit(20);

    res.json({
      success: true,
      exists: true,
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        balance: customer.balance,
        total_spent: customer.total_spent,
        created_at: customer.created_at,
        isVip,
        cashbackPercent,
        vipThreshold,
        tier
      },
      transactions: transactions || []
    });
    
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/customer/fcm-token', async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const { fcmToken } = req.body;
    if (!phone || !fcmToken) return res.status(400).json({ error: 'phone and fcmToken required' });
    await updateFcmToken(phone, fcmToken);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/guest/profile', async (req, res) => {
  try {
    const { name, register, fcmToken } = req.body;
    const phone = normalizePhone(req.body.phone);
    if (!phone || phone.replace(/[^0-9]/g, '').length < 10) return res.status(400).json({ error: 'Valid phone required' });

    let customer = await getCustomerByPhone(phone);
    if (!customer) {
      if (register) {
        customer = await getOrCreateCustomerByPhone(phone, name || 'Новый Гость');
      } else {
        return res.json({ exists: false });
      }
    }

    if (fcmToken && customer.fcm_token !== fcmToken) {
      await updateFcmToken(phone, fcmToken);
      customer.fcm_token = fcmToken;
    }

    const settings = await getSettings();
    const tier = getTierInfo(customer.total_spent, settings);
    const vipThreshold = settings.vip_threshold || 300000;
    const isVip = tier.name === 'Платина';
    const cashbackPercent = tier.percent;

    // Получаем последние транзакции клиента
    const { data: transactions } = await supabase
      .from('transactions')
      .select('*')
      .eq('customer_id', customer.id)
      .order('timestamp', { ascending: false })
      .limit(20);

    res.json({
      exists: true,
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        balance: customer.balance,
        total_spent: customer.total_spent,
        created_at: customer.created_at,
        isVip,
        cashbackPercent,
        vipThreshold,
        tier
      },
      transactions: transactions || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/guest/qr-token', authRateLimit, async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const customer = await getCustomerByPhone(phone);
    if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });
    res.json({ success: true, ...buildDynamicQrToken(customer.phone) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

app.get('/api/guest/menu', async (req, res) => {
  try {
    const rawMenu = await iikoApi.getMenu();
    
    // Categories
    let categories = (rawMenu.groups || [])
      .filter(g => g.isIncludedInMenu)
      .map(g => ({
        id: g.id,
        name: g.name,
        order: g.order || 0
      }))
      .sort((a, b) => a.order - b.order);

    // Fallback: если в iiko не проставлен флаг isIncludedInMenu, берём все группы
    if (categories.length === 0 && rawMenu.groups) {
      categories = rawMenu.groups.map(g => ({
        id: g.id,
        name: g.name,
        order: g.order || 0
      })).sort((a, b) => a.order - b.order);
    }

    // Products
    let productsList = (rawMenu.products || [])
      .filter(p => p.type === 'Dish' || p.type === 'Good');
      
    // Fallback: если тип блюда отличается, берем все товары
    if (productsList.length === 0 && rawMenu.products) {
      productsList = rawMenu.products;
    }

    const products = productsList.map(p => {
        let price = 0;
        if (p.sizePrices && p.sizePrices.length > 0) {
          price = p.sizePrices[0].price.currentPrice;
        }

        let imageUrl = null;
        if (p.imageLinks && p.imageLinks.length > 0) {
          imageUrl = p.imageLinks[0];
        }

        return {
          id: p.id,
          name: p.name,
          description: p.description || '',
          price: price,
          categoryId: p.parentGroup,
          imageUrl: imageUrl
        };
      });

    res.json({ 
      success: true, 
      categories, 
      products,
      debug: {
        totalGroupsRaw: rawMenu.groups?.length || 0,
        totalProductsRaw: rawMenu.products?.length || 0,
        selectedOrgName: rawMenu.orgName || iikoApi.organizationId
      }
    });
  } catch (error) {
    console.error('Ошибка получения меню:', error);
    res.json({ success: false, error: 'Не удалось загрузить меню: ' + (error.message || error) });
  }
});

app.get('/api/guest/stories', async (req, res) => {
  try {
    const stories = await getStories();
    res.json({ success: true, stories });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/guest/test-menu', async (req, res) => {
  try {
    const token = await iikoApi.getToken();
    const orgsRes = await fetch(`${iikoApi.baseUrl}/api/1/organizations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ returnAdditionalInfo: false, includeDisabled: false })
    });
    const orgsData = await orgsRes.json();
    const orgs = orgsData.organizations || [];

    const extRes = await fetch(`${iikoApi.baseUrl}/api/2/menu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ organizationIds: orgs.map(o => o.id) })
    });
    const extData = extRes.ok ? await extRes.json() : { error: extRes.status };

    res.json({
      success: true,
      totalStores: orgs.length,
      stores: orgs.map(o => ({ id: o.id, name: o.name })),
      externalMenusV2: extData
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get(['/app', '/wallet', '/guest'], (req, res) => {
  res.sendFile(path.join(__dirname, 'app.html'));
});


// ==========================================
// 3.6 APPLE WALLET WEB SERVICE
// ==========================================

app.post('/api/wallet/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber', express.json(), async (req, res) => {
  const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = req.params;
  const pushToken = req.body.pushToken;
  if (!pushToken) return res.status(400).send();
  const { supabase } = require('./supabase');
  await supabase.from('wallet_registrations').upsert({
    device_id: deviceLibraryIdentifier,
    push_token: pushToken,
    pass_type_id: passTypeIdentifier,
    serial_number: serialNumber
  }, { onConflict: 'device_id,serial_number' });
  res.status(201).send();
});

app.delete('/api/wallet/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber', async (req, res) => {
  const { deviceLibraryIdentifier, serialNumber } = req.params;
  const { supabase } = require('./supabase');
  await supabase.from('wallet_registrations')
    .delete()
    .match({ device_id: deviceLibraryIdentifier, serial_number: serialNumber });
  res.status(200).send();
});

app.get('/api/wallet/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier', async (req, res) => {
  const { deviceLibraryIdentifier, passTypeIdentifier } = req.params;
  const { supabase } = require('./supabase');
  const { data } = await supabase.from('wallet_registrations')
    .select('serial_number')
    .eq('device_id', deviceLibraryIdentifier)
    .eq('pass_type_id', passTypeIdentifier);
  if (!data || data.length === 0) return res.status(204).send();
  res.json({ lastUpdated: Date.now().toString(), serialNumbers: data.map(r => r.serial_number) });
});

app.get('/api/wallet/v1/passes/:passTypeIdentifier/:serialNumber', async (req, res) => {
  const { serialNumber } = req.params;
  const customerId = serialNumber.replace('bulka-', '');
  const { supabase } = require('./supabase');
  const { data: customer } = await supabase.from('customers').select('*').eq('id', customerId).single();
  if (!customer) return res.status(404).send();
  try {
    const buffer = await buildApplePassBuffer(customer, req.get('host'));
    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename=${customer.phone}.pkpass`
    });
    res.send(buffer);
  } catch(err) {
    console.error(err);
    res.status(500).send();
  }
});

app.post('/api/wallet/v1/log', express.json(), (req, res) => {
  console.log("Apple Wallet Logs:", req.body.logs);
  res.status(200).send();
});

app.get('/health', (req, res) => res.send('iiko Bonus API is running'));

// ==========================================
// 6. TELEGRAM WEBHOOK (Vercel Serverless)
// ==========================================
app.post('/api/telegram/webhook', async (req, res) => {
  try {
    const telegramBot = require('./telegram');
    await telegramBot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Error');
  }
});

app.get('/api/telegram/set-webhook', async (req, res) => {
  const url = req.query.url; // например: https://your-project.vercel.app/api/telegram/webhook
  if (!url) return res.status(400).send('Please provide ?url=https://your-domain.vercel.app/api/telegram/webhook');
  const telegramBot = require('./telegram');
  const result = await telegramBot.setWebhook(url);
  res.json(result);
});

// Автоматическая проверка сгорания бонусов и напоминания об оттоке при запуске (через 15 секунд) и затем раз в сутки
setTimeout(() => {
  checkAndExpireInactiveBonuses(90).catch(err => console.error('Error auto-expiring bonuses:', err));
  checkAndNotifyInactiveCustomers(30).catch(err => console.error('Error auto-notifying inactive customers:', err));
}, 15000);
setInterval(() => {
  checkAndExpireInactiveBonuses(90).catch(err => console.error('Error auto-expiring bonuses:', err));
  checkAndNotifyInactiveCustomers(30).catch(err => console.error('Error auto-notifying inactive customers:', err));
}, 24 * 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    // Запуск Telegram-бота (long-polling в режиме обычного сервера)
    const telegramBot = require('./telegram');
    telegramBot.startPolling();
    // Запуск WhatsApp-бота (Baileys)
    initWhatsApp(otpStore, getOrCreateCustomerByPhone);
  });
}
module.exports = { app, getTierInfo };

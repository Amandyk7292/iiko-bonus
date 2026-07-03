const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { PKPass } = require('passkit-generator');
const fs = require('fs');
const path = require('path');
const { supabase } = require('./supabase');
const iikoApi = require('./iiko-api');

const { getCustomerByPhone, getOrCreateCustomerByPhone, searchCustomers, updateCustomerBalance, updateCustomerInfo, logTransaction, getAllCustomers, getTransactions, getStats, addManualBonus, checkAndExpireInactiveBonuses } = require('./customers');
const { getSettings, updateSettings } = require('./settings');
const { sendWhatsAppMessage } = require('./whatsapp');

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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Для form submit

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
    // sendWhatsAppMessage(phone, `🎉 Добро пожаловать, ${name}!\nВы успешно зарегистрированы в нашей бонусной системе. Ваш баланс: 0 бонусов.\n\nНазывайте этот номер телефона на кассе, чтобы копить кэшбэк!`);

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
const API_TOKEN = process.env.API_TOKEN || 'secret-token';
const webhookMiddleware = (req, res, next) => {
  const token = req.headers['authorization'];
  if (token && token !== `Bearer ${API_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

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
    const maxAllowedDiscount = Math.min(requestedBonusAmount || 0, orderTotal);
    res.json({ discountAmount: maxAllowedDiscount, message: "Расчет успешен" });
  } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/loyalty/apply', webhookMiddleware, async (req, res) => {
  try {
    const { customerId, orderId, discountAmount, orderTotal } = req.body;
    const settings = await getSettings();

    // Проверка лимита списания
    const maxAllowedDiscount = orderTotal * (settings.max_discount_percent / 100);
    if (discountAmount > maxAllowedDiscount) {
      return res.status(400).json({ error: `Списание превышает лимит ${settings.max_discount_percent}%` });
    }

    if (discountAmount > 0) {
      await updateCustomerBalance(customerId, -discountAmount);
      await logTransaction({ customerId, orderId, type: 'withdrawal', amount: discountAmount, orderTotal: orderTotal });
    }

    const realMoneyPaid = orderTotal - (discountAmount || 0);

    // Получаем текущие траты клиента для определения процента
    const { supabase } = require('./supabase');
    const { data: customer } = await supabase.from('customers').select('total_spent, phone, telegram_id, balance').eq('id', customerId).single();
    const tier = getTierInfo(customer?.total_spent, settings);
    const cashbackPercent = tier.percent;

    const earnedBonus = Number((realMoneyPaid * (cashbackPercent / 100)).toFixed(2));
    
    if (earnedBonus > 0) {
      await updateCustomerBalance(customerId, earnedBonus);
      await logTransaction({ customerId, orderId, type: 'deposit', amount: earnedBonus, orderTotal: realMoneyPaid });
    }

    // Отправка Telegram уведомления
    if (customer && customer.telegram_id && (discountAmount > 0 || earnedBonus > 0)) {
      const { sendMessage } = require('./telegram');
      let msg = `🧾 <b>Ваш заказ успешно оплачен!</b>\n\n`;
      msg += `🛍 <b>Сумма чека:</b> ${orderTotal} тнг\n`;
      if (discountAmount > 0) msg += `➖ <b>Списано:</b> ${discountAmount} бонусов\n`;
      if (earnedBonus > 0) msg += `➕ <b>Начислено:</b> ${earnedBonus} бонусов\n`;
      
      const newBalance = Number(customer.balance || 0) - (discountAmount || 0) + (earnedBonus || 0);
      msg += `\n💰 <b>Текущий баланс:</b> ${newBalance.toFixed(2)} бонусов\n\nСпасибо, что выбираете нас! 💚`;
      
      sendMessage(customer.telegram_id, msg).catch(err => console.error("Error sending TG msg:", err));
    }

    res.json({ success: true, earnedBonus, cashbackPercent });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Internal server error' }); }
});

// ==========================================
// 3.5 WALLET API (Apple Wallet)
// ==========================================

// Промежуточная страница — она открывается в Telegram, затем перенаправляет на скачивание .pkpass
app.get('/wallet/:phone', async (req, res) => {
  const phone = req.params.phone;
  const downloadUrl = `https://${req.get('host')}/api/wallet/download/${phone}`;
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bulka Bonus — Apple Wallet</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: linear-gradient(135deg, #f5e6d3 0%, #d4a574 100%);
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 20px;
    }
    .card {
      background: white; border-radius: 20px; padding: 40px 30px;
      text-align: center; max-width: 360px; width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.15);
    }
    .logo { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; color: #333; margin-bottom: 8px; }
    p { color: #666; font-size: 15px; margin-bottom: 24px; line-height: 1.5; }
    .btn {
      display: inline-block; background: #000; color: #fff;
      padding: 14px 32px; border-radius: 12px; text-decoration: none;
      font-size: 17px; font-weight: 600; transition: transform 0.2s;
    }
    .btn:active { transform: scale(0.96); }
    .hint { margin-top: 20px; font-size: 12px; color: #999; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🍞</div>
    <h1>Bulka Bonus Card</h1>
    <p>Нажмите кнопку ниже, чтобы добавить вашу карту лояльности в Apple Wallet</p>
    <a href="${downloadUrl}" class="btn"> Добавить в Wallet</a>
    <p class="hint">Если карта не открылась автоматически, откройте эту страницу в Safari</p>
  </div>
  <script>
    // Автоматически начать скачивание
    setTimeout(function() { window.location.href = "${downloadUrl}"; }, 500);
  </script>
</body>
</html>`);
});


// Обратная совместимость — старые ссылки перенаправляем на промежуточную страницу
app.get('/api/wallet/apple/:phone', (req, res) => {
  res.redirect('/wallet/' + req.params.phone);
});

// Прямая ссылка на скачивание .pkpass файла
app.get('/api/wallet/download/:phone', async (req, res) => {
  try {
    const phone = req.params.phone;
    const { supabase } = require('./supabase');
    const { data: customer } = await supabase.from('customers').select('*').eq('phone', phone).single();
    if (!customer) return res.status(404).send('Customer not found');

    const settings = await getSettings();
    const tier = getTierInfo(customer.total_spent, settings);

    // Получение сертификатов из ENV или файлов
    const signerCert = process.env.WALLET_CERT 
      ? Buffer.from(process.env.WALLET_CERT, 'base64') 
      : fs.readFileSync(path.join(__dirname, 'wallet_cert.pem'));
    const signerKey = process.env.WALLET_KEY 
      ? Buffer.from(process.env.WALLET_KEY, 'base64') 
      : fs.readFileSync(path.join(__dirname, 'wallet_private_key.pem'));
    const wwdr = process.env.WALLET_WWDR 
      ? Buffer.from(process.env.WALLET_WWDR, 'base64') 
      : fs.readFileSync(path.join(__dirname, 'wwdr.pem'));

    // Динамически собираем pass.json с реальными данными клиента
    const passJson = {
      formatVersion: 1,
      passTypeIdentifier: 'pass.com.bulka.bonus',
      serialNumber: `bulka-${customer.id}`,
      teamIdentifier: 'GKRRT4JU9G',
      organizationName: 'Bulka Bakery',
      description: 'Карта лояльности пекарни Bulka',
      logoText: 'Bulka Bonus',
      foregroundColor: 'rgb(255, 255, 255)',
      backgroundColor: 'rgb(139, 90, 43)',
      labelColor: 'rgb(247, 244, 234)',
      barcode: {
        message: customer.phone,
        format: 'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1'
      },
      barcodes: [{
        message: customer.phone,
        format: 'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1'
      }],
      storeCard: {
        headerFields: [{
          key: 'balance',
          label: 'БАЛАНС',
          value: `${customer.balance || 0} ₸`
        }],
        primaryFields: [{
          key: 'name',
          label: 'ГОСТЬ',
          value: customer.name || 'Гость'
        }],
        secondaryFields: [{
          key: 'status',
          label: 'СТАТУС',
          value: `${tier.name} (${tier.percent}%)`
        }],
        auxiliaryFields: [{
          key: 'phone',
          label: 'ТЕЛЕФОН',
          value: customer.phone
        }, {
          key: 'spent',
          label: 'ВСЕГО ПОКУПОК',
          value: `${(customer.total_spent || 0).toLocaleString()} ₸`
        }]
      }
    };

    const pass = new PKPass(
      {
        'pass.json': Buffer.from(JSON.stringify(passJson)),
        'logo.png': fs.readFileSync(path.join(__dirname, 'pass.model', 'logo.png')),
        'logo@2x.png': fs.readFileSync(path.join(__dirname, 'pass.model', 'logo@2x.png')),
        'icon.png': fs.readFileSync(path.join(__dirname, 'pass.model', 'icon.png')),
        'icon@2x.png': fs.readFileSync(path.join(__dirname, 'pass.model', 'icon@2x.png')),
        'strip.png': fs.readFileSync(path.join(__dirname, 'pass.model', 'strip.png')),
        'strip@2x.png': fs.readFileSync(path.join(__dirname, 'pass.model', 'strip@2x.png'))
      },
      { signerCert, signerKey, wwdr }
    );

    const buffer = await pass.getAsBuffer();
    
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

// ==========================================
// 4. ADMIN PANEL UI & API
// ==========================================
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';

const adminAuthMiddleware = (req, res, next) => {
  const token = req.headers['authorization'];
  if (token !== `Bearer ${ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

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

app.post('/admin/api/customers/bonus', adminAuthMiddleware, async (req, res) => {
  try {
    const { customerId, amount, reason } = req.body;
    await addManualBonus(customerId, amount, reason);
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
        if (c.telegram_id) {
          await sendMessage(c.telegram_id, message);
          count++;
          await new Promise(r => setTimeout(r, 100)); // 100ms delay to prevent rate limiting
        }
      }
      console.log(`Broadcast finished. Sent ${count} messages.`);
    })();

    res.json({ success: true, count: customers.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ==========================================
// 5. GUEST MINI APP API & UI
// ==========================================
app.post('/api/guest/profile', async (req, res) => {
  try {
    const { phone, name, register } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    let customer = await getCustomerByPhone(phone);
    if (!customer) {
      if (register) {
        customer = await getOrCreateCustomerByPhone(phone, name || 'Новый Гость');
      } else {
        return res.json({ exists: false });
      }
    }

    const settings = await getSettings();
    const vipThreshold = settings.vip_threshold || 300000;
    const isVip = (Number(customer.total_spent) || 0) >= vipThreshold;
    const cashbackPercent = isVip ? (settings.vip_cashback_percent || 5) : (settings.base_cashback_percent || 3);

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
        vipThreshold
      },
      transactions: transactions || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get(['/app', '/wallet', '/guest'], (req, res) => {
  res.sendFile(path.join(__dirname, 'app.html'));
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

// Автоматическая проверка сгорания бонусов при запуске (через 15 секунд) и затем раз в сутки
setTimeout(() => {
  checkAndExpireInactiveBonuses(90).catch(err => console.error('Error auto-expiring bonuses:', err));
}, 15000);
setInterval(() => {
  checkAndExpireInactiveBonuses(90).catch(err => console.error('Error auto-expiring bonuses:', err));
}, 24 * 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    // Запуск Telegram-бота (long-polling в режиме обычного сервера)
    const telegramBot = require('./telegram');
    telegramBot.startPolling();
  });
}
module.exports = { app, getTierInfo };

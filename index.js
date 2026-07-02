const express = require('express');
const cors = require('cors');
require('dotenv').config();
const path = require('path');
const iikoApi = require('./iiko-api');

const { getCustomerByPhone, getOrCreateCustomerByPhone, searchCustomers, updateCustomerBalance, logTransaction, getAllCustomers, getTransactions, getStats, addManualBonus } = require('./customers');
const { getSettings, updateSettings } = require('./settings');
const { sendWhatsAppMessage } = require('./whatsapp');

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
    const { phone } = req.body;
    const customer = await getOrCreateCustomerByPhone(phone);
    const settings = await getSettings();
    
    // Определяем текущий процент кэшбэка
    const isVip = (customer.total_spent || 0) >= settings.vip_threshold;
    const currentCashbackPercent = isVip ? settings.vip_cashback_percent : settings.base_cashback_percent;

    res.json({
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        totalSpent: customer.total_spent || 0,
        cashbackPercent: currentCashbackPercent,
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
      const isVip = (customer.total_spent || 0) >= settings.vip_threshold;
      const currentCashbackPercent = isVip ? settings.vip_cashback_percent : settings.base_cashback_percent;

      return {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        totalSpent: customer.total_spent || 0,
        cashbackPercent: currentCashbackPercent,
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
      await logTransaction({ customerId, orderId, type: 'withdrawal', amount: discountAmount });
    }

    const realMoneyPaid = orderTotal - (discountAmount || 0);

    // Получаем текущие траты клиента для определения процента
    const { supabase } = require('./supabase');
    const { data: customer } = await supabase.from('customers').select('total_spent, phone').eq('id', customerId).single();
    const isVip = (customer?.total_spent || 0) >= settings.vip_threshold;
    const cashbackPercent = isVip ? settings.vip_cashback_percent : settings.base_cashback_percent;

    const earnedBonus = Math.floor(realMoneyPaid * (cashbackPercent / 100));
    
    if (earnedBonus > 0) {
      await updateCustomerBalance(customerId, earnedBonus);
      await logTransaction({ customerId, orderId, type: 'deposit', amount: earnedBonus, orderTotal: realMoneyPaid });
    }

    // Отправка WhatsApp уведомления (отключено по просьбе пользователя)
    /*
    if (customer) {
      let msg = `Чек на сумму ${orderTotal} тнг.\n`;
      if (discountAmount > 0) msg += `➖ Списано: ${discountAmount} бонусов\n`;
      if (earnedBonus > 0) msg += `➕ Начислено: ${earnedBonus} бонусов\n`;
      msg += `\nСпасибо, что выбираете нас!`;
      sendWhatsAppMessage(customer.phone, msg);
    }
    */

    res.json({ success: true, earnedBonus, cashbackPercent });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Internal server error' }); }
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

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/health', (req, res) => res.send('iiko Bonus API is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

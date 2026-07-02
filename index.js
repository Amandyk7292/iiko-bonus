const express = require('express');
const cors = require('cors');
require('dotenv').config();
const path = require('path');
const iikoApi = require('./iiko-api');

// Если нужен кастомный бэкенд на Firebase, оставляем, но сейчас упор на iiko API
const { getOrCreateCustomerByPhone, updateCustomerBalance, logTransaction } = require('./customers');
const { getSettings, updateSettings } = require('./settings');

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
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f3f4f6; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); max-width: 400px; width: 100%; }
        h1 { margin-top: 0; font-size: 1.5rem; color: #111827; }
        label { display: block; margin-bottom: 0.5rem; color: #374151; font-weight: 500; }
        input { width: 100%; padding: 0.75rem; margin-bottom: 1.5rem; border: 1px solid #d1d5db; border-radius: 6px; box-sizing: border-box; }
        button { width: 100%; padding: 0.75rem; background: #ef4444; color: white; border: none; border-radius: 6px; font-size: 1rem; font-weight: bold; cursor: pointer; }
        button:hover { background: #dc2626; }
        .success { color: #059669; background: #d1fae5; padding: 1rem; border-radius: 6px; display: none; margin-bottom: 1rem; }
        .error { color: #dc2626; background: #fee2e2; padding: 1rem; border-radius: 6px; display: none; margin-bottom: 1rem; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Регистрация карты</h1>
        <p style="color: #6b7280; margin-bottom: 1.5rem; font-size: 0.875rem;">Зарегистрируйтесь, чтобы копить бонусы в нашей пекарне и оплачивать ими покупки на кассе!</p>
        
        <div id="successMessage" class="success">Вы успешно зарегистрированы! Теперь вы можете называть свой номер на кассе.</div>
        <div id="errorMessage" class="error">Произошла ошибка при регистрации.</div>

        <form id="regForm">
          <label>Ваше Имя</label>
          <input type="text" id="name" placeholder="Например: Иван" required>
          
          <label>Номер телефона</label>
          <input type="tel" id="phone" placeholder="+7 (700) 123-45-67" required>
          
          <button type="submit" id="submitBtn">Получить карту</button>
        </form>
      </div>

      <script>
        document.getElementById('regForm').addEventListener('submit', async (e) => {
          e.preventDefault();
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
                phone: document.getElementById('phone').value
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
            btn.innerText = 'Получить карту';
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
    // Сохраняем в нашу собственную базу Supabase
    const customer = await getOrCreateCustomerByPhone(phone, name);
    
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
    const { data: customer } = await supabase.from('customers').select('total_spent').eq('id', customerId).single();
    const isVip = (customer?.total_spent || 0) >= settings.vip_threshold;
    const cashbackPercent = isVip ? settings.vip_cashback_percent : settings.base_cashback_percent;

    const earnedBonus = Math.floor(realMoneyPaid * (cashbackPercent / 100));
    
    if (earnedBonus > 0) {
      await updateCustomerBalance(customerId, earnedBonus);
      await logTransaction({ customerId, orderId, type: 'deposit', amount: earnedBonus, orderTotal: realMoneyPaid });
    }
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

app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Управление Бонусной Системой</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Outfit', sans-serif; background: #0f172a; color: #f8fafc; }
        .glass { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.1); }
        .gradient-text { background: linear-gradient(to right, #38bdf8, #818cf8); -webkit-background-clip: text; color: transparent; }
        input { background: #0f172a; border: 1px solid #334155; color: white; transition: all 0.3s; }
        input:focus { outline: none; border-color: #38bdf8; box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2); }
        .btn-glow { background: linear-gradient(to right, #38bdf8, #818cf8); transition: all 0.3s; }
        .btn-glow:hover { box-shadow: 0 0 15px rgba(56, 189, 248, 0.5); transform: translateY(-1px); }
      </style>
    </head>
    <body class="min-h-screen flex items-center justify-center p-4">
      
      <!-- Modal Auth -->
      <div id="authModal" class="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 transition-opacity duration-300">
        <div class="glass p-8 rounded-2xl w-full max-w-sm text-center transform transition-transform scale-100">
          <h2 class="text-2xl font-bold mb-6 gradient-text">Авторизация</h2>
          <input type="password" id="adminPwd" placeholder="Пароль администратора" class="w-full px-4 py-3 rounded-xl mb-4 text-center text-lg tracking-widest">
          <button onclick="login()" class="btn-glow w-full py-3 rounded-xl font-bold text-white shadow-lg">Войти</button>
          <p id="authError" class="text-red-400 mt-4 hidden text-sm">Неверный пароль</p>
        </div>
      </div>

      <!-- Dashboard -->
      <div id="dashboard" class="w-full max-w-2xl glass p-8 rounded-3xl hidden">
        <div class="flex justify-between items-center mb-8">
          <h1 class="text-3xl font-extrabold gradient-text">Настройки лояльности</h1>
          <button onclick="logout()" class="text-slate-400 hover:text-white transition">Выйти</button>
        </div>

        <div class="space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="glass p-5 rounded-2xl">
              <label class="block text-sm text-slate-300 mb-2 font-semibold">Базовый кэшбэк (%)</label>
              <input type="number" id="base_cashback_percent" class="w-full px-4 py-2 rounded-lg text-xl font-bold">
            </div>
            
            <div class="glass p-5 rounded-2xl relative overflow-hidden">
              <div class="absolute top-0 right-0 w-16 h-16 bg-yellow-500 rounded-full filter blur-2xl opacity-20"></div>
              <label class="block text-sm text-yellow-300 mb-2 font-semibold flex items-center">
                VIP кэшбэк (%) <span class="ml-2 text-xs bg-yellow-500/20 px-2 py-0.5 rounded-full">PRO</span>
              </label>
              <input type="number" id="vip_cashback_percent" class="w-full px-4 py-2 rounded-lg text-xl font-bold">
            </div>
          </div>

          <div class="glass p-5 rounded-2xl">
            <label class="block text-sm text-slate-300 mb-2 font-semibold">Сумма трат для статуса VIP (тнг)</label>
            <input type="number" id="vip_threshold" class="w-full px-4 py-2 rounded-lg text-xl font-bold text-green-400">
            <p class="text-xs text-slate-500 mt-2">После достижения этой суммы покупок клиент автоматически начнет получать VIP процент.</p>
          </div>

          <div class="glass p-5 rounded-2xl">
            <label class="block text-sm text-slate-300 mb-2 font-semibold">Лимит оплаты бонусами (%)</label>
            <input type="number" id="max_discount_percent" class="w-full px-4 py-2 rounded-lg text-xl font-bold text-red-400">
            <p class="text-xs text-slate-500 mt-2">Какую максимальную часть стоимости чека можно оплатить бонусами.</p>
          </div>
        </div>

        <button onclick="saveSettings()" id="saveBtn" class="mt-8 btn-glow w-full py-4 rounded-2xl font-bold text-white text-lg shadow-[0_0_20px_rgba(56,189,248,0.3)]">
          Сохранить изменения
        </button>
        <p id="saveMsg" class="text-center mt-4 text-emerald-400 font-semibold hidden opacity-0 transition-opacity">Настройки успешно сохранены!</p>
      </div>

      <script>
        let token = localStorage.getItem('adminToken') || '';

        if(token) fetchSettings();

        async function login() {
          const pwd = document.getElementById('adminPwd').value;
          token = pwd;
          const success = await fetchSettings();
          if(success) {
            localStorage.setItem('adminToken', token);
            document.getElementById('authModal').classList.add('opacity-0', 'pointer-events-none');
            setTimeout(() => {
              document.getElementById('authModal').classList.add('hidden');
              document.getElementById('dashboard').classList.remove('hidden');
            }, 300);
          } else {
            document.getElementById('authError').classList.remove('hidden');
          }
        }

        function logout() {
          localStorage.removeItem('adminToken');
          location.reload();
        }

        async function fetchSettings() {
          const res = await fetch('/admin/api/settings', { headers: { 'Authorization': 'Bearer ' + token } });
          if(res.ok) {
            const data = await res.json();
            document.getElementById('base_cashback_percent').value = data.base_cashback_percent;
            document.getElementById('vip_cashback_percent').value = data.vip_cashback_percent;
            document.getElementById('vip_threshold').value = data.vip_threshold;
            document.getElementById('max_discount_percent').value = data.max_discount_percent;
            
            document.getElementById('authModal').classList.add('hidden');
            document.getElementById('dashboard').classList.remove('hidden');
            return true;
          }
          return false;
        }

        async function saveSettings() {
          const btn = document.getElementById('saveBtn');
          btn.innerText = 'Сохранение...';
          const payload = {
            base_cashback_percent: document.getElementById('base_cashback_percent').value,
            vip_cashback_percent: document.getElementById('vip_cashback_percent').value,
            vip_threshold: document.getElementById('vip_threshold').value,
            max_discount_percent: document.getElementById('max_discount_percent').value
          };

          await fetch('/admin/api/settings', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          
          btn.innerText = 'Сохранить изменения';
          const msg = document.getElementById('saveMsg');
          msg.classList.remove('hidden');
          setTimeout(() => msg.classList.remove('opacity-0'), 10);
          setTimeout(() => {
            msg.classList.add('opacity-0');
            setTimeout(() => msg.classList.add('hidden'), 300);
          }, 3000);
        }
      </script>
    </body>
    </html>
  `);
});

app.get('/health', (req, res) => res.send('iiko Bonus API is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

const express = require('express');
const cors = require('cors');
require('dotenv').config();
const path = require('path');
const iikoApi = require('./iiko-api');

// Если нужен кастомный бэкенд на Firebase, оставляем, но сейчас упор на iiko API
const { getOrCreateCustomerByPhone, updateCustomerBalance, logTransaction } = require('./customers');

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
// 2. API РЕГИСТРАЦИИ (В iikoCard)
// ==========================================
app.post('/api/register-iiko', async (req, res) => {
  try {
    const { phone, name } = req.body;
    if (!phone) return res.status(400).json({ error: 'Номер телефона обязателен' });

    console.log(`Регистрация гостя: ${name}, ${phone}`);
    const result = await iikoApi.registerCustomer(phone, name);
    
    res.json({ success: true, customerId: result });
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
    res.json({
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
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
    if (discountAmount > 0) {
      await updateCustomerBalance(customerId, -discountAmount);
      await logTransaction({ customerId, orderId, type: 'withdrawal', amount: discountAmount });
    }
    const earnedBonus = Math.floor((orderTotal - (discountAmount || 0)) * 0.05);
    if (earnedBonus > 0) {
      await updateCustomerBalance(customerId, earnedBonus);
      await logTransaction({ customerId, orderId, type: 'deposit', amount: earnedBonus });
    }
    res.json({ success: true, earnedBonus });
  } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/health', (req, res) => res.send('iiko Bonus API is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

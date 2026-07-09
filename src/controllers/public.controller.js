const path = require('path');
const { getCustomerByPhone, getOrCreateCustomerByPhone } = require('../services/customer.service');

const renderApp = (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'app.html'));
};

const renderAdmin = (req, res) => {
  res.sendFile(path.join(process.cwd(), 'admin-ui/dist', 'index.html'));
};

const registerIiko = async (req, res) => {
  try {
    const { phone, name } = req.body;
    if (!phone) return res.status(400).json({ error: 'Номер телефона обязателен' });

    console.log(`Регистрация гостя в Supabase: ${name}, ${phone}`);
    
    const existingCustomer = await getCustomerByPhone(phone);
    if (existingCustomer) {
      return res.status(400).json({ error: 'Этот номер телефона уже зарегистрирован в бонусной системе.' });
    }

    const customer = await getOrCreateCustomerByPhone(phone, name);

    res.json({ success: true, customerId: customer.id });
  } catch (err) {
    console.error('Registration error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  renderApp,
  renderAdmin,
  registerIiko
};

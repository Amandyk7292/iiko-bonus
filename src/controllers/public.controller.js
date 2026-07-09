const path = require('path');
const { getCustomerByPhone, getOrCreateCustomerByPhone, updateCustomerInfo, deleteCustomerByPhone } = require('../services/customer.service');

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

const getProfile = async (req, res) => {
  try {
    const phone = req.headers['x-customer-phone'];
    if (!phone) return res.status(401).json({ error: 'Не авторизован' });

    const customer = await getCustomerByPhone(phone);
    if (!customer) return res.status(404).json({ error: 'Клиент не найден' });

    res.json({ success: true, customer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const phone = req.headers['x-customer-phone'];
    if (!phone) return res.status(401).json({ error: 'Не авторизован' });

    const customer = await getCustomerByPhone(phone);
    if (!customer) return res.status(404).json({ error: 'Клиент не найден' });

    await updateCustomerInfo(customer.id, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const deleteProfile = async (req, res) => {
  try {
    const phone = req.headers['x-customer-phone'];
    if (!phone) return res.status(401).json({ error: 'Не авторизован' });

    await deleteCustomerByPhone(phone);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  renderApp,
  renderAdmin,
  registerIiko,
  getProfile,
  updateProfile,
  deleteProfile
};

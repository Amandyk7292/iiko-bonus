const path = require('path');
const {
  getCustomerByPhone,
  getCustomerById,
  getOrCreateCustomerByPhone,
  updateCustomerInfo,
  deleteCustomer,
} = require('../services/customer.service');
const { getCitiesWithPoints } = require('../services/location.service');
const { getSettings } = require('../services/settings.service');
const { getActiveLoyaltyTiers } = require('../services/tier.service');
const { getTierInfo } = require('../utils/tier.util');
const { sendApiError } = require('../utils/http.util');

const renderApp = (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'app.html'));
};

const renderAdmin = (req, res) => {
  res.sendFile(path.join(process.cwd(), 'admin-ui/dist', 'index.html'));
};

const registerIiko = async (req, res) => {
  try {
    const phone = req.registrationAuth.phone;
    const { name } = req.body;
    if (!phone) return res.status(400).json({ error: 'Номер телефона обязателен' });

    const existingCustomer = await getCustomerByPhone(phone);
    if (existingCustomer) {
      if (existingCustomer.name && !['Гость', 'Новый Гость'].includes(existingCustomer.name)) {
        return res
          .status(409)
          .json({ error: 'Этот номер телефона уже зарегистрирован в бонусной системе.' });
      }
      await updateCustomerInfo(existingCustomer.id, {
        name: String(name || 'Гость')
          .trim()
          .slice(0, 160),
      });
      return res.json({ success: true, customerId: existingCustomer.id });
    }

    const customer = await getOrCreateCustomerByPhone(phone, name);

    res.json({ success: true, customerId: customer.id });
  } catch (err) {
    sendApiError(res, err);
  }
};

const getProfile = async (req, res) => {
  try {
    const customer = await getCustomerById(req.customerAuth.id);
    if (!customer) return res.status(404).json({ error: 'Клиент не найден' });
    const safeCustomer = { ...customer };
    delete safeCustomer.fcm_token;
    delete safeCustomer.telegram_id;
    const settings = await getSettings();
    const tiers = await getActiveLoyaltyTiers(settings);
    const tier = getTierInfo(customer.total_spent, tiers, settings);
    safeCustomer.cashbackPercent = tier.percent;
    safeCustomer.tier = tier;
    res.json({
      success: true,
      customer: safeCustomer,
      loyalty: {
        tier,
        cashbackPercent: tier.percent,
        remaining: tier.remaining,
        progress: tier.progress,
      },
    });
  } catch (err) {
    sendApiError(res, err);
  }
};

const updateProfile = async (req, res) => {
  try {
    const updates = {};
    if (req.body.name !== undefined) updates.name = String(req.body.name).trim().slice(0, 160);
    if (req.body.last_name !== undefined)
      updates.last_name = String(req.body.last_name).trim().slice(0, 160);
    if (req.body.gender !== undefined) {
      const gender = String(req.body.gender).trim().slice(0, 20);
      if (!['male', 'female', 'other', 'Мужской', 'Женский', ''].includes(gender)) {
        return res.status(400).json({ error: 'Invalid gender' });
      }
      updates.gender = gender || null;
    }
    if (req.body.email !== undefined) {
      const email = String(req.body.email).trim().toLowerCase().slice(0, 255);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Invalid email' });
      }
      updates.email = email || null;
    }
    if (req.body.region !== undefined)
      updates.region = String(req.body.region).trim().slice(0, 160);
    if (req.body.birth_date !== undefined) {
      const birthDate = String(req.body.birth_date || '');
      if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
        return res.status(400).json({ error: 'Invalid birth_date' });
      }
      updates.birth_date = birthDate || null;
    }
    await updateCustomerInfo(req.customerAuth.id, updates);
    res.json({ success: true });
  } catch (err) {
    sendApiError(res, err);
  }
};

const deleteProfile = async (req, res) => {
  try {
    await deleteCustomer(req.customerAuth.id);
    res.json({ success: true });
  } catch (err) {
    sendApiError(res, err);
  }
};

const getCities = async (req, res) => {
  try {
    const cities = await getCitiesWithPoints();
    res.json({ success: true, cities });
  } catch (err) {
    sendApiError(res, err);
  }
};

module.exports = {
  renderApp,
  renderAdmin,
  registerIiko,
  getProfile,
  updateProfile,
  deleteProfile,
  getCities,
};

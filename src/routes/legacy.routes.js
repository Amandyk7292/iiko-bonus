const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const qrcode = require('qrcode');
const { getSettings, getTierInfo } = require('../services/settings.service');
const { getOrCreateCustomerByPhone } = require('../services/customer.service');
const otpStore = require('../services/otpStore.service');
const supabase = require('../config/supabase');

// Mock authRateLimit
const authRateLimit = (req, res, next) => next();

const admin = require('firebase-admin');

router.post('/api/auth/request-otp', authRateLimit, async (req, res) => {
  try {
    const { token } = req.body;
    const phone = normalizePhone(req.body.phone);
    if (!phone || phone.replace(/[^0-9]/g, '').length < 10) return res.status(400).json({ error: 'Valid phone required' });
    
    // Don't create customer here тАФ only create after OTP is verified
    
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

router.post('/api/auth/verify-otp', authRateLimit, async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const { code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'Phone and code required' });
    
    console.log(`[VERIFY-OTP] Attempting verify for phone="${phone}", code="${code}"`);
    const stored = await otpStore.get(phone);
    if (!stored) {
        return res.json({ success: false, error: 'expired', message: '╨Ъ╨╛╨┤ ╤Г╤Б╤В╨░╤А╨╡╨╗ ╨╕╨╗╨╕ ╨╜╨╡ ╨▒╤Л╨╗ ╨╖╨░╨┐╤А╨╛╤И╨╡╨╜' });
    }
    
    if (Date.now() > stored.expires) {
        await otpStore.delete(phone);
        return res.json({ success: false, error: 'expired', message: '╨Т╤А╨╡╨╝╤П ╨┤╨╡╨╣╤Б╤В╨▓╨╕╤П ╨║╨╛╨┤╨░ ╨╕╤Б╤В╨╡╨║╨╗╨╛' });
    }
    
    if (stored.code !== code) {
        return res.json({ success: false, error: 'invalid', message: '╨Э╨╡╨▓╨╡╤А╨╜╤Л╨╣ ╨║╨╛╨┤' });
    }
    
    // Success - clear OTP and check if customer exists
    await otpStore.delete(phone);
    
    let existingCustomer = await getCustomerByPhone(phone);
    const isPlaceholder = existingCustomer && (!existingCustomer.name || existingCustomer.name === '╨У╨╛╤Б╤В╤М');
    if (!existingCustomer || isPlaceholder) {
      return res.json({
        success: true,
        exists: false,
        phone
      });
    }

    const customer = existingCustomer;
    const settings = await getSettings();
    const tier = getTierInfo(customer.total_spent, settings);
    const vipThreshold = settings.vip_threshold || 300000;
    const isVip = tier.name === '╨Я╨╗╨░╤В╨╕╨╜╨░';
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

router.post('/api/auth/register', async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const { name, surname, gender, birthdate, email } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'Phone required' });

    const fullName = [name, surname].filter(Boolean).join(' ').trim() || '╨Э╨╛╨▓╤Л╨╣ ╨У╨╛╤Б╤В╤М';
    let customer = await getOrCreateCustomerByPhone(phone, fullName);
    if (!customer) return res.status(404).json({ success: false, error: 'Cannot create customer' });

    const updateData = { name: fullName };
    if (surname) updateData.surname = surname;
    if (email) updateData.email = email;
    if (gender) updateData.gender = gender;
    if (birthdate) updateData.birthdate = birthdate;

    try {
      await supabase.from('customers').update(updateData).eq('id', customer.id);
      Object.assign(customer, updateData);
    } catch (e) {
      await supabase.from('customers').update({ name: fullName }).eq('id', customer.id);
      customer.name = fullName;
    }

    const settings = await getSettings();
    const tier = getTierInfo(customer.total_spent, settings);
    const vipThreshold = settings.vip_threshold || 300000;
    const isVip = tier.name === '╨Я╨╗╨░╤В╨╕╨╜╨░';
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

router.post('/api/customer/fcm-token', async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const { fcmToken } = req.body;
    if (!phone || !fcmToken) return res.status(400).json({ error: 'phone and fcmToken required' });
    await updateFcmToken(phone, fcmToken);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/guest/profile', async (req, res) => {
  try {
    const { name, register, fcmToken } = req.body;
    const phone = normalizePhone(req.body.phone);
    if (!phone || phone.replace(/[^0-9]/g, '').length < 10) return res.status(400).json({ error: 'Valid phone required' });

    let customer = await getCustomerByPhone(phone);
    if (!customer) {
      if (register) {
        customer = await getOrCreateCustomerByPhone(phone, name || '╨Э╨╛╨▓╤Л╨╣ ╨У╨╛╤Б╤В╤М');
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
    const isVip = tier.name === '╨Я╨╗╨░╤В╨╕╨╜╨░';
    const cashbackPercent = tier.percent;

    // ╨Я╨╛╨╗╤Г╤З╨░╨╡╨╝ ╨┐╨╛╤Б╨╗╨╡╨┤╨╜╨╕╨╡ ╤В╤А╨░╨╜╨╖╨░╨║╤Ж╨╕╨╕ ╨║╨╗╨╕╨╡╨╜╤В╨░
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

router.post('/api/guest/qr-token', authRateLimit, async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const customer = await getCustomerByPhone(phone);
    if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });
    res.json({ success: true, ...buildDynamicQrToken(customer.phone) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

router.get('/api/guest/menu', async (req, res) => {
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

    // Fallback: ╨╡╤Б╨╗╨╕ ╨▓ iiko ╨╜╨╡ ╨┐╤А╨╛╤Б╤В╨░╨▓╨╗╨╡╨╜ ╤Д╨╗╨░╨│ isIncludedInMenu, ╨▒╨╡╤А╤С╨╝ ╨▓╤Б╨╡ ╨│╤А╤Г╨┐╨┐╤Л
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
      
    // Fallback: ╨╡╤Б╨╗╨╕ ╤В╨╕╨┐ ╨▒╨╗╤О╨┤╨░ ╨╛╤В╨╗╨╕╤З╨░╨╡╤В╤Б╤П, ╨▒╨╡╤А╨╡╨╝ ╨▓╤Б╨╡ ╤В╨╛╨▓╨░╤А╤Л
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
    console.error('╨Ю╤И╨╕╨▒╨║╨░ ╨┐╨╛╨╗╤Г╤З╨╡╨╜╨╕╤П ╨╝╨╡╨╜╤О:', error);
    res.json({ success: false, error: '╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨╖╨░╨│╤А╤Г╨╖╨╕╤В╤М ╨╝╨╡╨╜╤О: ' + (error.message || error) });
  }
});

router.get('/api/guest/stories', async (req, res) => {
  try {
    const stories = await getStories();
    res.json({ success: true, stories });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

router.get('/api/guest/news', async (req, res) => {
  try {
    const news = await getNews();
    res.json({ success: true, news });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

router.get('/api/guest/locations', async (req, res) => {
  try {
    const { supabase } = require('./supabase');
    const { data: locations, error } = await supabase.from('bulka_locations').select('*');
    if (error) throw error;
    
    const cityLocations = {};
    for (const loc of locations) {
      const city = loc.city || '╨и╤Л╨╝╨║╨╡╨╜╤В'; // ╨┤╨╡╤Д╨╛╨╗╤В, ╨╡╤Б╨╗╨╕ ╨┐╤Г╤Б╤В╨╛
      if (!cityLocations[city]) cityLocations[city] = [];
      const title = [loc.name, loc.address].filter(Boolean).join(', ');
      if (title) cityLocations[city].push(title);
    }
    res.json({ success: true, cityLocations });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

router.get('/api/guest/test-menu', async (req, res) => {
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

router.get(['/app', '/wallet', '/guest'], (req, res) => {
  res.sendFile(path.join(__dirname, 'router.html'));
});


// ==========================================
// 3.6 APPLE WALLET WEB SERVICE
// ==========================================

router.post('/api/wallet/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber', express.json(), async (req, res) => {
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

router.delete('/api/wallet/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber', async (req, res) => {
  const { deviceLibraryIdentifier, serialNumber } = req.params;
  const { supabase } = require('./supabase');
  await supabase.from('wallet_registrations')
    .delete()
    .match({ device_id: deviceLibraryIdentifier, serial_number: serialNumber });
  res.status(200).send();
});

router.get('/api/wallet/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier', async (req, res) => {
  const { deviceLibraryIdentifier, passTypeIdentifier } = req.params;
  const { supabase } = require('./supabase');
  const { data } = await supabase.from('wallet_registrations')
    .select('serial_number')
    .eq('device_id', deviceLibraryIdentifier)
    .eq('pass_type_id', passTypeIdentifier);
  if (!data || data.length === 0) return res.status(204).send();
  res.json({ lastUpdated: Date.now().toString(), serialNumbers: data.map(r => r.serial_number) });
});

router.get('/api/wallet/v1/passes/:passTypeIdentifier/:serialNumber', async (req, res) => {
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

router.post('/api/wallet/v1/log', express.json(), (req, res) => {
  console.log("Apple Wallet Logs:", req.body.logs);
  res.status(200).send();
});

module.exports = router;

const { supabase } = require('../config/supabase');
const { getSettings } = require('./settings.service');
const { queueCustomerLoyaltySync } = require('./loyalty-sync.service');

async function referralTerms() {
  const settings = (await getSettings()).bonus_referral || {};
  return {
    enabled: settings.enabled === true,
    reward_referrer: Number(settings.inviter_bonus ?? 1000),
    reward_friend: Number(settings.friend_bonus ?? 500),
    min_first_order: Number(settings.min_first_order ?? 0),
  };
}

async function processReferralPurchases() {
  const { data, error } = await supabase
    .from('referral_first_purchases')
    .select('customer_id,attempts')
    .eq('state', 'pending')
    .order('last_attempt_at', { nullsFirst: true })
    .limit(100);
  if (error) throw error;
  let failure;
  for (const row of data || []) {
    try {
      await supabase
        .from('referral_first_purchases')
        .update({
          last_attempt_at: new Date().toISOString(),
          attempts: Number(row.attempts || 0) + 1,
        })
        .eq('customer_id', row.customer_id);
      const { data: reward, error: rewardError } = await supabase.rpc('process_referral_purchase', {
        p_customer_id: row.customer_id,
      });
      if (rewardError) throw rewardError;
      await supabase
        .from('referral_first_purchases')
        .update({ last_error: null })
        .eq('customer_id', row.customer_id);
      for (const id of [reward?.friendCustomerId, reward?.ownerCustomerId].filter(Boolean)) {
        queueCustomerLoyaltySync(id);
      }
    } catch (error) {
      await supabase
        .from('referral_first_purchases')
        .update({ last_error: 'Начисление не выполнено; будет повторено' })
        .eq('customer_id', row.customer_id);
      failure = error;
    }
  }
  for (const task of [processReferralReturns, deliverReferralEvents]) {
    try {
      await task();
    } catch (error) {
      failure = error;
    }
  }
  if (failure) throw failure;
}

async function rememberReferralDevice(customerId, installationId) {
  if (!installationId) return;
  const hash = require('node:crypto').createHash('sha256').update(installationId).digest('hex');
  const { error } = await supabase
    .from('referral_devices')
    .upsert(
      { customer_id: customerId, device_hash: hash },
      { onConflict: 'customer_id,device_hash', ignoreDuplicates: true },
    );
  if (error) throw error;
}

async function customerReferralHistory(customerId, offset = 0) {
  const { data, error } = await supabase.rpc('customer_referral_history', {
    p_customer_id: customerId,
    p_offset: offset,
  });
  if (error) throw error;
  return data;
}

async function processReferralReturns() {
  const { data, error } = await supabase
    .from('referral_first_purchases')
    .select('customer_id')
    .eq('state', 'done')
    .gt('refunded_amount', 0)
    .order('last_attempt_at', { nullsFirst: true })
    .limit(100);
  if (error) throw error;
  let failure;
  for (const row of data || []) {
    try {
      const { data: result, error: rpcError } = await supabase.rpc('reverse_referral_purchase', {
        p_customer_id: row.customer_id,
      });
      if (rpcError) throw rpcError;
      await supabase
        .from('referral_first_purchases')
        .update({ last_attempt_at: new Date().toISOString() })
        .eq('customer_id', row.customer_id);
      for (const id of [result?.friendCustomerId, result?.ownerCustomerId].filter(Boolean))
        queueCustomerLoyaltySync(id);
    } catch (caught) {
      failure = caught;
    }
  }
  if (failure) throw failure;
}

function referralNotification(event, language = 'ru') {
  const reversed = event.kind === 'reversal';
  const copies = {
    ru: {
      title: reversed ? 'Бонус за приглашение отозван' : 'Бонус за приглашение',
      body: reversed
        ? `Из-за возврата первой покупки отозвано ${event.amount} ₸ бонусами. Бонусный долг: ${event.debt} ₸. Он погашается будущими начислениями, деньги не списываются.`
        : `За первую покупку по приглашению начислено ${event.amount} ₸ бонусами. При наличии бонусного долга начисление погашает его.`,
    },
    kk: {
      title: reversed ? 'Шақыру бонусы қайтарылды' : 'Шақыру бонусы',
      body: reversed
        ? `Алғашқы сатып алу қайтарылғандықтан ${event.amount} ₸ бонус қайтарылды. Бонус қарызы: ${event.debt} ₸. Ол келесі бонустардан өтеледі, ақша алынбайды.`
        : `Шақыру бойынша алғашқы сатып алу үшін ${event.amount} ₸ бонус есептелді. Бонус қарызы болса, есептеу оны өтейді.`,
    },
    en: {
      title: reversed ? 'Referral reward reversed' : 'Referral reward',
      body: reversed
        ? `${event.amount} ₸ in bonuses was reversed after the first purchase was refunded. Bonus debt: ${event.debt} ₸. Future bonus credits repay it; no money is charged.`
        : `${event.amount} ₸ in bonuses was awarded for a first referral purchase. Any bonus debt is repaid from this credit.`,
    },
  };
  return copies[language] || copies.ru;
}

async function deliverReferralEvents() {
  const { data, error } = await supabase
    .from('referral_events')
    .select('*')
    .is('delivered_at', null)
    .order('attempts')
    .order('created_at')
    .limit(100);
  if (error) throw error;
  let failure;
  for (const event of data || []) {
    try {
      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .select('preferred_language')
        .eq('id', event.customer_id)
        .single();
      if (customerError) throw customerError;
      const copy = referralNotification(event, customer.preferred_language);
      const payload = {
        type: 'bonus',
        destination: 'notifications',
        notificationId: event.id,
        pushDedupeKey: `referral:${event.id}`,
      };
      const { error: noticeError } = await supabase
        .from('customer_notifications')
        .upsert(
          { id: event.id, customer_id: event.customer_id, ...copy, type: 'bonus', payload },
          { onConflict: 'id', ignoreDuplicates: true },
        );
      if (noticeError) throw noticeError;
      queueCustomerLoyaltySync(event.customer_id);
      await require('./push.service').sendPushToCustomer(
        event.customer_id,
        copy.title,
        copy.body,
        payload,
      );
      const { error: doneError } = await supabase
        .from('referral_events')
        .update({ delivered_at: new Date().toISOString(), last_error: null })
        .eq('id', event.id);
      if (doneError) throw doneError;
    } catch (caught) {
      await supabase
        .from('referral_events')
        .update({
          attempts: event.attempts + 1,
          last_error: 'Уведомление ожидает повторной отправки',
        })
        .eq('id', event.id);
      failure = caught;
    }
  }
  if (failure) throw failure;
}

module.exports = {
  referralTerms,
  processReferralPurchases,
  rememberReferralDevice,
  customerReferralHistory,
  referralNotification,
};

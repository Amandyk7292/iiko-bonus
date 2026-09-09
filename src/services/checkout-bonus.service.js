const { supabase } = require('../config/supabase');

const bonusError = (code = 'CHECKOUT_BONUS_CHANGED') =>
  Object.assign(new Error('Баланс бонусов изменился. Обновите расчёт заказа.'), {
    statusCode: 409,
    code,
  });

const merchandiseAmount = (pricing) =>
  Math.max(0, Number(pricing.subtotal || 0) - Number(pricing.discount || 0));

async function priceCheckoutBonus(
  { pricing, customerId, useBonuses = false, expectedBonusSpent, requestId },
  { phase = 'quote', db = supabase } = {},
) {
  const total = merchandiseAmount(pricing);
  if (phase === 'payment' && !useBonuses) return { ...pricing, bonusSpent: 0 };
  const { data, error } = await db.rpc('quote_checkout_bonus', {
    p_customer_id: customerId,
    p_order_total: total,
  });
  if (error || !data) throw bonusError('CHECKOUT_BONUS_UNAVAILABLE');
  const available = Math.max(0, Math.floor(Number(data.available || 0)));
  if (!Number.isSafeInteger(available)) throw bonusError('CHECKOUT_BONUS_UNAVAILABLE');
  const maximum = Math.min(available, Math.floor(total / 2));
  let bonusSpent = useBonuses ? maximum : 0;
  let bonusReservationId = null;
  if (phase === 'payment' && useBonuses) {
    if (!Number.isSafeInteger(expectedBonusSpent) || expectedBonusSpent < 0) throw bonusError();
    // Recheck under the same customer lock used by POS loyalty reservations.
    const reserved = await db.rpc('reserve_checkout_bonus', {
      p_customer_id: customerId,
      p_request_id: requestId,
      p_order_total: total,
      p_expected_amount: expectedBonusSpent,
    });
    if (reserved.error || !reserved.data) throw bonusError();
    bonusSpent = Number(reserved.data.amount);
    bonusReservationId = reserved.data.reservationId || null;
    if (
      !Number.isSafeInteger(bonusSpent) ||
      bonusSpent !== expectedBonusSpent ||
      bonusSpent < 0 ||
      bonusSpent > Math.floor(total / 2) ||
      (bonusSpent > 0 && !bonusReservationId)
    ) {
      throw bonusError();
    }
  }
  return {
    ...pricing,
    total: pricing.total - bonusSpent,
    bonusAvailable: available,
    bonusMaximum: maximum,
    bonusSpent,
    bonusReservationId,
  };
}

async function releaseCheckoutBonus(pricing, customerId, requestId) {
  if (!pricing?.bonusReservationId) return;
  // An attached order owns its reservation; only its confirmed terminal state
  // can release it. A network error is not evidence that payment failed.
  const { error } = await supabase.rpc('release_unattached_checkout_bonus', {
    p_customer_id: customerId,
    p_request_id: requestId,
    p_reservation_id: pricing.bonusReservationId,
  });
  if (error) throw error;
}

async function commitCheckoutBonus(order, earnedBonus, activationDelayDays) {
  const { data, error } = await supabase.rpc('commit_checkout_bonus', {
    p_order_id: order.id,
    p_earned_bonus: earnedBonus,
    p_activation_delay_days: activationDelayDays,
  });
  if (error) throw error;
  return data;
}

module.exports = { priceCheckoutBonus, releaseCheckoutBonus, commitCheckoutBonus };

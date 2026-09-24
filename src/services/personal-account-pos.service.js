const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { searchCustomers } = require('./customer.service');
const { sendPushToCustomer } = require('./push.service');
const realtime = require('./realtime.service');

const messages = {
  insufficient: 'Недостаточно средств на личном счёте для полной оплаты чека.',
  blocked: 'Личный счёт заблокирован.',
  unavailable: 'Оплата личным счётом недоступна.',
  expired: 'Код истёк. Отмените эту оплату и запросите новый код.',
  invalid_code: 'Неверный код подтверждения.',
  locked: 'Превышено число попыток. Запросите новый код.',
  mismatch: 'Сумма или состав чека изменились. Запросите новый код.',
  order_busy: 'Для этого чека уже есть запрос оплаты. Завершите или отмените его.',
  rate_limited: 'Повторный код можно запросить через минуту.',
  unauthorized: 'Оплата не подтверждена клиентом.',
  not_found: 'Запрос оплаты не найден.',
};
const fail = (status) =>
  Object.assign(new Error(messages[status] || 'Операция оплаты недоступна.'), {
    statusCode: status === 'rate_limited' ? 429 : 409,
    code: `PERSONAL_POS_${status.toUpperCase()}`,
  });
function codeHash(id, code, secret) {
  if (!secret || secret.length < 32) throw fail('unavailable');
  return crypto.createHmac('sha256', secret).update(`personal-pos:${id}:${code}`).digest('hex');
}
const unwrap = (data) => (Array.isArray(data) ? data[0] : data);

class PersonalAccountPosService {
  constructor({
    db = supabase,
    lookup = searchCustomers,
    push = sendPushToCustomer,
    env = process.env,
    publish = (...args) => realtime.publish(...args),
  } = {}) {
    Object.assign(this, { db, lookup, push, env, publish });
  }
  async notify(id) {
    if (!id) return;
    const { data, error } = await this.db
      .from('customer_notifications')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    await this.push(data.customer_id, data.title, data.body, {
      type: data.type,
      destination: 'notifications',
      ...(data.payload?.expiresAt ? { expiresAt: data.payload.expiresAt } : {}),
      notificationId: data.id,
      pushDedupeKey: `personal-pos:${data.id}`,
      deepLink: 'https://bulka.com.kz/notifications',
    });
  }
  async start(branchId, payload) {
    if (
      this.env.PERSONAL_ACCOUNT_ENABLED === 'false' ||
      this.env.PERSONAL_ACCOUNT_POS_ENABLED === 'false'
    )
      throw fail('unavailable');
    const customers = await this.lookup(payload.customerCode);
    if (customers.length !== 1 || customers[0].deleted_at) throw fail('unavailable');
    const customer = customers[0];
    const { data: branch, error: branchError } = await this.db
      .from('bulka_locations')
      .select('name')
      .eq('id', branchId)
      .single();
    if (branchError) throw branchError;
    const id = crypto.randomUUID(),
      notificationId = crypto.randomUUID();
    const code = String(crypto.randomInt(100000, 1000000));
    const titles = {
      ru: 'Подтверждение оплаты на кассе',
      kk: 'Кассадағы төлемді растау',
      en: 'Confirm payment at the counter',
    };
    const bodies = {
      ru: `Код ${code}. Оплата ${payload.amount} ₸ с личного счёта в «${branch.name}». Сообщите код кассиру только для этой покупки. Действует 5 минут.`,
      kk: `Код: ${code}. «${branch.name}» нүктесінде жеке шоттан ${payload.amount} ₸ төлеу. Кодты кассирге тек осы сатып алу үшін айтыңыз. 5 минут жарамды.`,
      en: `Code ${code}. Pay ${payload.amount} ₸ from your account at ${branch.name}. Give this code to the cashier only for this purchase. Valid for 5 minutes.`,
    };
    const language = ['kk', 'en'].includes(customer.preferred_language)
      ? customer.preferred_language
      : 'ru';
    const { data, error } = await this.db.rpc('personal_account_pos_start', {
      p_id: id,
      p_request_id: payload.requestId,
      p_customer_id: customer.id,
      p_branch_id: branchId,
      p_order_id: payload.orderId,
      p_amount_minor: Math.round(payload.amount * 100),
      p_fingerprint: payload.fingerprint,
      p_code_hash: codeHash(id, code, this.env.BULKA_SECRET),
      p_notification_id: notificationId,
      p_title: titles[language],
      p_body: bodies[language],
      p_payload: {
        destination: 'notifications',
        i18n: { titles, bodies },
        amount: payload.amount,
        branch: branch.name,
      },
    });
    if (error) throw error;
    const result = unwrap(data);
    if (!['pending', 'authorized'].includes(result.status)) throw fail(result.status);
    // The inbox record is committed with the challenge even if push is unavailable.
    await this.notify(result.notificationId).catch(() => {});
    return {
      id: result.id,
      status: result.status,
      expiresAt: result.expiresAt,
      amount: payload.amount,
    };
  }
  async action(branchId, payload) {
    if (
      ['confirm', 'pay'].includes(payload.action) &&
      (this.env.PERSONAL_ACCOUNT_ENABLED === 'false' ||
        this.env.PERSONAL_ACCOUNT_POS_ENABLED === 'false')
    )
      throw fail('unavailable');
    const { data, error } = await this.db.rpc('personal_account_pos_action', {
      p_id: payload.id,
      p_branch_id: branchId,
      p_order_id: payload.orderId,
      p_amount_minor: Math.round(payload.amount * 100),
      p_fingerprint: payload.fingerprint,
      p_action: payload.action,
      p_code_hash: payload.code ? codeHash(payload.id, payload.code, this.env.BULKA_SECRET) : null,
      p_transaction_id: payload.transactionId || null,
    });
    if (error) throw error;
    const result = unwrap(data);
    if (!['pending', 'authorized', 'paid', 'refunded', 'cancelled'].includes(result.status))
      throw fail(result.status);
    if (result.customerId)
      this.publish(
        'personal-account.updated',
        {},
        { customerId: result.customerId, includeAdmins: false },
      );
    await this.notify(result.notificationId).catch(() => {});
    return { id: result.id, status: result.status, amount: payload.amount };
  }
}
module.exports = {
  PersonalAccountPosService,
  codeHash,
  personalAccountPos: new PersonalAccountPosService(),
};

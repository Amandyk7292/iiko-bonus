const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const widget = require('./forte-widget.service');
const {
  encryptProviderToken,
  decryptProviderToken,
  normalizeWidgetCheckout,
  mapWidgetStatus,
  buildWidgetLaunchUrl,
} = widget;
const accounts = require('./personal-account.service');
const { accountError } = accounts;
const { SingleFlight } = require('../utils/single-flight.util');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class PersonalAccountTopups {
  constructor({ db = supabase, bank = widget, account = accounts, env = process.env } = {}) {
    this.db = db;
    this.bank = bank;
    this.account = account;
    this.env = env;
    this.requests = new SingleFlight();
  }
  async find(id, customerId) {
    let query = this.db.from('personal_account_topups').select('*').eq('id', id);
    if (customerId) query = query.eq('customer_id', customerId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data;
  }
  async existing(customerId, requestId) {
    const { data, error } = await this.db
      .from('personal_account_topups')
      .select('*')
      .eq('customer_id', customerId)
      .eq('request_id', requestId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
  response(topup, language = 'ru', resume = false) {
    const paymentStatus =
      { credited: 'paid', reversed: 'refunded', failed: 'failed', expired: 'expired' }[
        topup.status
      ] || 'pending';
    const result = {
      success: true,
      operationId: topup.id,
      paymentStatus,
      status: paymentStatus,
      amount: topup.amount_minor / 100,
    };
    if (resume && paymentStatus === 'pending' && topup.token_ciphertext) {
      const token = decryptProviderToken(
        topup.token_ciphertext,
        'account-topup',
        `${topup.customer_id}:${topup.id}`,
        this.env,
      );
      result.redirectUrl = buildWidgetLaunchUrl({
        publicBaseUrl: this.bank.config().publicBaseUrl,
        token,
        operationId: topup.id,
        language,
        test: this.bank.config().test,
        purpose: 'account-topup',
      });
    }
    return result;
  }
  async create(customerId, phone, { requestId, amount, language = 'ru' }) {
    if (!this.account.enabled() || !this.bank.availability())
      throw accountError('Пополнение временно недоступно', 'PERSONAL_ACCOUNT_DISABLED', 503);
    if (!uuid.test(requestId) || !Number.isInteger(amount) || amount < 100 || amount > 200000)
      throw accountError(
        'Укажите сумму от 100 до 200000 тенге',
        'PERSONAL_ACCOUNT_INVALID_AMOUNT',
        400,
      );
    return this.requests.run(`${customerId}:${requestId}`, async () => {
      let topup = await this.existing(customerId, requestId);
      if (topup) {
        if (Number(topup.amount_minor) !== amount * 100)
          throw accountError(
            'Это пополнение уже создано на другую сумму',
            'PERSONAL_ACCOUNT_REQUEST_USED',
          );
        return this.response(topup, language, true);
      }
      const created = {
        id: crypto.randomUUID(),
        customer_id: customerId,
        request_id: requestId,
        amount_minor: amount * 100,
        status: 'creating',
        expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
      };
      const inserted = await this.db
        .from('personal_account_topups')
        .insert([created])
        .select('*')
        .single();
      if (inserted.error) {
        topup = await this.existing(customerId, requestId);
        if (!topup) throw inserted.error;
        if (Number(topup.amount_minor) !== amount * 100)
          throw accountError(
            'Это пополнение уже создано на другую сумму',
            'PERSONAL_ACCOUNT_REQUEST_USED',
          );
        return this.response(topup, language, true);
      }
      topup = inserted.data;
      let checkout;
      try {
        checkout = await this.bank.createProviderCheckout({
          amountMinor: amount * 100,
          customerId,
          phone,
          language,
          trackingId: topup.id,
          description: 'Пополнение личного счёта Bulka',
          purpose: 'account-topup',
        });
      } catch (error) {
        if (error.code === 'FORTE_WIDGET_CREATE_REJECTED' && error.retryable === false) {
          await this.db
            .from('personal_account_topups')
            .update({ status: 'failed', checked_at: new Date().toISOString() })
            .eq('id', topup.id)
            .eq('status', 'creating');
        }
        throw error;
      }
      const saved = await this.db
        .from('personal_account_topups')
        .update({
          status: 'pending',
          expires_at: checkout.expiresAt,
          token_ciphertext: encryptProviderToken(
            checkout.token,
            'account-topup',
            `${customerId}:${topup.id}`,
            this.env,
          ),
        })
        .eq('id', topup.id)
        .eq('customer_id', customerId)
        .eq('status', 'creating')
        .select('*')
        .single();
      if (saved.error)
        throw accountError(
          'Пополнение создано. Проверяем результат перед повтором.',
          'PERSONAL_ACCOUNT_SAVE_UNKNOWN',
          503,
        );
      return this.response(saved.data, language, true);
    });
  }
  async sync(topup) {
    if (['credited', 'reversed'].includes(topup.status)) return topup;
    if (!topup.token_ciphertext) {
      const expired = Date.parse(topup.expires_at) < Date.now();
      const { error } = await this.db
        .from('personal_account_topups')
        .update({
          checked_at: new Date().toISOString(),
          ...(expired && ['creating', 'pending'].includes(topup.status)
            ? { status: 'expired' }
            : {}),
        })
        .eq('id', topup.id)
        .eq('status', topup.status)
        .is('token_ciphertext', null);
      if (error) throw error;
      return this.find(topup.id, topup.customer_id);
    }
    const token = decryptProviderToken(
      topup.token_ciphertext,
      'account-topup',
      `${topup.customer_id}:${topup.id}`,
      this.env,
    );
    const { response, body } = await this.bank.request(
      `/ctp/api/checkouts/${encodeURIComponent(token)}`,
    );
    if (!response.ok)
      throw accountError('Не удалось проверить пополнение', 'PERSONAL_ACCOUNT_CHECK_PENDING', 503);
    const normalized = normalizeWidgetCheckout(body);
    this.bank.validateCheckout(
      { operation_id: topup.id, amount: Number(topup.amount_minor) / 100 },
      normalized,
      token,
    );
    const status = mapWidgetStatus(normalized);
    if (status === 'paid') {
      if (!uuid.test(normalized.providerTransactionId))
        throw accountError(
          'Банк ещё не подтвердил операцию',
          'PERSONAL_ACCOUNT_CHECK_PENDING',
          503,
        );
      const { error } = await this.db.rpc('personal_account_confirm_topup', {
        p_id: topup.id,
        p_transaction_id: normalized.providerTransactionId,
        p_reverse: false,
      });
      if (error) throw error;
      this.account.notify(topup.customer_id);
    } else {
      const { error } = await this.db
        .from('personal_account_topups')
        .update({
          checked_at: new Date().toISOString(),
          ...(['failed', 'expired'].includes(status) ? { status } : {}),
        })
        .eq('id', topup.id)
        .in('status', ['creating', 'pending', 'failed', 'expired']);
      if (error) throw error;
    }
    return this.find(topup.id, topup.customer_id);
  }
  async handleWebhook(payload) {
    const transaction = payload?.transaction || payload;
    if (
      ['refund', 'void', 'chargeback'].includes(transaction?.type) &&
      uuid.test(transaction?.parent_uid)
    ) {
      const { data: topup, error } = await this.db
        .from('personal_account_topups')
        .select('*')
        .eq('provider_transaction_id', transaction.parent_uid)
        .maybeSingle();
      if (error) throw error;
      if (!topup) return false;
      if (!uuid.test(transaction.uid))
        throw accountError('Некорректный возврат', 'PERSONAL_ACCOUNT_INVALID_REVERSAL', 422);
      const { response, body } = await this.bank.request(`/transactions/${transaction.uid}`, {
        base: 'transaction',
        apiVersion: 3,
      });
      const verified = body?.transaction || body;
      if (
        !response.ok ||
        verified.uid !== transaction.uid ||
        verified.parent_uid !== topup.provider_transaction_id ||
        verified.currency !== 'KZT' ||
        Boolean(verified.test) !== this.bank.config().test ||
        !Number.isSafeInteger(verified.amount) ||
        verified.amount <= 0 ||
        !['refund', 'void', 'chargeback'].includes(verified.type)
      )
        throw accountError(
          'Не удалось сверить возврат банка',
          'PERSONAL_ACCOUNT_INVALID_REVERSAL',
          422,
        );
      if (verified.status === 'successful') {
        const { error: rpcError } = await this.db.rpc('personal_account_reverse_bank_transaction', {
          p_topup_id: topup.id,
          p_payment_uid: topup.provider_transaction_id,
          p_reversal_uid: verified.uid,
          p_amount_minor: verified.amount,
        });
        if (rpcError) throw rpcError;
        this.account.notify(topup.customer_id);
      }
      return true;
    }
    const normalized = normalizeWidgetCheckout(payload);
    if (!uuid.test(normalized.trackingId)) return false;
    const topup = await this.find(normalized.trackingId);
    if (!topup) return false;
    // Always query Forte with this customer's stored token before touching money.
    await this.sync(topup);
    return true;
  }
  async reconcile() {
    if (!this.bank.availability()) return 0;
    // Unsettled payments have no age cutoff and get their own capacity. Recent
    // bank refusals are rechecked separately for a late confirmed success.
    const results = await Promise.all([
      this.db
        .from('personal_account_topups')
        .select('*')
        .in('status', ['creating', 'pending'])
        .order('checked_at', { ascending: true, nullsFirst: true })
        .limit(30),
      this.db
        .from('personal_account_topups')
        .select('*')
        .in('status', ['failed', 'expired'])
        .not('token_ciphertext', 'is', null)
        .gte('created_at', new Date(Date.now() - 86400000).toISOString())
        .order('checked_at', { ascending: true, nullsFirst: true })
        .limit(10),
    ]);
    for (const result of results) if (result.error) throw result.error;
    const data = results.flatMap((result) => result.data || []);
    for (const topup of data || []) {
      try {
        await this.sync(topup);
      } catch (error) {
        console.error(
          'Не удалось сверить пополнение:',
          error.code || 'PERSONAL_ACCOUNT_RECONCILE_FAILED',
        );
        await this.db
          .from('personal_account_topups')
          .update({ checked_at: new Date().toISOString() })
          .eq('id', topup.id);
      }
    }
    return (data || []).length;
  }
}
module.exports = new PersonalAccountTopups();
module.exports.PersonalAccountTopups = PersonalAccountTopups;

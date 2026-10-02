const bcrypt = require('bcryptjs');
const { supabase } = require('../config/supabase');
const { normalizeKazakhstanPhone } = require('../utils/phone.util');
const { validateNewPassword } = require('./customer-password-auth.service');
const { buildFamilyQr, readFamilyQr } = require('../utils/family-qr.util');

const memberFields =
  'id,group_id,customer_id,name,relation,login,email,daily_limit_minor,blocked,status,auth_version,qr_version,created_at,updated_at';
const familyError = (message, code = 'FAMILY_UNAVAILABLE', statusCode = 409) =>
  Object.assign(new Error(message), { code, statusCode });
const enabled = () => process.env.CUSTOMER_FAMILY_ENABLED === 'true';
const unwrap = (data) => (Array.isArray(data) ? data[0] : data);
const messages = {
  not_found: 'Участник или приглашение не найдены.',
  forbidden: 'Это действие доступно владельцу семьи.',
  already_member: 'Пользователь уже состоит в семье.',
  own_family: 'Сначала выйдите из своей семьи.',
  expired: 'Приглашение истекло.',
  conflict: 'Этот логин уже занят.',
  self: 'Нельзя пригласить себя.',
  limit: 'Дневной лимит оплаты исчерпан.',
  blocked: 'Семейный доступ приостановлен.',
  recipient_missing: 'По этому номеру нет аккаунта Bulka.',
  busy: 'Есть незавершённая покупка. Повторите позже.',
  rate_limited: 'Приглашение уже отправлено. Дождитесь ответа.',
};

class FamilyService {
  constructor({ db = supabase, isEnabled = enabled, now = () => Date.now() } = {}) {
    Object.assign(this, { db, isEnabled, now });
  }
  requireEnabled() {
    if (!this.isEnabled())
      throw familyError('Семейный аккаунт пока недоступен.', 'FAMILY_UNAVAILABLE', 503);
  }
  async rpc(name, args) {
    this.requireEnabled();
    const { data, error } = await this.db.rpc(name, args);
    if (error) throw error;
    const result = unwrap(data);
    if (!result || !['ok', 'accepted', 'declined', 'removed'].includes(result.status))
      throw familyError(
        messages[result?.status] || 'Семейный аккаунт временно недоступен.',
        `FAMILY_${String(result?.status || 'UNAVAILABLE').toUpperCase()}`,
        result?.status === 'not_found' ? 404 : 409,
      );
    return result;
  }
  async membership(customerId) {
    if (!this.isEnabled()) return null;
    const { data, error } = await this.db
      .from('family_members')
      .select(memberFields)
      .eq('customer_id', customerId)
      .eq('status', 'active')
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }
  async activeMember(id) {
    this.requireEnabled();
    const { data: member, error } = await this.db
      .from('family_members')
      .select(`${memberFields},password_hash`)
      .eq('id', id)
      .eq('status', 'active')
      .maybeSingle();
    if (error) throw error;
    if (!member || member.blocked)
      throw familyError(messages.blocked, 'FAMILY_MEMBER_BLOCKED', 401);
    const { data: group, error: groupError } = await this.db
      .from('family_groups')
      .select('id,owner_customer_id')
      .eq('id', member.group_id)
      .maybeSingle();
    if (groupError) throw groupError;
    const { data: owner, error: ownerError } = await this.db
      .from('customers')
      .select('*')
      .eq('id', group?.owner_customer_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (ownerError) throw ownerError;
    if (!owner) throw familyError('Семья больше недоступна.', 'FAMILY_MEMBER_BLOCKED', 401);
    return { member, group, owner };
  }
  async context(customerId) {
    const member = await this.membership(customerId);
    if (!member || member.blocked) return null;
    return this.activeMember(member.id);
  }
  async profile(customer) {
    const context = await this.context(customer.id);
    if (!context) return customer;
    return {
      ...customer,
      balance: context.owner.balance,
      total_spent: context.owner.total_spent,
      updated_at: new Date(
        Math.max(
          Date.parse(customer.updated_at || customer.created_at || '') || 0,
          Date.parse(context.owner.updated_at || context.owner.created_at || '') || 0,
          Date.parse(context.member.updated_at || context.member.created_at || '') || 0,
        ),
      ).toISOString(),
      personal_bonus_balance: customer.balance,
      family: {
        memberId: context.member.id,
        ownerName: context.owner.name,
        ownerCustomerId: context.owner.id,
        relation: context.member.relation,
        isOwner: false,
        sharedBalance: context.owner.balance,
      },
    };
  }
  async loyaltyCustomers(customers) {
    if (!this.isEnabled()) return customers;
    return Promise.all(
      (customers || []).map(async (customer) => {
        if (customer.familyMember) return customer;
        const context = await this.context(customer.id);
        if (!context) return customer;
        return { ...context.owner, name: `${customer.name} · семья ${context.owner.name}` };
      }),
    );
  }
  async summary(customerId) {
    return this.rpc('family_summary', { p_customer_id: customerId });
  }
  async relatedCustomerIds(ownerId) {
    if (!this.isEnabled()) return [];
    const { data: group, error } = await this.db
      .from('family_groups')
      .select('id')
      .eq('owner_customer_id', ownerId)
      .maybeSingle();
    if (error) throw error;
    if (!group) return [];
    const { data, error: memberError } = await this.db
      .from('family_members')
      .select('customer_id')
      .eq('group_id', group.id)
      .eq('status', 'active')
      .eq('blocked', false);
    if (memberError) throw memberError;
    return (data || []).map((member) => member.customer_id).filter(Boolean);
  }
  async invite(customerId, body) {
    const phone = normalizeKazakhstanPhone(body.phone);
    if (!phone) throw familyError('Укажите номер Казахстана.', 'INVALID_PHONE', 400);
    const result = await this.rpc('family_invite', {
      p_owner_id: customerId,
      p_phone: phone,
      p_relation: body.relation,
      p_limit_minor: body.dailyLimit * 100,
    });
    // The invitation and inbox entry are committed together; push is best effort.
    await this.notifyInvitation(result.notificationId).catch(() => {});
    return { status: result.status, invitationId: result.invitationId };
  }
  async notifyInvitation(id) {
    if (!id) return;
    const { data, error } = await this.db
      .from('customer_notifications')
      .select('id,customer_id,title,body')
      .eq('id', id)
      .single();
    if (error) throw error;
    await require('./push.service').sendPushToCustomer(data.customer_id, data.title, data.body, {
      type: 'family_invitation',
      destination: 'notifications',
      notificationId: data.id,
      pushDedupeKey: `family-invite:${id}`,
      deepLink: 'https://bulka.com.kz/notifications',
    });
  }
  async answer(customerId, id, decision) {
    const result = await this.rpc('family_answer_invitation', {
      p_customer_id: customerId,
      p_invitation_id: id,
      p_accept: decision === 'accept',
    });
    require('./loyalty-sync.service').queueCustomerLoyaltySync(customerId);
    return result;
  }
  async createChild(customerId, body) {
    this.requireEnabled();
    const passwordHash = await bcrypt.hash(validateNewPassword(body.password), 12);
    return this.rpc('family_create_child', {
      p_owner_id: customerId,
      p_name: body.name,
      p_login: body.login.toLowerCase(),
      p_email: body.email.toLowerCase(),
      p_password_hash: passwordHash,
      p_limit_minor: body.dailyLimit * 100,
    });
  }
  async updateMember(customerId, id, body) {
    this.requireEnabled();
    const passwordHash = body.password
      ? await bcrypt.hash(validateNewPassword(body.password), 12)
      : null;
    const result = await this.rpc('family_update_member', {
      p_owner_id: customerId,
      p_member_id: id,
      p_limit_minor: body.dailyLimit === undefined ? null : body.dailyLimit * 100,
      p_blocked: body.blocked ?? null,
      p_password_hash: passwordHash,
    });
    if (result.customerId)
      require('./loyalty-sync.service').queueCustomerLoyaltySync(result.customerId);
    return { status: result.status };
  }
  async removeMember(customerId, id) {
    const result = await this.rpc('family_remove_member', {
      p_customer_id: customerId,
      p_member_id: id,
    });
    if (result.customerId)
      require('./loyalty-sync.service').queueCustomerLoyaltySync(result.customerId);
    return { status: result.status };
  }
  async qrForCustomer(customerId, purpose) {
    const context = await this.context(customerId);
    if (!context) return null;
    if (purpose === 'payment' && Number(context.member.daily_limit_minor) <= 0)
      throw familyError(
        'Владелец семьи ещё не разрешил оплату с общего личного счёта.',
        'FAMILY_PAYMENT_NOT_ALLOWED',
      );
    return buildFamilyQr({ ...context.member, auth_version: context.member.qr_version }, purpose, {
      now: this.now(),
    });
  }
  async resolveQr(token) {
    const proof = readFamilyQr(token, { now: this.now() });
    const context = await this.activeMember(proof.memberId);
    if (Number(context.member.qr_version) !== proof.authVersion)
      throw familyError('Обновите семейный QR в приложении.', 'FAMILY_QR_INVALID', 401);
    return { ...context, proof };
  }
}
module.exports = { FamilyService, family: new FamilyService(), familyError, memberFields };

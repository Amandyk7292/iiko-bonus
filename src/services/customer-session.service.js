const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const { getJwtSecret, signCustomerToken } = require('./auth.service');
const { getCustomerById } = require('./customer.service');

const sessionError = (message, statusCode = 401) =>
  Object.assign(new Error(message), { statusCode });
const hash = (value) =>
  crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex');

const refreshDays = () => {
  const configured = Number.parseInt(process.env.CUSTOMER_REFRESH_TOKEN_DAYS || '30', 10);
  return Number.isInteger(configured) && configured >= 1 && configured <= 365 ? configured : 30;
};

const refreshReuseGraceMs = () => {
  const configured = Number.parseInt(process.env.CUSTOMER_REFRESH_REUSE_GRACE_MS || '10000', 10);
  return Number.isInteger(configured) && configured >= 1000 && configured <= 30000
    ? configured
    : 10000;
};

const userAgentHash = (req) => {
  const value = String(req?.headers?.['user-agent'] || '').slice(0, 500);
  return value ? hash(value) : null;
};

class CustomerSessionService {
  constructor({
    db = supabase,
    loadCustomer = getCustomerById,
    signToken = signCustomerToken,
    jwtSecret = getJwtSecret,
    now = () => new Date(),
    wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {}) {
    this.db = db;
    this.loadCustomer = loadCustomer;
    this.signToken = signToken;
    this.jwtSecret = jwtSecret;
    this.now = now;
    this.wait = wait;
  }

  rotatedToken(rawToken, customerId) {
    const secret = String(this.jwtSecret() || '');
    if (secret.length < 32) {
      throw sessionError('Customer session service is unavailable', 503);
    }
    return crypto
      .createHmac('sha384', secret)
      .update('bulka-customer-refresh-v1\0')
      .update(String(customerId))
      .update('\0')
      .update(String(rawToken))
      .digest('base64url');
  }

  async createRefreshToken(customerId, req, { token } = {}) {
    const refreshToken = token || crypto.randomBytes(48).toString('base64url');
    const expiresAt = new Date(this.now().getTime() + refreshDays() * 86400000).toISOString();
    const { data, error } = await this.db
      .from('customer_refresh_tokens')
      .insert({
        customer_id: customerId,
        token_hash: hash(refreshToken),
        expires_at: expiresAt,
        user_agent_hash: userAgentHash(req),
      })
      .select('id')
      .single();
    if (error) throw error;
    return { id: data.id, token: refreshToken, expiresAt };
  }

  async credentialVersion(customerId) {
    const { data, error } = await this.db
      .from('customer_credentials')
      .select('auth_version')
      .eq('customer_id', customerId)
      .maybeSingle();
    if (error) throw error;
    return data ? Number(data.auth_version) : undefined;
  }

  async sessionPayload(customer, refresh) {
    const authVersion = await this.credentialVersion(customer.id);
    return {
      accessToken: this.signToken(customer, {
        authVersion: Number.isInteger(authVersion) ? authVersion : undefined,
      }),
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
      sessionIdentity: {
        id: String(customer.id),
        phone: String(customer.phone),
      },
    };
  }

  async issueCustomerSession(customer, req) {
    const refresh = await this.createRefreshToken(customer.id, req);
    return this.sessionPayload(customer, refresh);
  }

  async resumeRecentRotation(currentId, rawToken, req) {
    const expectedUserAgent = userAgentHash(req);
    const nextToken = { value: '' };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data: latest, error } = await this.db
        .from('customer_refresh_tokens')
        .select('id,customer_id,expires_at,revoked_at,replaced_by,user_agent_hash')
        .eq('id', currentId)
        .maybeSingle();
      if (error) throw error;
      const revokedAt = Date.parse(latest?.revoked_at || '');
      const age = this.now().getTime() - revokedAt;
      if (
        !latest ||
        !Number.isFinite(revokedAt) ||
        age < -1000 ||
        age > refreshReuseGraceMs() ||
        String(latest.user_agent_hash || '') !== String(expectedUserAgent || '')
      ) {
        throw sessionError('Refresh session is invalid or expired');
      }

      nextToken.value ||= this.rotatedToken(rawToken, latest.customer_id);
      const { data: replacement, error: replacementError } = await this.db
        .from('customer_refresh_tokens')
        .select('id,customer_id,expires_at,revoked_at,token_hash')
        .eq('token_hash', hash(nextToken.value))
        .maybeSingle();
      if (replacementError) throw replacementError;
      if (
        replacement &&
        replacement.customer_id === latest.customer_id &&
        !replacement.revoked_at &&
        Date.parse(replacement.expires_at) > this.now().getTime()
      ) {
        if (!latest.replaced_by) {
          const { error: linkError } = await this.db
            .from('customer_refresh_tokens')
            .update({ replaced_by: replacement.id })
            .eq('id', latest.id);
          if (linkError) {
            console.error('Не удалось связать refresh-токены:', linkError.message);
          }
        }
        const customer = await this.loadCustomer(latest.customer_id);
        if (!customer) throw sessionError('Customer no longer exists');
        return this.sessionPayload(customer, {
          id: replacement.id,
          token: nextToken.value,
          expiresAt: replacement.expires_at,
        });
      }
      await this.wait(10 * (attempt + 1));
    }
    throw sessionError('Refresh session was already used');
  }

  async rotateCustomerSession(rawToken, req) {
    const token = String(rawToken || '').trim();
    if (token.length < 40 || token.length > 256) {
      throw sessionError('Refresh session is invalid');
    }
    const { data: current, error: readError } = await this.db
      .from('customer_refresh_tokens')
      .select('*')
      .eq('token_hash', hash(token))
      .maybeSingle();
    if (readError) throw readError;
    if (!current || Date.parse(current.expires_at) <= this.now().getTime()) {
      throw sessionError('Refresh session is invalid or expired');
    }
    if (current.revoked_at) {
      return this.resumeRecentRotation(current.id, token, req);
    }

    const now = this.now().toISOString();
    const { data: claimed, error: claimError } = await this.db
      .from('customer_refresh_tokens')
      .update({ revoked_at: now, last_used_at: now })
      .eq('id', current.id)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) return this.resumeRecentRotation(current.id, token, req);

    const customer = await this.loadCustomer(current.customer_id);
    if (!customer) throw sessionError('Customer no longer exists');
    const refresh = await this.createRefreshToken(current.customer_id, req, {
      token: this.rotatedToken(token, current.customer_id),
    });
    const { error: replaceError } = await this.db
      .from('customer_refresh_tokens')
      .update({ replaced_by: refresh.id })
      .eq('id', current.id);
    if (replaceError) {
      console.error('Не удалось связать refresh-токены:', replaceError.message);
    }
    return this.sessionPayload(customer, refresh);
  }

  async revokeCustomerSession(rawToken) {
    const token = String(rawToken || '').trim();
    if (!token) return;
    const { error } = await this.db
      .from('customer_refresh_tokens')
      .update({ revoked_at: this.now().toISOString() })
      .eq('token_hash', hash(token))
      .is('revoked_at', null);
    if (error) throw error;
  }
}

const customerSessions = new CustomerSessionService();

module.exports = {
  CustomerSessionService,
  issueCustomerSession: (...args) => customerSessions.issueCustomerSession(...args),
  revokeCustomerSession: (...args) => customerSessions.revokeCustomerSession(...args),
  rotateCustomerSession: (...args) => customerSessions.rotateCustomerSession(...args),
};

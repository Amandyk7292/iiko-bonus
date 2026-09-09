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
  const configured = Number(process.env.CUSTOMER_REFRESH_TOKEN_DAYS || '0');
  return Number.isInteger(configured) && configured >= 1 && configured <= 365 ? configured : 0;
};

const isExpired = (session, now) => {
  if (session.expires_at === null) return false;
  const expiry = Date.parse(session.expires_at || '');
  return !Number.isFinite(expiry) || expiry <= now;
};

const recoveryKeyHash = (req) => {
  const value = String(req?.headers?.['x-bulka-session-recovery'] || '');
  return /^[A-Za-z0-9_-]{40,128}$/.test(value) ? hash(value) : null;
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

  async createRefreshToken(customerId, req, { token, authVersion } = {}) {
    const refreshToken = token || crypto.randomBytes(48).toString('base64url');
    const days = refreshDays();
    const expiresAt = days ? new Date(this.now().getTime() + days * 86400000).toISOString() : null;
    const version = authVersion ?? (await this.credentialVersion(customerId)) ?? 0;
    const { data, error } = await this.db
      .from('customer_refresh_tokens')
      .insert({
        customer_id: customerId,
        token_hash: hash(refreshToken),
        expires_at: expiresAt,
        user_agent_hash: userAgentHash(req),
        auth_version: version,
      })
      .select('id')
      .single();
    if (error) throw error;
    return { id: data.id, token: refreshToken, expiresAt, authVersion: version };
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
    if (refresh.authVersion != null && Number(refresh.authVersion) !== (authVersion ?? 0)) {
      throw sessionError('Customer credentials have changed');
    }
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

  async customerForSession(session) {
    const customer = await this.loadCustomer(session.customer_id);
    if (!customer || customer.deleted_at) throw sessionError('Customer no longer exists');
    const version = (await this.credentialVersion(customer.id)) ?? 0;
    if (session.auth_version != null && Number(session.auth_version) !== version) {
      throw sessionError('Customer credentials have changed');
    }
    return { customer, authVersion: version };
  }

  async confirmRotation(parentId, refresh) {
    const { data: parent, error } = await this.db
      .from('customer_refresh_tokens')
      .select('revoked_at,last_used_at')
      .eq('id', parentId)
      .maybeSingle();
    if (error) throw error;
    if (!parent?.last_used_at || parent.last_used_at !== parent.revoked_at) {
      // Logout can race an insert before the parent/child link is saved.
      await this.revokeCustomerSession(refresh.token);
      throw sessionError('Customer session was revoked');
    }
  }

  async resumeRecentRotation(currentId, rawToken, req) {
    const expectedUserAgent = userAgentHash(req);
    const proofHash = recoveryKeyHash(req);
    const nextToken = { value: '' };
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const { data: latest, error } = await this.db
        .from('customer_refresh_tokens')
        .select('*')
        .eq('id', currentId)
        .maybeSingle();
      if (error) throw error;
      const revokedAt = Date.parse(latest?.revoked_at || '');
      const lastUsedAt = Date.parse(latest?.last_used_at || '');
      const age = this.now().getTime() - revokedAt;
      const verifiedRecovery = Boolean(proofHash && latest?.rotation_key_hash === proofHash);
      if (
        !latest ||
        !Number.isFinite(revokedAt) ||
        !Number.isFinite(lastUsedAt) ||
        lastUsedAt !== revokedAt ||
        age < -1000 ||
        isExpired(latest, this.now().getTime()) ||
        (!verifiedRecovery &&
          (age > refreshReuseGraceMs() ||
            String(latest.user_agent_hash || '') !== String(expectedUserAgent || '')))
      ) {
        throw sessionError('Refresh session is invalid or expired');
      }

      const { customer, authVersion } = await this.customerForSession(latest);

      nextToken.value ||= this.rotatedToken(rawToken, latest.customer_id);
      const { data: replacement, error: replacementError } = await this.db
        .from('customer_refresh_tokens')
        .select('*')
        .eq('token_hash', hash(nextToken.value))
        .maybeSingle();
      if (replacementError) throw replacementError;
      if (
        replacement &&
        replacement.customer_id === latest.customer_id &&
        !replacement.revoked_at &&
        !isExpired(replacement, this.now().getTime())
      ) {
        if (!latest.replaced_by) {
          const { error: linkError } = await this.db
            .from('customer_refresh_tokens')
            .update({ replaced_by: replacement.id })
            .eq('id', latest.id);
          if (linkError) {
            throw linkError;
          }
        }
        await this.customerForSession(replacement);
        const resumed = {
          id: replacement.id,
          token: nextToken.value,
          expiresAt: replacement.expires_at,
          authVersion,
        };
        await this.confirmRotation(latest.id, resumed);
        return this.sessionPayload(customer, resumed);
      }

      if (verifiedRecovery && replacement?.revoked_at && latest.replaced_by === replacement.id) {
        // A delayed browser response may restore an older cookie. Follow only
        // rotations carrying this device's proof; explicit revocation still stops recovery.
        currentId = replacement.id;
        rawToken = nextToken.value;
        nextToken.value = '';
        continue;
      }

      // A process may stop after atomically claiming the old token but before
      // inserting its deterministic successor. Only a genuine rotation claim
      // has last_used_at equal to revoked_at; ordinary explicit revocations do
      // not satisfy that invariant. The unique token hash makes concurrent
      // recovery attempts converge on one row.
      if (!latest.replaced_by) {
        try {
          const recovered = await this.createRefreshToken(latest.customer_id, req, {
            token: nextToken.value,
            authVersion,
          });
          const { error: linkError } = await this.db
            .from('customer_refresh_tokens')
            .update({ replaced_by: recovered.id })
            .eq('id', latest.id)
            .is('replaced_by', null);
          if (linkError) {
            throw linkError;
          }
          await this.confirmRotation(latest.id, recovered);
          return this.sessionPayload(customer, recovered);
        } catch (recoveryError) {
          if (recoveryError?.code !== '23505') throw recoveryError;
        }
      }
      await this.wait(10 * (attempt + 1));
    }
    throw sessionError('Customer session recovery is temporarily unavailable', 503);
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
    if (!current || isExpired(current, this.now().getTime())) {
      throw sessionError('Refresh session is invalid or expired');
    }
    if (current.revoked_at) {
      return this.resumeRecentRotation(current.id, token, req);
    }

    const { customer, authVersion } = await this.customerForSession(current);

    const now = this.now().toISOString();
    const { data: claimed, error: claimError } = await this.db
      .from('customer_refresh_tokens')
      .update({ revoked_at: now, last_used_at: now, rotation_key_hash: recoveryKeyHash(req) })
      .eq('id', current.id)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) return this.resumeRecentRotation(current.id, token, req);

    const refresh = await this.createRefreshToken(current.customer_id, req, {
      token: this.rotatedToken(token, current.customer_id),
      authVersion,
    });
    const { error: replaceError } = await this.db
      .from('customer_refresh_tokens')
      .update({ replaced_by: refresh.id })
      .eq('id', current.id);
    if (replaceError) {
      throw replaceError;
    }
    await this.confirmRotation(current.id, refresh);
    return this.sessionPayload(customer, refresh);
  }

  async revokeCustomerSession(rawToken) {
    const token = String(rawToken || '').trim();
    if (!token) return;
    const { error } = await this.db.rpc('revoke_customer_refresh_session', {
      p_token_hash: hash(token),
    });
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

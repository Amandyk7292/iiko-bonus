const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');
const { getJwtSecret, verifyToken, readBearerToken } = require('./auth.service');
const { family, familyError, memberFields } = require('./family.service');
const dummyHash = '$2b$12$pvvdNihY2it501/0kjDymOfBEu5EOkFJwWI6jO1a7j15OuzNP6zby';
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const identity = (member) => ({ id: member.id, phone: `family:${member.id}` });

class FamilyChildSessionService {
  constructor({ db = supabase, families = family, now = () => Date.now() } = {}) {
    Object.assign(this, { db, families, now });
  }
  token(member, sessionId) {
    const secret = getJwtSecret();
    if (secret.length < 32)
      throw familyError('Вход временно недоступен.', 'FAMILY_UNAVAILABLE', 503);
    return jwt.sign(
      { sub: member.id, role: 'family_child', av: member.auth_version, sid: sessionId },
      secret,
      { algorithm: 'HS256', expiresIn: '15m', issuer: 'bulka-bonus', audience: 'bulka-mobile' },
    );
  }
  async login(login, password) {
    this.families.requireEnabled();
    const { data: member, error } = await this.db
      .from('family_members')
      .select(`${memberFields},password_hash`)
      .eq('login', String(login || '').toLowerCase())
      .eq('relation', 'child')
      .maybeSingle();
    if (error) throw error;
    const valid = typeof password === 'string' && Buffer.byteLength(password) <= 72;
    const matches = await bcrypt.compare(
      valid ? password : 'invalid-password',
      member?.password_hash || dummyHash,
    );
    if (!member || !matches || !valid || member.status !== 'active' || member.blocked)
      throw familyError('Неверный логин или пароль.', 'INVALID_CREDENTIALS', 401);
    const context = await this.families.activeMember(member.id);
    const refreshToken = `FCH-${crypto.randomBytes(48).toString('base64url')}`;
    const sessionId = crypto.randomUUID();
    const refreshExpiresAt = new Date(this.now() + 30 * 86400000).toISOString();
    const { error: sessionError } = await this.db.from('family_child_sessions').insert({
      id: sessionId,
      token_hash: hash(refreshToken),
      member_id: member.id,
      auth_version: member.auth_version,
      expires_at: refreshExpiresAt,
    });
    if (sessionError) throw sessionError;
    return {
      context,
      session: {
        accessToken: this.token(member, sessionId),
        refreshToken,
        refreshExpiresAt,
        sessionIdentity: identity(member),
      },
    };
  }
  async refresh(rawToken) {
    this.families.requireEnabled();
    if (!/^FCH-[A-Za-z0-9_-]{64}$/.test(String(rawToken || '')))
      throw familyError('Войдите в детский аккаунт снова.', 'CUSTOMER_SESSION_INVALID', 401);
    const { data: session, error } = await this.db
      .from('family_child_sessions')
      .select('*')
      .eq('token_hash', hash(rawToken))
      .is('revoked_at', null)
      .gt('expires_at', new Date(this.now()).toISOString())
      .maybeSingle();
    if (error) throw error;
    if (!session)
      throw familyError('Войдите в детский аккаунт снова.', 'CUSTOMER_SESSION_INVALID', 401);
    const { member } = await this.families.activeMember(session.member_id);
    if (Number(member.auth_version) !== Number(session.auth_version))
      throw familyError('Войдите в детский аккаунт снова.', 'CUSTOMER_SESSION_INVALID', 401);
    return {
      accessToken: this.token(member, session.id),
      refreshToken: rawToken,
      refreshExpiresAt: session.expires_at,
      sessionIdentity: identity(member),
    };
  }
  async authorize(token) {
    let payload;
    try {
      payload = verifyToken(token, 'bulka-mobile');
    } catch (error) {
      if (error.statusCode === 503) throw error;
      throw familyError('Войдите в детский аккаунт снова.', 'CUSTOMER_SESSION_INVALID', 401);
    }
    if (payload.role !== 'family_child' || !payload.sub || !payload.sid)
      throw familyError('Войдите в детский аккаунт снова.', 'CUSTOMER_SESSION_INVALID', 401);
    this.families.requireEnabled();
    const { data: session, error } = await this.db
      .from('family_child_sessions')
      .select('member_id,auth_version')
      .eq('id', payload.sid)
      .is('revoked_at', null)
      .gt('expires_at', new Date(this.now()).toISOString())
      .maybeSingle();
    if (error) throw error;
    const context = await this.families.activeMember(payload.sub);
    if (
      !session ||
      session.member_id !== payload.sub ||
      Number(session.auth_version) !== Number(payload.av) ||
      Number(context.member.auth_version) !== Number(payload.av) ||
      context.member.relation !== 'child'
    )
      throw familyError('Войдите в детский аккаунт снова.', 'CUSTOMER_SESSION_INVALID', 401);
    return context;
  }
  async logout(token) {
    const { error } = await this.db
      .from('family_child_sessions')
      .update({ revoked_at: new Date(this.now()).toISOString() })
      .eq('token_hash', hash(token))
      .is('revoked_at', null);
    if (error) throw error;
  }
  async profile(context) {
    const { member, owner } = context;
    const { data, error } = await this.db.rpc('family_member_wallet_stats', {
      p_member_id: member.id,
    });
    if (error) throw error;
    const stats = Array.isArray(data) ? data[0] : data;
    return {
      success: true,
      exists: true,
      transactions: [],
      customer: {
        ...identity(member),
        name: member.name,
        email: member.email,
        balance: owner.balance,
        total_spent: owner.total_spent,
        created_at: member.created_at,
        isFamilyChild: true,
        family: {
          memberId: member.id,
          ownerName: owner.name,
          relation: 'child',
          dailyLimit: Number(member.daily_limit_minor) / 100,
          ...stats,
        },
      },
    };
  }
}
const childSessions = new FamilyChildSessionService();
async function familyChildAuthMiddleware(req, res, next) {
  try {
    req.familyChildAuth = await childSessions.authorize(readBearerToken(req));
    next();
  } catch (error) {
    res.status(error.statusCode || 503).json({
      success: false,
      code: error.code || 'FAMILY_UNAVAILABLE',
      error: error.statusCode ? error.message : 'Вход временно недоступен.',
    });
  }
}
module.exports = { FamilyChildSessionService, childSessions, familyChildAuthMiddleware };

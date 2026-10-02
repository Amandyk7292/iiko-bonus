const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { FamilyService } = require('../src/services/family.service');
const { FamilyChildSessionService } = require('../src/services/family-child-session.service');
const { customerAuthMiddleware } = require('../src/middlewares/customer-auth.middleware');
const { PersonalAccountPosService } = require('../src/services/personal-account-pos.service');
const { buildFamilyQr, readFamilyQr } = require('../src/utils/family-qr.util');
const contract = require('../src/contracts/family.contract');
const { getJwtSecret } = require('../src/services/auth.service');

class Query {
  constructor(db, table) {
    Object.assign(this, { db, table, filters: [], mutation: null });
  }
  select() {
    return this;
  }
  eq(key, value) {
    this.filters.push((row) => row[key] === value);
    return this;
  }
  is(key, value) {
    this.filters.push((row) => (row[key] ?? null) === value);
    return this;
  }
  gt(key, value) {
    this.filters.push((row) => new Date(row[key]) > new Date(value));
    return this;
  }
  insert(row) {
    this.mutation = { type: 'insert', row };
    return this;
  }
  update(row) {
    this.mutation = { type: 'update', row };
    return this;
  }
  execute(single = false) {
    const rows = this.db.tables[this.table];
    assert.ok(rows, `Unknown fake table ${this.table}`);
    if (this.mutation?.type === 'insert') {
      rows.push(structuredClone(this.mutation.row));
      return { data: null, error: null };
    }
    const matched = rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.mutation?.type === 'update')
      for (const row of matched) Object.assign(row, this.mutation.row);
    return { data: structuredClone(single ? matched[0] || null : matched), error: null };
  }
  maybeSingle() {
    return Promise.resolve(this.execute(true));
  }
  then(resolve, reject) {
    return Promise.resolve(this.execute()).then(resolve, reject);
  }
}

function fixture() {
  const owner = {
    id: crypto.randomUUID(),
    phone: '77000000001',
    name: 'Parent',
    balance: 500,
    total_spent: 1234,
    deleted_at: null,
  };
  const group = { id: crypto.randomUUID(), owner_customer_id: owner.id };
  const member = {
    id: crypto.randomUUID(),
    group_id: group.id,
    customer_id: null,
    name: 'Child',
    relation: 'child',
    login: 'kid_1',
    email: 'child@example.com',
    password_hash: bcrypt.hashSync('Child2026', 4),
    daily_limit_minor: 100000,
    blocked: false,
    status: 'active',
    auth_version: 1,
    qr_version: 1,
    created_at: new Date().toISOString(),
  };
  const clock = { now: Date.now() };
  const db = {
    tables: {
      customers: [owner],
      family_groups: [group],
      family_members: [member],
      family_child_sessions: [],
    },
    from(table) {
      return new Query(this, table);
    },
    async rpc(name) {
      assert.equal(name, 'family_member_wallet_stats');
      return { data: { spentToday: 100, remainingToday: 900 }, error: null };
    },
  };
  const families = new FamilyService({ db, isEnabled: () => true, now: () => clock.now });
  const sessions = new FamilyChildSessionService({ db, families, now: () => clock.now });
  return { owner, group, member, db, clock, families, sessions };
}
const invalidSession = (error) => error.statusCode === 401;

test('child login stores only a refresh digest and issues a distinct member identity', async () => {
  const f = fixture();
  const { session, context } = await f.sessions.login('KID_1', 'Child2026');
  assert.match(session.refreshToken, /^FCH-[A-Za-z0-9_-]{64}$/);
  assert.equal(session.sessionIdentity.id, f.member.id);
  assert.equal(session.sessionIdentity.phone, `family:${f.member.id}`);
  assert.equal(session.sessionIdentity.phone.includes(f.owner.phone), false);
  const payload = jwt.verify(session.accessToken, getJwtSecret(), {
    algorithms: ['HS256'],
    issuer: 'bulka-bonus',
    audience: 'bulka-mobile',
  });
  assert.equal(payload.sub, f.member.id);
  assert.equal(payload.role, 'family_child');
  assert.equal(payload.exp - payload.iat, 900);
  const persisted = f.db.tables.family_child_sessions[0];
  assert.equal(persisted.id, payload.sid);
  assert.equal(
    persisted.token_hash,
    crypto.createHash('sha256').update(session.refreshToken).digest('hex'),
  );
  assert.equal(JSON.stringify(f.db.tables).includes(session.refreshToken), false);
  assert.equal(JSON.stringify(f.db.tables).includes('Child2026'), false);
  const profile = await f.sessions.profile(context);
  assert.equal(profile.customer.isFamilyChild, true);
  assert.equal(profile.customer.family.dailyLimit, 1000);
  assert.equal(profile.customer.family.remainingToday, 900);
  assert.equal(profile.customer.balance, 500);
  assert.equal(JSON.stringify(profile).includes(f.owner.phone), false);
  assert.equal(JSON.stringify(profile).includes(f.owner.id), false);
  assert.equal(JSON.stringify(profile).includes('password_hash'), false);
});

test('bad, missing, removed and blocked child credentials all fail without issuing sessions', async () => {
  for (const scenario of [
    'wrong_password',
    'missing_login',
    'oversized_password',
    'removed',
    'blocked',
  ]) {
    const f = fixture();
    if (scenario === 'removed') f.member.status = 'removed';
    if (scenario === 'blocked') f.member.blocked = true;
    await assert.rejects(
      f.sessions.login(
        scenario === 'missing_login' ? 'not_present' : f.member.login,
        scenario === 'wrong_password'
          ? 'Wrong2026'
          : scenario === 'oversized_password'
            ? 'Я'.repeat(40)
            : 'Child2026',
      ),
      (error) => error.code === 'INVALID_CREDENTIALS' && error.statusCode === 401,
    );
    assert.equal(f.db.tables.family_child_sessions.length, 0);
  }
});

test('child access tokens cannot cross into customer ordering, wallet or profile routes', async () => {
  const f = fixture();
  const { session } = await f.sessions.login(f.member.login, 'Child2026');
  for (const path of [
    '/api/customer/orders',
    '/api/customer/checkout/quote',
    '/api/customer/wallet',
    '/api/guest/profile',
  ]) {
    let nextCalled = false;
    const result = {};
    const res = {
      status(code) {
        result.status = code;
        return this;
      },
      json(body) {
        result.body = body;
        return this;
      },
    };
    await customerAuthMiddleware(
      { path, headers: { authorization: `Bearer ${session.accessToken}` } },
      res,
      () => {
        nextCalled = true;
      },
    );
    assert.equal(nextCalled, false, path);
    assert.equal(result.status, 403, path);
    assert.equal(result.body.code, 'FAMILY_CHILD_RESTRICTED', path);
  }
});

test('child sessions reject normal customer tokens and tokens for another audience or session', async () => {
  const f = fixture();
  const { session } = await f.sessions.login(f.member.login, 'Child2026');
  const options = {
    algorithm: 'HS256',
    expiresIn: '15m',
    issuer: 'bulka-bonus',
    audience: 'bulka-mobile',
  };
  for (const payload of [
    { sub: f.owner.id, role: 'customer', phone: f.owner.phone },
    { sub: f.member.id, role: 'family_child', av: 1, sid: crypto.randomUUID() },
    { sub: f.owner.id, role: 'family_child', av: 1, sid: f.db.tables.family_child_sessions[0].id },
  ])
    await assert.rejects(
      f.sessions.authorize(jwt.sign(payload, getJwtSecret(), options)),
      invalidSession,
    );
  const decoded = jwt.decode(session.accessToken);
  delete decoded.exp;
  delete decoded.iat;
  delete decoded.aud;
  delete decoded.iss;
  await assert.rejects(
    f.sessions.authorize(
      jwt.sign(decoded, getJwtSecret(), { ...options, audience: 'bulka-wallet' }),
    ),
    invalidSession,
  );
});

test('logout revokes both access and refresh; expiration and password changes revoke previous sessions', async () => {
  for (const scenario of ['logout', 'expiry', 'password', 'blocked', 'removed', 'owner_deleted']) {
    const f = fixture();
    const { session } = await f.sessions.login(f.member.login, 'Child2026');
    assert.equal((await f.sessions.authorize(session.accessToken)).member.id, f.member.id);
    assert.equal((await f.sessions.refresh(session.refreshToken)).sessionIdentity.id, f.member.id);
    if (scenario === 'logout') await f.sessions.logout(session.refreshToken);
    if (scenario === 'expiry')
      f.db.tables.family_child_sessions[0].expires_at = new Date(f.clock.now - 1000).toISOString();
    if (scenario === 'password') f.member.auth_version++;
    if (scenario === 'blocked') f.member.blocked = true;
    if (scenario === 'removed') f.member.status = 'removed';
    if (scenario === 'owner_deleted') f.owner.deleted_at = new Date().toISOString();
    await assert.rejects(f.sessions.authorize(session.accessToken), invalidSession, scenario);
    await assert.rejects(f.sessions.refresh(session.refreshToken), invalidSession, scenario);
  }
});

test('refresh rejects foreign, fabricated and expired refresh credentials', async () => {
  const f = fixture();
  for (const token of ['', 'ordinary-refresh-token', 'FCH-short', `FCH-${'a'.repeat(64)}`]) {
    await assert.rejects(
      f.sessions.refresh(token),
      (error) => error.code === 'CUSTOMER_SESSION_INVALID',
    );
  }
  const { session } = await f.sessions.login(f.member.login, 'Child2026');
  f.clock.now += 31 * 86400000;
  await assert.rejects(f.sessions.refresh(session.refreshToken), invalidSession);
});

test('changing only a daily limit invalidates old QR while keeping the child login session usable', async () => {
  const f = fixture();
  const { session } = await f.sessions.login(f.member.login, 'Child2026');
  const original = buildFamilyQr({ ...f.member, auth_version: f.member.qr_version }, 'payment', {
    now: f.clock.now,
  });
  assert.equal((await f.families.resolveQr(original.token)).proof.purpose, 'payment');
  f.member.daily_limit_minor = 50000;
  f.member.qr_version++;
  await assert.rejects(
    f.families.resolveQr(original.token),
    (error) => error.code === 'FAMILY_QR_INVALID',
  );
  assert.equal((await f.sessions.authorize(session.accessToken)).member.daily_limit_minor, 50000);
  assert.equal((await f.sessions.refresh(session.refreshToken)).sessionIdentity.id, f.member.id);
});

test('family QR signatures bind member, purpose, version and exact five-minute expiry', () => {
  const member = { id: crypto.randomUUID(), auth_version: 3 };
  const now = 1800000000000;
  const options = { now, secret: 'family-unit-secret-with-at-least-32-characters' };
  const payment = buildFamilyQr(member, 'payment', options);
  assert.equal(payment.expiresAt, now + 300000);
  assert.equal(payment.ttlSeconds, 300);
  assert.ok(payment.token.length <= 160);
  assert.deepEqual(readFamilyQr(payment.token, options), {
    memberId: member.id,
    authVersion: 3,
    purpose: 'payment',
    expiresAt: payment.expiresAt,
  });
  assert.equal(
    readFamilyQr(buildFamilyQr(member, 'loyalty', options).token, options).purpose,
    'loyalty',
  );
  for (const token of [
    payment.token.replace(member.id, crypto.randomUUID()),
    payment.token.replace(':3:', ':4:'),
    payment.token.replace(':p:', ':l:'),
    payment.token.replace(String(payment.expiresAt / 1000), String(payment.expiresAt / 1000 + 1)),
    payment.token.slice(0, -1),
    `${payment.token}:extra`,
  ])
    assert.throws(
      () => readFamilyQr(token, options),
      (error) => error.code === 'FAMILY_QR_INVALID',
    );
  assert.throws(
    () => readFamilyQr(payment.token, { ...options, now: payment.expiresAt }),
    (error) => error.code === 'FAMILY_QR_INVALID',
  );
  assert.throws(
    () => readFamilyQr(payment.token, { ...options, now: now - 1 }),
    (error) => error.code === 'FAMILY_QR_INVALID',
  );
  assert.throws(
    () =>
      readFamilyQr(payment.token, {
        ...options,
        secret: 'different-family-secret-with-at-least-32-characters',
      }),
    (error) => error.code === 'FAMILY_QR_INVALID',
  );
});

test('a loyalty QR cannot silently authorize spending from the parent wallet', async () => {
  let calls = 0;
  const ownerId = crypto.randomUUID();
  const familyMember = {
    id: crypto.randomUUID(),
    qrVersion: 1,
    expiresAt: Date.now() + 100000,
    purpose: 'loyalty',
  };
  const service = new PersonalAccountPosService({
    lookup: async () => [{ id: ownerId, familyMember }],
    db: {
      async rpc(name, args) {
        calls++;
        assert.equal(name, 'family_pos_start');
        assert.equal(args.p_member_id, familyMember.id);
        return {
          data: {
            id: args.p_id,
            status: 'authorized',
            expiresAt: args.p_qr_expires_at,
            familyBonusCustomerId: ownerId,
          },
          error: null,
        };
      },
    },
    push: async () => assert.fail('family QR authorization must not send an OTP'),
    env: {},
  });
  const payload = {
    customerCode: 'BULKA-FAMILY:opaque',
    amount: 123,
    requestId: crypto.randomUUID(),
    orderId: crypto.randomUUID(),
    fingerprint: 'b'.repeat(64),
  };
  await assert.rejects(
    service.start(crypto.randomUUID(), payload),
    (error) => error.code === 'PERSONAL_POS_UNAUTHORIZED',
  );
  assert.equal(calls, 0);
  familyMember.purpose = 'payment';
  for (const capability of [undefined, false]) {
    await assert.rejects(
      service.start(crypto.randomUUID(), { ...payload, familyBonusBindingSupported: capability }),
      (error) => error.code === 'PERSONAL_POS_FAMILY_CLIENT_UPDATE',
    );
    assert.equal(calls, 0, 'old cashier must not reserve or debit the family wallet');
  }
  payload.familyBonusBindingSupported = true;
  const result = await service.start(crypto.randomUUID(), payload);
  assert.equal(result.status, 'authorized');
  assert.equal(result.familyBonusCustomerId, ownerId);
  assert.equal(calls, 1);
});

test('family payment status and refund keep the captured bonus owner for cashier recovery', async () => {
  const ownerId = crypto.randomUUID();
  const id = crypto.randomUUID();
  const service = new PersonalAccountPosService({
    db: {
      async rpc(name, args) {
        assert.equal(name, 'personal_account_pos_action');
        return {
          data: {
            id,
            status: args.p_action === 'refund' ? 'refunded' : 'paid',
            familyBonusCustomerId: ownerId,
          },
        };
      },
    },
    push: async () => assert.fail('must not send a new OTP'),
    publish: () => {},
    env: {},
  });
  for (const action of ['status', 'pay', 'refund']) {
    const result = await service.action(crypto.randomUUID(), {
      id,
      orderId: crypto.randomUUID(),
      amount: 123,
      fingerprint: 'b'.repeat(64),
      action,
    });
    assert.equal(result.familyBonusCustomerId, ownerId);
    assert.deepEqual(Object.keys(result).sort(), [
      'amount',
      'familyBonusCustomerId',
      'id',
      'status',
    ]);
  }
});

test('family creation hashes the child password before sending it to SQL', async () => {
  let captured;
  const families = new FamilyService({
    db: {
      async rpc(name, args) {
        assert.equal(name, 'family_create_child');
        captured = args;
        return { data: { status: 'ok', memberId: crypto.randomUUID() }, error: null };
      },
    },
    isEnabled: () => true,
  });
  await families.createChild(crypto.randomUUID(), {
    name: 'Child',
    login: 'KID_2',
    email: 'CHILD@example.com',
    password: 'Child2026',
    dailyLimit: 2000,
  });
  assert.equal(captured.p_login, 'kid_2');
  assert.equal(captured.p_email, 'child@example.com');
  assert.equal(captured.p_limit_minor, 200000);
  assert.equal(await bcrypt.compare('Child2026', captured.p_password_hash), true);
  assert.equal(JSON.stringify(captured).includes('Child2026'), false);
});

test('an adult sees shared bonuses while retaining their own customer identity and personal balance', async () => {
  const f = fixture();
  const adult = {
    id: crypto.randomUUID(),
    name: 'Adult',
    phone: '77000000002',
    balance: 75,
    total_spent: 100,
    created_at: new Date().toISOString(),
  };
  Object.assign(f.member, {
    customer_id: adult.id,
    relation: 'wife',
    login: null,
    email: null,
    password_hash: null,
  });
  f.db.tables.customers.push(adult);
  const profile = await f.families.profile(adult);
  assert.equal(profile.id, adult.id);
  assert.equal(profile.phone, adult.phone);
  assert.equal(profile.name, adult.name);
  assert.equal(profile.balance, f.owner.balance);
  assert.equal(profile.total_spent, f.owner.total_spent);
  assert.equal(profile.personal_bonus_balance, 75);
  const [cashierMatch] = await f.families.loyaltyCustomers([adult]);
  assert.equal(cashierMatch.id, f.owner.id);
  assert.ok(cashierMatch.name.includes(adult.name));
  f.member.blocked = true;
  assert.deepEqual(await f.families.profile(adult), adult);
  const disabled = new FamilyService({
    db: {
      from() {
        assert.fail('disabled family must not access its tables');
      },
    },
    isEnabled: () => false,
  });
  assert.deepEqual(await disabled.profile(adult), adult);
});

test('family contracts reject impersonation fields, unsupported roles, fractional caps and non-Kazakhstan phones', async () => {
  assert.equal(
    contract.inviteBody.safeParse({ phone: '77000000001', relation: 'child' }).success,
    false,
  );
  assert.equal(
    contract.inviteBody.safeParse({
      phone: '77000000001',
      relation: 'wife',
      ownerCustomerId: crypto.randomUUID(),
    }).success,
    false,
  );
  assert.equal(
    contract.invitationAnswerBody.safeParse({
      decision: 'accept',
      recipientCustomerId: crypto.randomUUID(),
    }).success,
    false,
  );
  assert.equal(contract.memberUpdateBody.safeParse({ dailyLimit: 1.5 }).success, false);
  assert.equal(contract.memberUpdateBody.safeParse({ dailyLimit: -1 }).success, false);
  assert.equal(contract.memberUpdateBody.safeParse({}).success, false);
  const families = new FamilyService({
    db: {
      rpc() {
        assert.fail('invalid phone must not reach SQL');
      },
    },
    isEnabled: () => true,
  });
  await assert.rejects(
    families.invite(crypto.randomUUID(), {
      phone: '+12025550123',
      relation: 'wife',
      dailyLimit: 0,
    }),
    (error) => error.code === 'INVALID_PHONE',
  );
});

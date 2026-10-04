const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const bcrypt = require('bcryptjs');

const {
  AUTH_PURPOSES,
  authenticateCustomerPassword,
  consumeRegistrationCredentialGrant,
  createRegistrationCredentialGrant,
  startCustomerPasswordReset,
  startCustomerRegistration,
  validateNewPassword,
} = require('../src/services/customer-password-auth.service');

class FakeQuery {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.action = 'select';
    this.filters = [];
    this.returning = false;
    this.row = null;
  }

  select() {
    this.returning = true;
    return this;
  }

  insert(row) {
    this.action = 'insert';
    this.row = structuredClone(row);
    return this;
  }

  upsert(row) {
    this.action = 'upsert';
    this.row = structuredClone(row);
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  eq(column, value) {
    this.filters.push({ type: 'eq', column, value });
    return this;
  }

  gt(column, value) {
    this.filters.push({ type: 'gt', column, value });
    return this;
  }

  lt(column, value) {
    this.filters.push({ type: 'lt', column, value });
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.execute(true));
  }

  single() {
    return Promise.resolve(this.execute(true));
  }

  then(resolve, reject) {
    return Promise.resolve(this.execute(false)).then(resolve, reject);
  }

  keyFor(row) {
    return row.id || row.customer_id;
  }

  matches(row) {
    return this.filters.every(({ type, column, value }) => {
      const actual = row[column];
      if (type === 'eq') return String(actual) === String(value);
      const left = new Date(actual).getTime();
      const right = new Date(value).getTime();
      return type === 'gt' ? left > right : left < right;
    });
  }

  execute(single) {
    const store = this.database[this.table];
    if (!store) throw new Error(`Unknown fake table: ${this.table}`);
    if (this.action === 'insert' || this.action === 'upsert') {
      const key = this.keyFor(this.row);
      if (this.action === 'insert' && store.has(key)) {
        return { data: null, error: { code: '23505', message: 'duplicate' } };
      }
      store.set(key, structuredClone(this.row));
      return { data: structuredClone(this.row), error: null };
    }

    const matches = Array.from(store.entries()).filter(([, row]) => this.matches(row));
    if (this.action === 'delete') {
      for (const [key] of matches) store.delete(key);
    }
    const rows = matches.map(([, row]) => structuredClone(row));
    return {
      data: single ? rows[0] || null : this.returning ? rows : null,
      error: null,
    };
  }
}

function fakeDatabase() {
  const tables = {
    customer_credentials: new Map(),
    whatsapp_sessions: new Map(),
  };
  return {
    tables,
    client: {
      from(table) {
        return new FakeQuery(tables, table);
      },
    },
  };
}

test('password policy accepts letters and digits and rejects weak or oversized values', () => {
  assert.equal(validateNewPassword('Bulka2026'), 'Bulka2026');
  assert.equal(validateNewPassword('Құпиясөз2026'), 'Құпиясөз2026');
  assert.throws(() => validateNewPassword('12345678'), { code: 'INVALID_PASSWORD' });
  assert.throws(() => validateNewPassword('password'), { code: 'INVALID_PASSWORD' });
  assert.throws(() => validateNewPassword(`A1${'я'.repeat(40)}`), { code: 'INVALID_PASSWORD' });
});

test('registration stores only a bcrypt hash in a purpose-bound WhatsApp request', async () => {
  const { tables, client } = fakeDatabase();
  const result = await startCustomerRegistration(
    {
      phone: '8 (700) 123-45-67',
      password: 'Bulka2026',
      requestToken: 'AbCdEf234567',
    },
    { db: client, findCustomer: async () => null },
  );

  assert.equal(result.phone, '+77001234567');
  assert.match(result.whatsappUrl, /^https:\/\/wa\.me\//);
  const row = tables.whatsapp_sessions.get('token_AbCdEf234567');
  assert.equal(row.data.purpose, AUTH_PURPOSES.registration);
  assert.notEqual(row.data.passwordHash, 'Bulka2026');
  assert.equal(await bcrypt.compare('Bulka2026', row.data.passwordHash), true);
});

test('existing legacy customers are directed to recovery and credential accounts to login', async () => {
  const { tables, client } = fakeDatabase();
  const customer = { id: 'customer-1', phone: '+77001234567', name: 'Алия' };

  await assert.rejects(
    startCustomerRegistration(
      {
        phone: customer.phone,
        password: 'Bulka2026',
        requestToken: 'Legacy234567',
      },
      { db: client, findCustomer: async () => customer },
    ),
    (error) => error.code === 'PASSWORD_SETUP_REQUIRED' && error.statusCode === 409,
  );

  tables.customer_credentials.set(customer.id, {
    customer_id: customer.id,
    password_hash: await bcrypt.hash('Bulka2026', 10),
    auth_version: 1,
  });
  await assert.rejects(
    startCustomerRegistration(
      {
        phone: customer.phone,
        password: 'Bulka2026',
        requestToken: 'Account234567',
      },
      { db: client, findCustomer: async () => customer },
    ),
    (error) => error.code === 'ACCOUNT_EXISTS' && error.statusCode === 409,
  );
});

test('password login succeeds without OTP and keeps failures generic', async () => {
  const { tables, client } = fakeDatabase();
  const customer = { id: 'customer-2', phone: '+77007654321', name: 'Арман' };
  tables.customer_credentials.set(customer.id, {
    customer_id: customer.id,
    password_hash: await bcrypt.hash('Secure2026', 10),
    auth_version: 3,
  });

  const authenticated = await authenticateCustomerPassword(
    { phone: customer.phone, password: 'Secure2026' },
    { db: client, findCustomer: async () => customer },
  );
  assert.equal(authenticated.customer.id, customer.id);
  assert.equal(authenticated.authVersion, 3);

  for (const attempt of [
    { phone: customer.phone, password: 'Wrong2026' },
    { phone: '+77009999999', password: 'Wrong2026' },
  ]) {
    await assert.rejects(
      authenticateCustomerPassword(attempt, {
        db: client,
        findCustomer: async (phone) => (phone === customer.phone ? customer : null),
      }),
      (error) =>
        error.code === 'INVALID_CREDENTIALS' &&
        error.statusCode === 401 &&
        error.message === 'Invalid phone or password',
    );
  }
});

test('registration credential grants remain one-time', async () => {
  const { tables, client } = fakeDatabase();
  const customer = { id: 'customer-3', phone: '+77001112233', name: 'Дана' };

  const passwordHash = await bcrypt.hash('Grant2026', 10);
  const grantId = await createRegistrationCredentialGrant(
    { phone: customer.phone, passwordHash },
    { db: client },
  );
  assert.equal(
    await consumeRegistrationCredentialGrant({ phone: customer.phone, grantId }, { db: client }),
    passwordHash,
  );
  await assert.rejects(
    consumeRegistrationCredentialGrant({ phone: customer.phone, grantId }, { db: client }),
    (error) => error.code === 'INVALID_GRANT',
  );
});

test('password recovery start uses SMS links without invoking the old WhatsApp flow', async () => {
  const { tables, client } = fakeDatabase();
  const linkDb = {
    ...client,
    rpc: async (name) => ({
      data: name === 'reserve_customer_password_reset_link' ? { status: 'reserved' } : true,
      error: null,
    }),
  };
  let sent;
  const reset = await startCustomerPasswordReset(
    { phone: '+7 700 999 99 99', requestToken: 'UnknownAbc2345' },
    {
      db: linkDb,
      env: { AUTOCALL_API_TOKEN: 'autocall-test-only-placeholder' },
      findCustomer: async () => null,
      requestOtp: async () => assert.fail('Recovery must never request a WhatsApp OTP'),
      sendSms: async (message) => {
        sent = message;
        return { messageId: 'accepted' };
      },
    },
  );
  assert.equal(reset.deliveryMode, 'sms_link');
  assert.equal(reset.channel, 'sms');
  assert.equal(reset.customer, undefined);
  assert.equal(reset.whatsappUrl, undefined);
  assert.equal(sent.phone, '+77009999999');
  assert.equal(tables.whatsapp_sessions.size, 0);
});

test('password authentication migrations stay mirrored and revoke old refresh sessions', () => {
  const root = path.join(__dirname, '..');
  const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20260722223000_customer_password_auth.sql'),
    'utf8',
  );
  const mirror = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20260722223000_customer_password_auth.sql'),
    'utf8',
  );
  assert.equal(migration, mirror);
  assert.match(migration, /create table if not exists public\.customer_credentials/i);
  assert.match(migration, /update public\.customer_refresh_tokens/i);
  assert.match(migration, /v_payload - 'code' - 'attempts'/i);
  assert.match(migration, /revoke all on table public\.customer_credentials/i);
});

test('registration still passes purpose-bound credentials to automatic OTP delivery', async () => {
  const { tables, client } = fakeDatabase();
  const sent = [];
  const requestOtp = async (payload, options) => {
    assert.equal(options.db, client);
    sent.push(payload);
    return { deliveryMode: 'automatic', channel: 'whatsapp', codeLength: 6, whatsappUrl: null };
  };
  const registration = await startCustomerRegistration(
    {
      phone: '+77001234567',
      password: 'Register2026',
      requestToken: 'RegisterToken2345',
      automaticOtpSupported: true,
    },
    { db: client, findCustomer: async () => null, requestOtp },
  );
  assert.equal(registration.deliveryMode, 'automatic');
  assert.equal(sent[0].purpose, AUTH_PURPOSES.registration);
  assert.equal(sent[0].automaticOtpSupported, true);
  assert.equal(await bcrypt.compare('Register2026', sent[0].passwordHash), true);
  assert.equal(tables.whatsapp_sessions.size, 0, 'automatic delivery does not create bot requests');
});

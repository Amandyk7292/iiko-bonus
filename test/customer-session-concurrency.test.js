const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const { CustomerSessionService } = require('../src/services/customer-session.service');

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

class SessionQuery {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.action = 'select';
    this.values = null;
    this.filters = [];
  }

  select() {
    return this;
  }

  insert(values) {
    this.action = 'insert';
    this.values = structuredClone(values);
    return this;
  }

  update(values) {
    this.action = 'update';
    this.values = structuredClone(values);
    return this;
  }

  eq(column, value) {
    this.filters.push({ column, value, kind: 'eq' });
    return this;
  }

  is(column, value) {
    this.filters.push({ column, value, kind: 'is' });
    return this;
  }

  single() {
    return Promise.resolve(this.execute(true));
  }

  maybeSingle() {
    return Promise.resolve(this.execute(true));
  }

  then(resolve, reject) {
    return Promise.resolve(this.execute(false)).then(resolve, reject);
  }

  matches(row) {
    return this.filters.every((filter) => {
      const actual = row[filter.column];
      if (filter.kind === 'is') return actual == null && filter.value == null;
      return String(actual) === String(filter.value);
    });
  }

  execute(single) {
    const rows = this.database[this.table];
    if (this.action === 'insert') {
      const duplicate = [...rows.values()].find(
        (row) => row.token_hash && row.token_hash === this.values.token_hash,
      );
      if (duplicate) return { data: null, error: { code: '23505', message: 'duplicate' } };
      const id = crypto.randomUUID();
      const row = { id, created_at: new Date().toISOString(), ...this.values };
      rows.set(id, row);
      return { data: structuredClone(row), error: null };
    }
    const matches = [...rows.values()].filter((row) => this.matches(row));
    if (this.action === 'update') {
      for (const row of matches) Object.assign(row, this.values);
    }
    const result = matches.map((row) => structuredClone(row));
    return { data: single ? result[0] || null : result, error: null };
  }
}

const createHarness = () => {
  const customerId = '117615f9-b35f-4eb4-9f6d-777f2236bb25';
  let nowMs = Date.parse('2026-08-04T19:00:00.000Z');
  const database = {
    customer_refresh_tokens: new Map(),
    customer_credentials: new Map([
      [
        customerId,
        {
          customer_id: customerId,
          auth_version: 3,
        },
      ],
    ]),
  };
  const db = {
    from(table) {
      return new SessionQuery(database, table);
    },
  };
  const service = new CustomerSessionService({
    db,
    loadCustomer: async (id) => ({ id, phone: '+77001234567', name: 'Алия' }),
    signToken: (_customer, { authVersion }) => `access-v${authVersion}`,
    jwtSecret: () => 'customer-session-test-secret-that-is-long-enough',
    now: () => new Date(nowMs),
    wait: () => Promise.resolve(),
  });
  return {
    customerId,
    database,
    service,
    advance(milliseconds) {
      nowMs += milliseconds;
    },
  };
};

test('parallel refreshes from browser tabs return the same rotated session', async () => {
  const harness = createHarness();
  const request = { headers: { 'user-agent': 'Bulka browser' } };
  const initialToken = 'initial-refresh-token-'.padEnd(64, 'a');
  await harness.service.createRefreshToken(harness.customerId, request, {
    token: initialToken,
  });

  const [first, second] = await Promise.all([
    harness.service.rotateCustomerSession(initialToken, request),
    harness.service.rotateCustomerSession(initialToken, request),
  ]);

  assert.equal(first.refreshToken, second.refreshToken);
  assert.equal(first.accessToken, 'access-v3');
  assert.equal(second.accessToken, 'access-v3');
  assert.deepEqual(first.sessionIdentity, {
    id: harness.customerId,
    phone: '+77001234567',
  });
  assert.deepEqual(second.sessionIdentity, first.sessionIdentity);
  assert.equal(harness.database.customer_refresh_tokens.size, 2);
  const original = [...harness.database.customer_refresh_tokens.values()].find(
    (row) => row.token_hash === digest(initialToken),
  );
  assert.ok(original.revoked_at);
  assert.ok(original.replaced_by);
});

test('a refresh claim interrupted before successor insertion recovers deterministically', async () => {
  const harness = createHarness();
  const request = { headers: { 'user-agent': 'Bulka Android recovery' } };
  const initialToken = 'interrupted-refresh-token-'.padEnd(64, 'r');
  await harness.service.createRefreshToken(harness.customerId, request, {
    token: initialToken,
  });

  const createRefreshToken = harness.service.createRefreshToken.bind(harness.service);
  let interruptNextInsert = true;
  harness.service.createRefreshToken = async (...args) => {
    if (interruptNextInsert) {
      interruptNextInsert = false;
      throw Object.assign(new Error('simulated process interruption'), { code: 'CONNECTION_LOST' });
    }
    return createRefreshToken(...args);
  };

  await assert.rejects(
    harness.service.rotateCustomerSession(initialToken, request),
    /simulated process interruption/,
  );
  const claimed = [...harness.database.customer_refresh_tokens.values()].find(
    (row) => row.token_hash === digest(initialToken),
  );
  assert.ok(claimed.revoked_at);
  assert.equal(claimed.last_used_at, claimed.revoked_at);
  assert.equal(claimed.replaced_by, undefined);

  const recovered = await harness.service.rotateCustomerSession(initialToken, request);
  const repeated = await harness.service.rotateCustomerSession(initialToken, request);

  assert.equal(recovered.refreshToken, repeated.refreshToken);
  assert.equal(recovered.accessToken, 'access-v3');
  assert.equal(harness.database.customer_refresh_tokens.size, 2);
  assert.ok(claimed.replaced_by);
});

test('logout-style revocation is never recovered as an interrupted rotation', async () => {
  const harness = createHarness();
  const request = { headers: { 'user-agent': 'Bulka Android logout' } };
  const initialToken = 'logged-out-refresh-token-'.padEnd(64, 'l');
  await harness.service.createRefreshToken(harness.customerId, request, {
    token: initialToken,
  });
  const current = [...harness.database.customer_refresh_tokens.values()][0];
  current.revoked_at = '2026-08-04T19:00:00.000Z';

  await assert.rejects(
    harness.service.rotateCustomerSession(initialToken, request),
    /invalid or expired/,
  );
  assert.equal(harness.database.customer_refresh_tokens.size, 1);
});

test('a rotated token cannot be replayed by a different device', async () => {
  const harness = createHarness();
  const initialToken = 'device-bound-refresh-token-'.padEnd(64, 'b');
  const firstDevice = { headers: { 'user-agent': 'Bulka Android A' } };
  await harness.service.createRefreshToken(harness.customerId, firstDevice, {
    token: initialToken,
  });
  await harness.service.rotateCustomerSession(initialToken, firstDevice);

  await assert.rejects(
    harness.service.rotateCustomerSession(initialToken, {
      headers: { 'user-agent': 'Unknown browser' },
    }),
    /invalid or expired/,
  );
});

test('parallel-refresh grace expires quickly instead of enabling token replay', async () => {
  const harness = createHarness();
  const request = { headers: { 'user-agent': 'Bulka browser' } };
  const initialToken = 'short-grace-refresh-token-'.padEnd(64, 'c');
  await harness.service.createRefreshToken(harness.customerId, request, {
    token: initialToken,
  });
  await harness.service.rotateCustomerSession(initialToken, request);
  harness.advance(10_001);

  await assert.rejects(
    harness.service.rotateCustomerSession(initialToken, request),
    /invalid or expired/,
  );
});

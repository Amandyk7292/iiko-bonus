const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeKazakhstanPhone } = require('../src/utils/phone.util');

class FakeQuery {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.action = 'select';
    this.filters = [];
    this.returning = false;
  }

  select() {
    this.returning = true;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  insert(row) {
    this.database[this.table].set(row.id || row.username, structuredClone(row));
    return Promise.resolve({ data: row, error: null });
  }

  eq(column, value) {
    this.filters.push({ type: 'eq', column, value });
    return this;
  }

  gt(column, value) {
    this.filters.push({ type: 'gt', column, value });
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.execute(true));
  }

  then(resolve, reject) {
    return Promise.resolve(this.execute(false)).then(resolve, reject);
  }

  readColumn(row, column) {
    if (!column.startsWith('data->>')) return row[column];
    const key = column.slice('data->>'.length);
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    return data?.[key];
  }

  matches(row) {
    return this.filters.every((filter) => {
      const actual = this.readColumn(row, filter.column);
      if (filter.type === 'eq') return String(actual) === String(filter.value);
      return new Date(actual).getTime() > new Date(filter.value).getTime();
    });
  }

  execute(single) {
    const store = this.database[this.table];
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

test('Kazakhstan staff phones use one canonical format', () => {
  assert.equal(normalizeKazakhstanPhone('8 (700) 123-45-67'), '+77001234567');
  assert.equal(normalizeKazakhstanPhone('+7 700 123 45 67'), '+77001234567');
  assert.equal(normalizeKazakhstanPhone('12345'), null);
});

test('staff WhatsApp login issues a scoped one-time code and never grants owner', async () => {
  const configPath = require.resolve('../src/config/supabase');
  const otpPath = require.resolve('../src/services/otpStore.service');
  const whatsappPath = require.resolve('../src/utils/whatsapp.util');
  const servicePath = require.resolve('../src/services/admin-phone-auth.service');
  const paths = [configPath, otpPath, whatsappPath, servicePath];
  const previous = new Map(paths.map((modulePath) => [modulePath, require.cache[modulePath]]));

  const database = {
    admin_user_profiles: new Map([
      [
        '+77001234567',
        {
          username: '+77001234567',
          role: 'operator',
          branch_ids: ['11111111-1111-4111-8111-111111111111'],
          active: true,
        },
      ],
      [
        '+77007654321',
        { username: '+77007654321', role: 'owner', branch_ids: [], active: true },
      ],
    ]),
    whatsapp_sessions: new Map(),
  };
  const supabase = { from: (table) => new FakeQuery(database, table) };
  const otpRows = new Map();
  const otpStore = {
    set: async (key, value) => otpRows.set(key, structuredClone(value)),
    get: async (key) => structuredClone(otpRows.get(key) || null),
    consume: async (key, code) => {
      const value = otpRows.get(key);
      if (!value) return { status: 'expired' };
      if (value.code !== code) return { status: 'invalid' };
      otpRows.delete(key);
      return { status: 'success' };
    },
  };
  let requestToken = '';

  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { supabase },
  };
  require.cache[otpPath] = {
    id: otpPath,
    filename: otpPath,
    loaded: true,
    exports: otpStore,
  };
  require.cache[whatsappPath] = {
    id: whatsappPath,
    filename: whatsappPath,
    loaded: true,
    exports: {
      buildWhatsAppContact: (token) => {
        requestToken = token;
        return { whatsappPhone: '77008317499', whatsappUrl: `https://wa.me/test?text=${token}` };
      },
    },
  };
  delete require.cache[servicePath];

  try {
    const {
      consumeAdminBotRequest,
      requestAdminPhoneLogin,
      verifyAdminPhoneLogin,
    } = require('../src/services/admin-phone-auth.service');

    const challenge = await requestAdminPhoneLogin('8 700 123 45 67');
    assert.equal(challenge.accepted, true);
    assert.equal(database.whatsapp_sessions.has(`token_${requestToken}`), true);

    assert.deepEqual(await consumeAdminBotRequest(requestToken, '77009999999'), {
      status: 'phone_mismatch',
    });
    const issued = await consumeAdminBotRequest(requestToken, '77001234567');
    assert.equal(issued.status, 'success');
    assert.match(issued.code, /^\d{6}$/);
    assert.equal(otpRows.has('admin_login:+77001234567'), true);

    assert.deepEqual(await verifyAdminPhoneLogin('+7 700 123 45 67', issued.code), {
      username: '+77001234567',
      role: 'operator',
      branchIds: ['11111111-1111-4111-8111-111111111111'],
    });
    await assert.rejects(
      verifyAdminPhoneLogin('+7 700 123 45 67', issued.code),
      /Код истёк/,
    );

    database.whatsapp_sessions.clear();
    await requestAdminPhoneLogin('+7 700 765 43 21');
    assert.equal(database.whatsapp_sessions.size, 0);
  } finally {
    delete require.cache[servicePath];
    for (const modulePath of [configPath, otpPath, whatsappPath]) {
      const cached = previous.get(modulePath);
      if (cached) require.cache[modulePath] = cached;
      else delete require.cache[modulePath];
    }
  }
});

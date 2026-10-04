const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const bcrypt = require('bcryptjs');
const { PGlite } = require('@electric-sql/pglite');
const {
  completeCustomerPasswordResetLink,
  startCustomerPasswordResetLink,
  validateCustomerPasswordResetLink,
} = require('../src/services/customer-password-reset-link.service');
const {
  autocallProviderConfig,
  sendAutocallSms,
} = require('../src/services/customer-otp-provider.service');

const pg = new PGlite();
const phone = '+77001234567';
const customerId = '11111111-1111-4111-8111-111111111111';
const env = {
  AUTOCALL_API_TOKEN: 'autocall-test-only-placeholder',
  CUSTOMER_PASSWORD_BCRYPT_ROUNDS: '10',
};
const argsFor = {
  reserve_customer_password_reset_link: [
    'p_phone',
    'p_digest',
    'p_flow_id',
    'p_customer_id',
    'p_daily_limit',
  ],
  complete_customer_password_reset_link_delivery: ['p_phone', 'p_digest', 'p_flow_id', 'p_success'],
  validate_customer_password_reset_link: ['p_digest'],
  consume_customer_password_reset_link: ['p_digest', 'p_password_hash'],
  reserve_customer_otp: ['p_phone', 'p_digest', 'p_payload', 'p_daily_limit'],
};
const db = {
  async rpc(name, args) {
    const names = argsFor[name];
    assert.ok(names, `Unexpected RPC ${name}`);
    const params = names.map((key) =>
      key === 'p_payload' ? JSON.stringify(args[key]) : args[key],
    );
    const result = await pg.query(
      `select public.${name}(${names.map((_, i) => `$${i + 1}`).join(',')}) as result`,
      params,
    );
    return { data: result.rows[0].result, error: null };
  },
  from(table) {
    assert.equal(table, 'customer_credentials');
    return {
      select: () => ({
        eq: (_column, id) => ({
          maybeSingle: async () => ({
            data:
              (await pg.query('select * from customer_credentials where customer_id=$1', [id]))
                .rows[0] || null,
            error: null,
          }),
        }),
      }),
    };
  },
};
const findCustomer = async (number) =>
  (await pg.query('select * from customers where phone=$1', [number])).rows[0] || null;
const dependencies = { db, env, findCustomer };
const tokenFrom = (message) => new URL(message.variables.reset_url).hash.slice('#reset='.length);
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const send = async (number = phone, overrides = {}) => {
  let message;
  const result = await startCustomerPasswordResetLink(
    { phone: number, requestToken: 'RecoveryToken23456' },
    {
      ...dependencies,
      sendSms: async (value) => {
        message = value;
        return { messageId: 'accepted' };
      },
      ...overrides,
    },
  );
  return { result, message, token: tokenFrom(message) };
};
async function customer({ credential = true, name = 'Алия' } = {}) {
  await pg.query('insert into customers(id,phone,name) values($1,$2,$3)', [
    customerId,
    phone,
    name,
  ]);
  if (credential)
    await pg.query('insert into customer_credentials(customer_id,password_hash) values($1,$2)', [
      customerId,
      await bcrypt.hash('OldPass2026', 10),
    ]);
}

test.before(async () => {
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table public.customers(id uuid primary key,phone text,name text);
    create table public.customer_refresh_tokens(id text primary key,customer_id uuid,revoked_at timestamptz);
    create table public.whatsapp_sessions(id text primary key,data jsonb,expires_at timestamptz,updated_at timestamptz default now());`);
  for (const file of [
    '20260722223000_customer_password_auth.sql',
    '20261002150000_automatic_customer_otp.sql',
    '20261004001000_customer_password_reset_links.sql',
  ]) {
    await pg.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
});
test.beforeEach(() =>
  pg.exec(
    'delete from customer_password_reset_links; delete from customer_credentials; delete from customer_refresh_tokens; delete from customers; delete from customer_otp_send_limits; delete from whatsapp_sessions;',
  ),
);
test.after(() => pg.close());

test('known and unknown recovery return identical metadata and persist only token hashes for15minutes', async () => {
  await customer();
  const known = await send();
  const unknown = await send('+77001234568');
  assert.deepEqual(known.result, unknown.result);
  assert.deepEqual(known.result, {
    deliveryMode: 'sms_link',
    channel: 'sms',
    expiresInSeconds: 900,
    retryAfterSeconds: 60,
  });
  for (const attempt of [known, unknown]) {
    assert.match(attempt.token, /^[a-f0-9]{64}$/);
    assert.equal(attempt.message.text, 'Bulka: Novyi parol: {{reset_url}} (15 min)');
    assert.equal(attempt.message.config.provider, 'autocall_sms');
    assert.equal(JSON.stringify(attempt.result).includes(attempt.token), false);
    const row = (
      await pg.query('select * from customer_password_reset_links where phone=$1', [
        attempt.message.phone,
      ])
    ).rows[0];
    assert.equal(row.token_digest, hash(attempt.token));
    assert.equal(JSON.stringify(row).includes(attempt.token), false);
    assert.equal(row.delivery_state, 'accepted');
    const remaining = new Date(row.expires_at).getTime() - Date.now();
    assert.ok(remaining > 899000 && remaining <= 900000);
  }
  assert.deepEqual(
    await validateCustomerPasswordResetLink({ resetToken: known.token }, dependencies),
    { success: true },
  );
  await assert.rejects(
    validateCustomerPasswordResetLink({ resetToken: unknown.token }, dependencies),
    { code: 'PASSWORD_RESET_LINK_INVALID' },
  );
  assert.equal((await pg.query('select count(*)::int as n from whatsapp_sessions')).rows[0].n, 0);
});

test('completion consumes link and atomically changes password/version and revokes all old refresh sessions', async () => {
  await customer();
  await pg.query('insert into customer_refresh_tokens(id,customer_id) values($1,$2),($3,$2)', [
    'old1',
    customerId,
    'old2',
  ]);
  const { token } = await send();
  assert.deepEqual(
    await completeCustomerPasswordResetLink(
      { resetToken: token, password: 'NewPass2026' },
      dependencies,
    ),
    { success: true },
  );
  const credential = (await pg.query('select * from customer_credentials')).rows[0];
  assert.equal(credential.auth_version, 2);
  assert.equal(await bcrypt.compare('NewPass2026', credential.password_hash), true);
  assert.ok(
    (await pg.query('select revoked_at from customer_refresh_tokens')).rows.every(
      (row) => row.revoked_at,
    ),
  );
  await assert.rejects(
    completeCustomerPasswordResetLink(
      { resetToken: token, password: 'OtherPass2026' },
      dependencies,
    ),
    { code: 'PASSWORD_RESET_LINK_INVALID' },
  );
  assert.equal(
    (await pg.query('select count(*)::int as n from customer_password_reset_links')).rows[0].n,
    0,
  );
});

test('concurrent completion succeeds once and legacy established customers can set their first password', async () => {
  await customer({ credential: false });
  const { token } = await send();
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      completeCustomerPasswordResetLink(
        { resetToken: token, password: 'FirstPass2026' },
        dependencies,
      ),
    ),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    results.find((r) => r.status === 'rejected').reason.code,
    'PASSWORD_RESET_LINK_INVALID',
  );
  assert.equal(
    (await pg.query('select auth_version from customer_credentials')).rows[0].auth_version,
    1,
  );
});

test('expired, pending, malformed, wrong or stale-version links fail uniformly without changing credentials', async () => {
  await customer();
  const { token } = await send();
  for (const invalid of ['', token.slice(1), 'f'.repeat(64)]) {
    await assert.rejects(validateCustomerPasswordResetLink({ resetToken: invalid }, dependencies), {
      code: 'PASSWORD_RESET_LINK_INVALID',
    });
  }
  await assert.rejects(
    completeCustomerPasswordResetLink({ resetToken: token, password: 'weak' }, dependencies),
    { code: 'INVALID_PASSWORD' },
  );
  assert.deepEqual(await validateCustomerPasswordResetLink({ resetToken: token }, dependencies), {
    success: true,
  });
  for (const update of [
    "delivery_state='pending'",
    "delivery_state='accepted',expires_at=now()-interval '1 second'",
  ]) {
    await pg.exec(`update customer_password_reset_links set ${update};`);
    await assert.rejects(
      completeCustomerPasswordResetLink(
        { resetToken: token, password: 'NewPass2026' },
        dependencies,
      ),
      { code: 'PASSWORD_RESET_LINK_INVALID' },
    );
  }
  await pg.exec(
    "update customer_password_reset_links set expires_at=now()+interval '15 minutes';update customer_credentials set auth_version=2;",
  );
  await assert.rejects(validateCustomerPasswordResetLink({ resetToken: token }, dependencies), {
    code: 'PASSWORD_RESET_LINK_INVALID',
  });
  assert.equal(
    await bcrypt.compare(
      'OldPass2026',
      (await pg.query('select password_hash from customer_credentials')).rows[0].password_hash,
    ),
    true,
  );
});

test('failed delivery removes its token without leaking secrets and retains shared OTP send limits', async () => {
  await customer();
  let token;
  await assert.rejects(
    send(phone, {
      sendSms: async (message) => {
        token = tokenFrom(message);
        throw new Error(`${token} ${message.config.token}`);
      },
    }),
    (error) => {
      assert.equal(error.code, 'PASSWORD_RESET_LINK_UNAVAILABLE');
      assert.equal(
        `${error.message} ${error.stack} ${JSON.stringify(error)}`.includes(token),
        false,
      );
      return true;
    },
  );
  assert.equal(
    (await pg.query('select count(*)::int as n from customer_password_reset_links')).rows[0].n,
    0,
  );
  await assert.rejects(send(), { code: 'PASSWORD_RESET_RATE_LIMITED' });
  const otp = await db.rpc('reserve_customer_otp', {
    p_phone: phone,
    p_digest: 'a'.repeat(64),
    p_payload: { flowId: 'RegisterToken23456', purpose: 'customer_registration' },
    p_daily_limit: 1000,
  });
  assert.equal(otp.data.status, 'rate_limited');
});

test('resend invalidates previous link and late completion cannot delete or activate its replacement', async () => {
  await customer();
  const first = await send();
  await pg.exec("update customer_otp_send_limits set last_sent_at=now()-interval '61 seconds';");
  const second = await send();
  await assert.rejects(
    validateCustomerPasswordResetLink({ resetToken: first.token }, dependencies),
    { code: 'PASSWORD_RESET_LINK_INVALID' },
  );
  assert.equal(
    (
      await db.rpc('complete_customer_password_reset_link_delivery', {
        p_phone: phone,
        p_digest: hash(first.token),
        p_flow_id: 'RecoveryToken23456',
        p_success: false,
      })
    ).data,
    false,
  );
  assert.deepEqual(
    await validateCustomerPasswordResetLink({ resetToken: second.token }, dependencies),
    { success: true },
  );
});

test('shared hourly, daily and global limits block recovery before any paid send', async () => {
  await customer();
  for (const [scope, update, limit] of [
    [`phone:${phone}`, 'hour_count=5', '1000'],
    [`phone:${phone}`, 'day_count=10', '1000'],
    ['global', 'day_count=1', '1'],
  ]) {
    await pg.exec(
      'delete from customer_password_reset_links; delete from customer_otp_send_limits;',
    );
    await send();
    await pg.query(
      `update customer_otp_send_limits set last_sent_at=now()-interval '61 seconds', ${update} where scope=$1`,
      [scope],
    );
    // Release cooldown independently; the appropriate calendar quota still blocks.
    await pg.exec("update customer_otp_send_limits set last_sent_at=now()-interval '61 seconds';");
    await assert.rejects(
      send(phone, {
        env: { ...env, CUSTOMER_OTP_DAILY_SEND_LIMIT: limit },
        sendSms: async () => assert.fail('A blocked reservation must not send SMS'),
      }),
      (error) => error.code === 'PASSWORD_RESET_RATE_LIMITED' && error.retryAfterSeconds > 0,
    );
  }
});

test('phone changes and placeholder profiles never grant password-reset authority', async () => {
  await customer();
  const { token } = await send();
  await pg.query('update customers set phone=$1 where id=$2', ['+77001234568', customerId]);
  for (const action of [
    () => validateCustomerPasswordResetLink({ resetToken: token }, dependencies),
    () =>
      completeCustomerPasswordResetLink(
        { resetToken: token, password: 'NewPass2026' },
        dependencies,
      ),
  ]) {
    await assert.rejects(action(), { code: 'PASSWORD_RESET_LINK_INVALID' });
  }
  await pg.exec(
    'delete from customer_credentials; delete from customers; delete from customer_otp_send_limits;',
  );
  await customer({ credential: false, name: 'Гость' });
  const placeholder = await send();
  assert.equal(
    (await pg.query('select customer_id from customer_password_reset_links')).rows[0].customer_id,
    null,
  );
  await assert.rejects(
    completeCustomerPasswordResetLink(
      { resetToken: placeholder.token, password: 'NewPass2026' },
      dependencies,
    ),
    { code: 'PASSWORD_RESET_LINK_INVALID' },
  );
  assert.equal(
    (await pg.query('select count(*)::int as n from customer_credentials')).rows[0].n,
    0,
  );
});

test('a failed password transaction preserves both the original credential and its usable link', async () => {
  await customer();
  const { token } = await send();
  await pg.exec(`create function reject_password_write() returns trigger language plpgsql as $$
    begin raise exception 'Synthetic password persistence failure'; end; $$;
    create trigger reject_password before update on customer_credentials
    for each row execute function reject_password_write();`);
  try {
    await assert.rejects(
      db.rpc('consume_customer_password_reset_link', {
        p_digest: hash(token),
        p_password_hash: await bcrypt.hash('NewPass2026', 10),
      }),
      /Synthetic password persistence failure/,
    );
    const credential = (await pg.query('select * from customer_credentials')).rows[0];
    assert.equal(credential.auth_version, 1);
    assert.equal(await bcrypt.compare('OldPass2026', credential.password_hash), true);
    assert.deepEqual(await validateCustomerPasswordResetLink({ resetToken: token }, dependencies), {
      success: true,
    });
  } finally {
    await pg.exec(
      'drop trigger reject_password on customer_credentials; drop function reject_password_write();',
    );
  }
});

test('AutoCall link template expands to one ASCII segment and keeps its secret URL in recipient variables', async () => {
  const resetUrl = `https://bulka.com.kz/reset-password#reset=${'a'.repeat(64)}`;
  const result = await sendAutocallSms(
    {
      phone,
      text: 'Bulka: Novyi parol: {{reset_url}} (15 min)',
      variables: { reset_url: resetUrl },
      name: 'Password reset',
      config: autocallProviderConfig(env),
    },
    {
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://autocall.kz/api/v1/bulks');
        const body = JSON.parse(options.body);
        assert.equal(body.text, 'Bulka: Novyi parol: {{reset_url}} (15 min)');
        assert.deepEqual(body.list_id, [{ number: phone, variables: { reset_url: resetUrl } }]);
        const rendered = body.text.replace('{{reset_url}}', resetUrl);
        assert.ok(rendered.length <= 160);
        assert.match(rendered, /^[\x20-\x7e]+$/);
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: 12345, status: 'running', segments: 1, recipients: 1 }),
        };
      },
    },
  );
  assert.deepEqual(result, { messageId: '12345' });
});

test('completed AutoCall delivery proves the exact reset URL and invalid templates never send', async () => {
  const resetUrl = `https://bulka.com.kz/reset-password#reset=${'a'.repeat(64)}`;
  const payload = {
    phone,
    text: 'Bulka: Novyi parol: {{reset_url}} (15 min)',
    variables: { reset_url: resetUrl },
    name: 'Password reset',
    config: autocallProviderConfig(env),
  };
  for (const variables of [{ reset_url: resetUrl }, { reset_url: `${resetUrl}b` }, null]) {
    const promise = sendAutocallSms(payload, {
      fetchImpl: async () => ({
        ok: true,
        status: 201,
        json: async () => ({
          id: 12345,
          status: 'completed',
          segments: 1,
          recipients: 1,
          text: payload.text,
          messages: {
            data: [{ id: 1, bulk_id: 12345, number: phone, status: 'delivered', variables }],
          },
        }),
      }),
    });
    if (variables?.reset_url === resetUrl) assert.deepEqual(await promise, { messageId: '12345' });
    else await assert.rejects(promise, { code: 'OTP_SEND_FAILED' });
  }
  for (const variables of [undefined, { reset_url: 'a'.repeat(160) }]) {
    await assert.rejects(
      sendAutocallSms(
        { ...payload, variables },
        {
          fetchImpl: async () => assert.fail('Missing or overlong variable must not send'),
        },
      ),
      { code: 'OTP_PROVIDER_UNAVAILABLE' },
    );
  }
});

test('password reset hash storage and every RPC are inaccessible to public clients', async () => {
  for (const role of ['anon', 'authenticated']) {
    const result = await pg.query(
      `select has_table_privilege($1,'customer_password_reset_links','SELECT') as readable,
      has_function_privilege($1,'reserve_customer_password_reset_link(text,text,text,uuid,integer)','EXECUTE') as reservable,
      has_function_privilege($1,'complete_customer_password_reset_link_delivery(text,text,text,boolean)','EXECUTE') as activatable,
      has_function_privilege($1,'validate_customer_password_reset_link(text)','EXECUTE') as validatable,
      has_function_privilege($1,'consume_customer_password_reset_link(text,text)','EXECUTE') as consumable`,
      [role],
    );
    assert.deepEqual(result.rows[0], {
      readable: false,
      reservable: false,
      activatable: false,
      validatable: false,
      consumable: false,
    });
  }
});

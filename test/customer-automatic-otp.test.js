const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { consumeCustomerOtp, startCustomerOtp } = require('../src/services/customer-otp.service');
const {
  otpProviderConfig,
  sendAutomaticOtp,
} = require('../src/services/customer-otp-provider.service');
const { customerOtpDigest } = require('../src/utils/customer-otp.util');
const {
  customerOtpRequestBodySchema,
  customerOtpVerifyBodySchema,
  customerRegistrationStartBodySchema,
  customerPasswordResetStartBodySchema,
} = require('../src/contracts/legacy-api.contract');

const env = {
  CUSTOMER_OTP_PROVIDER: 'whatsapp_cloud',
  WHATSAPP_CLOUD_API_VERSION: 'v20.0',
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: '123456789012345',
  WHATSAPP_CLOUD_ACCESS_TOKEN: 'test-only-placeholder',
  WHATSAPP_AUTH_TEMPLATE_NAME: 'bulka_verification',
};
const ycloudEnv = {
  CUSTOMER_OTP_PROVIDER: 'ycloud_whatsapp',
  YCLOUD_API_KEY: 'ycloud-test-only-placeholder',
  YCLOUD_WHATSAPP_SENDER: '+77008317499',
  WHATSAPP_AUTH_TEMPLATE_NAME: 'bulka_verification',
};
const phone = '+77001234567';
const request = {
  phone,
  requestToken: 'Registration23456',
  purpose: 'customer_registration',
  passwordHash: 'purpose-bound-test-password-hash',
  automaticOtpSupported: true,
};
const pg = new PGlite();
const rpcArgs = {
  reserve_customer_otp: ['p_phone', 'p_digest', 'p_payload', 'p_daily_limit'],
  complete_customer_otp_delivery: ['p_phone', 'p_flow_id', 'p_digest', 'p_success', 'p_message_id'],
  consume_customer_otp: ['p_phone', 'p_code', 'p_digest'],
};
const db = {
  async rpc(name, args) {
    const names = rpcArgs[name];
    assert.ok(names, `Unexpected RPC: ${name}`);
    const params = names.map((key) =>
      key === 'p_payload' ? JSON.stringify(args[key]) : args[key],
    );
    const result = await pg.query(
      `select public.${name}(${names.map((_, i) => `$${i + 1}`).join(',')}) as result`,
      params,
    );
    return { data: result.rows[0].result, error: null };
  },
};

test.before(async () => {
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table public.whatsapp_sessions (
      id text primary key, data jsonb not null, expires_at timestamptz,
      updated_at timestamptz default now()
    );`);
  await pg.exec(
    readFileSync('supabase/migrations/20261002150000_automatic_customer_otp.sql', 'utf8'),
  );
});
test.beforeEach(async () => {
  await pg.exec('delete from customer_otp_send_limits; delete from whatsapp_sessions;');
});
test.after(() => pg.close());

test('old clients retain four-digit bot confirmation while automatic delivery is enabled', async () => {
  let session;
  const legacyDb = {
    from(table) {
      assert.equal(table, 'whatsapp_sessions');
      return {
        delete: () => ({ lt: async () => ({ error: null }) }),
        upsert: async (value) => {
          session = value;
          return { error: null };
        },
      };
    },
  };
  const result = await startCustomerOtp(
    { ...request, automaticOtpSupported: undefined },
    {
      db: legacyDb,
      env,
      sendOtp: async () => assert.fail('An old client must not receive an unusable six-digit code'),
    },
  );
  assert.equal(result.deliveryMode, 'manual');
  assert.equal(result.codeLength, 4);
  assert.match(result.whatsappUrl, /^https:\/\/wa\.me\//);
  assert.equal(session.id, `token_${request.requestToken}`);
  assert.equal(session.data.purpose, request.purpose);
  assert.equal(session.data.passwordHash, request.passwordHash);
  assert.equal((await pg.query('select * from customer_otp_send_limits')).rows.length, 0);
});

test('all OTP start contracts accept old clients and only the supported delivery version', () => {
  const body = { phone, token: request.requestToken };
  for (const [schema, values] of [
    [customerOtpRequestBodySchema, body],
    [customerPasswordResetStartBodySchema, body],
    [customerRegistrationStartBodySchema, { ...body, password: 'Register2026' }],
  ]) {
    assert.equal(schema.parse(values).otpDeliveryVersion, undefined);
    assert.equal(schema.parse({ ...values, otpDeliveryVersion: 2 }).otpDeliveryVersion, 2);
    for (const version of [0, 1, 3, '2', true]) {
      assert.equal(schema.safeParse({ ...values, otpDeliveryVersion: version }).success, false);
    }
  }
});

test('WhatsApp Cloud sends the approved authentication template without exposing credentials', async () => {
  const config = otpProviderConfig(env);
  const result = await sendAutomaticOtp(
    { phone, code: '123456', config },
    {
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://graph.facebook.com/v20.0/123456789012345/messages');
        assert.equal(new URL(url).search, '');
        assert.equal(options.method, 'POST');
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.Authorization, `Bearer ${config.token}`);
        const body = JSON.parse(options.body);
        assert.equal(body.to, '77001234567');
        assert.equal(body.type, 'template');
        assert.equal(body.template.name, 'bulka_verification');
        assert.equal(body.template.language.code, 'ru');
        assert.equal(body.template.components[0].parameters[0].text, '123456');
        assert.equal(body.template.components[1].sub_type, 'url');
        assert.equal(body.template.components[1].parameters[0].text, '123456');
        return { ok: true, json: async () => ({ messages: [{ id: 'wamid.accepted' }] }) };
      },
    },
  );
  assert.deepEqual(result, { messageId: 'wamid.accepted' });
});

test('Mobizon uses a registered sender and keeps the API key out of URLs', async () => {
  const config = otpProviderConfig({
    CUSTOMER_OTP_PROVIDER: 'mobizon_sms',
    MOBIZON_API_KEY: 'sms-test-placeholder',
    MOBIZON_SMS_SENDER: 'BULKA',
  });
  const result = await sendAutomaticOtp(
    { phone, code: '123456', config },
    {
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://api.mobizon.kz/service/Message/SendSmsMessage');
        assert.equal(new URL(url).search, '');
        const form = new URLSearchParams(options.body);
        assert.equal(form.get('apiKey'), config.apiKey);
        assert.equal(form.get('recipient'), '77001234567');
        assert.equal(form.get('from'), 'BULKA');
        assert.match(form.get('text'), /123456/);
        assert.ok(form.get('text').length <= 70, 'OTP fits one Cyrillic SMS segment');
        return { ok: true, json: async () => ({ code: 0, data: { messageId: 'sms-1' } }) };
      },
    },
  );
  assert.equal(result.messageId, 'sms-1');
});

test('YCloud submits the OTP synchronously with E.164 phones and matching code button', async () => {
  const config = otpProviderConfig(ycloudEnv);
  const result = await sendAutomaticOtp(
    { phone, code: '123456', config },
    {
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly');
        assert.equal(new URL(url).search, '');
        assert.equal(options.method, 'POST');
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers['X-API-Key'], config.apiKey);
        const body = JSON.parse(options.body);
        assert.equal(body.from, '+77008317499');
        assert.equal(body.to, phone);
        assert.equal(body.type, 'template');
        assert.equal(body.template.name, 'bulka_verification');
        assert.deepEqual(body.template.language, { code: 'ru', policy: 'deterministic' });
        assert.equal(body.template.components[0].parameters[0].text, '123456');
        assert.equal(body.template.components[1].parameters[0].text, '123456');
        assert.equal(body.template.components[1].sub_type, 'url');
        assert.equal(
          body.useDirectSend,
          undefined,
          'Use the approved template, not template bypass',
        );
        return { ok: true, json: async () => ({ id: 'ycloud-accepted', status: 'sent' }) };
      },
    },
  );
  assert.deepEqual(result, { messageId: 'ycloud-accepted' });
});

test('YCloud rejects failed sends and incomplete configuration without leaking details', async () => {
  for (const body of [
    { id: 'rejected', status: 'failed', errorMessage: '123456 sensitive' },
    { id: 'rejected', status: 'deleted' },
    { id: 'rejected', error: { message: '123456 sensitive' } },
    { id: { malformed: '123456 sensitive' }, status: 'sent' },
    { id: '   ', status: 'sent' },
    { status: 'sent' },
  ]) {
    await assert.rejects(
      sendAutomaticOtp(
        { phone, code: '123456', config: otpProviderConfig(ycloudEnv) },
        { fetchImpl: async () => ({ ok: true, json: async () => body }) },
      ),
      (error) => error.code === 'OTP_SEND_FAILED' && !JSON.stringify(error).includes('sensitive'),
    );
  }
  for (const overrides of [
    { YCLOUD_API_KEY: '' },
    { YCLOUD_WHATSAPP_SENDER: '77008317499' },
    { YCLOUD_WHATSAPP_SENDER: '+79991234567' },
    { WHATSAPP_AUTH_TEMPLATE_NAME: '' },
    { WHATSAPP_AUTH_TEMPLATE_LANGUAGE: 'not-a-language' },
  ]) {
    assert.throws(() => otpProviderConfig({ ...ycloudEnv, ...overrides }), {
      code: 'OTP_PROVIDER_UNAVAILABLE',
    });
  }
});

test('YCloud confirmation is reported as WhatsApp and a failed delivery never activates the code', async () => {
  let code;
  const result = await startCustomerOtp(request, {
    db,
    env: ycloudEnv,
    sendOtp: async (message) => {
      code = message.code;
      return { messageId: 'ycloud-accepted' };
    },
  });
  assert.equal(result.channel, 'whatsapp');
  assert.equal(result.deliveryMode, 'automatic');
  assert.equal(result.whatsappUrl, null);
  assert.equal((await consumeCustomerOtp(phone, code, { db, env: ycloudEnv })).status, 'success');
  await assert.rejects(startCustomerOtp(request, { db, env: ycloudEnv }), {
    code: 'OTP_RATE_LIMITED',
  });
  await pg.exec(
    "update customer_otp_send_limits set last_sent_at = now() - interval '61 seconds';",
  );
  await assert.rejects(
    startCustomerOtp(request, {
      db,
      env: ycloudEnv,
      sendOtp: async (message) => {
        code = message.code;
        throw new Error('provider unavailable');
      },
    }),
    { code: 'OTP_SEND_FAILED' },
  );
  assert.equal((await consumeCustomerOtp(phone, code, { db, env: ycloudEnv })).status, 'expired');
});

test('provider rejection, timeout and missing configuration fail closed', async () => {
  for (const fetchImpl of [
    async () => ({ ok: false, json: async () => ({ error: { message: '123456 sensitive' } }) }),
    async () => ({ ok: true, json: async () => ({ code: 8 }) }),
    async () => {
      throw new Error('timeout containing sensitive details');
    },
  ]) {
    await assert.rejects(
      sendAutomaticOtp({ phone, code: '123456', config: otpProviderConfig(env) }, { fetchImpl }),
      (error) => error.code === 'OTP_SEND_FAILED' && !JSON.stringify(error).includes('sensitive'),
    );
  }
  assert.throws(() => otpProviderConfig({ CUSTOMER_OTP_PROVIDER: 'whatsapp_cloud' }), {
    code: 'OTP_PROVIDER_UNAVAILABLE',
  });
  assert.throws(() => otpProviderConfig({ CUSTOMER_OTP_PROVIDER: 'unknown' }), {
    code: 'OTP_PROVIDER_UNAVAILABLE',
  });
  let called = false;
  await assert.rejects(
    startCustomerOtp(request, {
      db,
      env: { CUSTOMER_OTP_PROVIDER: 'whatsapp_cloud' },
      sendOtp: async () => {
        called = true;
      },
    }),
    { code: 'OTP_PROVIDER_UNAVAILABLE' },
  );
  assert.equal(called, false);
  assert.equal((await pg.query('select * from customer_otp_send_limits')).rows.length, 0);
});

test('automatic OTP persists only a digest, preserves registration purpose and consumes once', async () => {
  let code;
  const result = await startCustomerOtp(request, {
    db,
    env,
    sendOtp: async (message) => {
      code = message.code;
      assert.match(code, /^\d{6}$/);
      assert.equal((await consumeCustomerOtp(phone, code, { db, env })).status, 'invalid');
      return { messageId: 'accepted-1' };
    },
  });
  assert.equal(result.deliveryMode, 'automatic');
  assert.equal(result.channel, 'whatsapp');
  assert.equal(result.codeLength, 6);
  assert.equal(result.whatsappUrl, null);
  assert.equal(result.retryAfterSeconds, 60);
  assert.equal(result.expiresInSeconds, 300);
  assert.equal(JSON.stringify(result).includes(code), false);
  const row = (await pg.query('select * from whatsapp_sessions')).rows[0];
  assert.equal(row.id, `otp_${phone}`);
  assert.equal(row.data.code, undefined);
  assert.equal(row.data.codeDigest, customerOtpDigest(phone, code));
  assert.equal(row.data.attempts, 0);
  const remaining = new Date(row.expires_at).getTime() - Date.now();
  assert.ok(remaining > 295000 && remaining <= 300000);
  const verified = await consumeCustomerOtp(phone, code, { db, env });
  assert.equal(verified.status, 'success');
  assert.equal(verified.payload.purpose, request.purpose);
  assert.equal(verified.payload.passwordHash, request.passwordHash);
  assert.equal(verified.payload.codeDigest, undefined);
  assert.equal(verified.payload.providerMessageId, undefined);
  assert.equal((await consumeCustomerOtp(phone, code, { db, env })).status, 'expired');
  assert.equal((await pg.query('select * from customer_otp_send_limits')).rows.length, 2);
});

test('concurrent sends and code verification produce one send and one success', async () => {
  let sends = 0;
  let code;
  const sendOtp = async (message) => {
    sends += 1;
    code = message.code;
    return { messageId: 'accepted-concurrent' };
  };
  const starts = await Promise.allSettled([
    startCustomerOtp(request, { db, env, sendOtp }),
    startCustomerOtp({ ...request, requestToken: 'DifferentToken23456' }, { db, env, sendOtp }),
  ]);
  assert.equal(sends, 1);
  assert.equal(starts.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(starts.find((r) => r.status === 'rejected').reason.code, 'OTP_RATE_LIMITED');
  const results = await Promise.all([
    consumeCustomerOtp(phone, code, { db, env }),
    consumeCustomerOtp(phone, code, { db, env }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['expired', 'success']);
});

test('expired codes and five wrong attempts cannot confirm a number', async () => {
  let code;
  const sendOtp = async (message) => {
    code = message.code;
    return { messageId: 'accepted' };
  };
  await startCustomerOtp(request, { db, env, sendOtp });
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 1; i <= 5; i += 1) {
    const result = await consumeCustomerOtp(phone, wrong, { db, env });
    assert.equal(result.status, i === 5 ? 'attempts_exceeded' : 'invalid');
  }
  assert.equal((await consumeCustomerOtp(phone, code, { db, env })).status, 'expired');
  await pg.exec(
    "update customer_otp_send_limits set last_sent_at = now() - interval '61 seconds';",
  );
  await startCustomerOtp(request, { db, env, sendOtp });
  await pg.exec("update whatsapp_sessions set expires_at = now() - interval '1 second';");
  assert.equal((await consumeCustomerOtp(phone, code, { db, env })).status, 'expired');
});

test('failed sends remove pending codes but retain anti-abuse limits', async () => {
  let code;
  await assert.rejects(
    startCustomerOtp(request, {
      db,
      env,
      sendOtp: async (message) => {
        code = message.code;
        throw new Error('delivery failed');
      },
    }),
    { code: 'OTP_SEND_FAILED' },
  );
  assert.equal((await pg.query('select * from whatsapp_sessions')).rows.length, 0);
  assert.equal((await consumeCustomerOtp(phone, code, { db, env })).status, 'expired');
  await assert.rejects(startCustomerOtp(request, { db, env }), { code: 'OTP_RATE_LIMITED' });
});

test('hour, day and global limits persist beyond consuming codes', async () => {
  const sendOtp = async () => ({ messageId: 'accepted' });
  await startCustomerOtp(request, { db, env, sendOtp });
  await pg.exec(
    "update customer_otp_send_limits set last_sent_at = now() - interval '61 seconds';",
  );
  await pg.exec("update customer_otp_send_limits set hour_count = 5 where scope like 'phone:%';");
  await assert.rejects(startCustomerOtp(request, { db, env, sendOtp }), {
    code: 'OTP_RATE_LIMITED',
  });
  await pg.exec(
    "update customer_otp_send_limits set hour_count = 0, day_count = 10 where scope like 'phone:%';",
  );
  await assert.rejects(startCustomerOtp(request, { db, env, sendOtp }), {
    code: 'OTP_RATE_LIMITED',
  });
  await assert.rejects(
    startCustomerOtp(
      { ...request, phone: '+77019998877' },
      {
        db,
        env: { ...env, CUSTOMER_OTP_DAILY_SEND_LIMIT: 1 },
        sendOtp,
      },
    ),
    { code: 'OTP_RATE_LIMITED' },
  );
  await pg.exec(
    "update customer_otp_send_limits set day_started_at = now() - interval '1 day', hour_started_at = now() - interval '1 hour';",
  );
  assert.equal((await startCustomerOtp(request, { db, env, sendOtp })).deliveryMode, 'automatic');
});

test('late completion from an older send cannot delete or activate the replacement code', async () => {
  const old = {
    p_phone: phone,
    p_flow_id: request.requestToken,
    p_digest: customerOtpDigest(phone, '111111'),
  };
  const reserve = (token, code) =>
    db.rpc('reserve_customer_otp', {
      p_phone: phone,
      p_digest: customerOtpDigest(phone, code),
      p_payload: { ...request, flowId: token },
      p_daily_limit: 1000,
    });
  await reserve(request.requestToken, '111111');
  await pg.exec(
    "update customer_otp_send_limits set last_sent_at = now() - interval '61 seconds';",
  );
  await reserve('ReplacementToken234', '222222');
  assert.equal(
    (
      await db.rpc('complete_customer_otp_delivery', {
        ...old,
        p_success: true,
        p_message_id: 'old',
      })
    ).data,
    false,
  );
  assert.equal(
    (
      await db.rpc('complete_customer_otp_delivery', {
        ...old,
        p_success: false,
        p_message_id: null,
      })
    ).data,
    false,
  );
  assert.equal(
    (await pg.query('select data from whatsapp_sessions')).rows[0].data.flowId,
    'ReplacementToken234',
  );
});

test('legacy four-digit object and string OTP records still work', async () => {
  for (const asString of [false, true]) {
    const payload = {
      code: '1234',
      attempts: 0,
      purpose: 'customer_password_reset',
      flowId: 'LegacyToken23456',
    };
    await pg.query(
      "insert into whatsapp_sessions(id,data,expires_at) values($1,$2,now()+interval '5 minutes')",
      [`otp_${phone}`, JSON.stringify(asString ? JSON.stringify(payload) : payload)],
    );
    const result = await consumeCustomerOtp(phone, '1234', { db });
    assert.equal(result.status, 'success');
    assert.equal(result.payload.purpose, 'customer_password_reset');
    assert.equal(result.payload.code, undefined);
  }
});

test('old RPC fallback is allowed only before migration and only in legacy mode', async () => {
  const calls = [];
  const client = {
    async rpc(name) {
      calls.push(name);
      return name === 'consume_customer_otp'
        ? { data: null, error: { code: 'PGRST202' } }
        : { data: { status: 'success', payload: {} }, error: null };
    },
  };
  assert.equal(
    (await consumeCustomerOtp(phone, '1234', { db: client, env: {} })).status,
    'success',
  );
  assert.deepEqual(calls, ['consume_customer_otp', 'consume_whatsapp_otp']);
  calls.length = 0;
  await assert.rejects(consumeCustomerOtp(phone, '123456', { db: client, env }));
  assert.deepEqual(calls, ['consume_customer_otp']);
});

test('missing expiry is rejected and non-Kazakhstan recipients cannot spend sending quota', async () => {
  await pg.query('insert into whatsapp_sessions(id,data,expires_at) values($1,$2,null)', [
    `otp_${phone}`,
    JSON.stringify({ code: '1234', attempts: 0 }),
  ]);
  assert.equal((await consumeCustomerOtp(phone, '1234', { db })).status, 'expired');
  let sent = false;
  await assert.rejects(
    startCustomerOtp(
      { ...request, phone: '+79991234567' },
      {
        db,
        env,
        sendOtp: async () => {
          sent = true;
          return { messageId: 'not-expected' };
        },
      },
    ),
    { code: 'OTP_INVALID_PHONE' },
  );
  assert.equal(sent, false);
  assert.equal((await pg.query('select * from customer_otp_send_limits')).rows.length, 0);
});

test('OTP storage functions are inaccessible to public clients', async () => {
  for (const role of ['anon', 'authenticated']) {
    const privileges = await pg.query(
      `select
      has_table_privilege($1, 'customer_otp_send_limits', 'SELECT') as readable,
      has_function_privilege($1, 'reserve_customer_otp(text,text,jsonb,integer)', 'EXECUTE') as issuable,
      has_function_privilege($1, 'consume_customer_otp(text,text,text)', 'EXECUTE') as verifiable`,
      [role],
    );
    assert.deepEqual(privileges.rows[0], { readable: false, issuable: false, verifiable: false });
  }
  assert.equal(customerOtpVerifyBodySchema.safeParse({ phone, code: '123456' }).success, true);
  assert.equal(customerOtpVerifyBodySchema.safeParse({ phone, code: '1234' }).success, true);
  assert.equal(customerOtpVerifyBodySchema.safeParse({ phone, code: '12345' }).success, false);
});

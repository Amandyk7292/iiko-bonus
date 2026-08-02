const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const servicePath = require.resolve('../src/services/legal-consent.service');
const supabasePath = require.resolve('../src/config/supabase');

test('registration consent requires current documents and records canonical hashes', async (t) => {
  const calls = [];
  const previousSupabase = require.cache[supabasePath];
  const previousService = require.cache[servicePath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: {
      supabase: {
        rpc: async (name, values) => {
          calls.push([name, values]);
          return { data: 'consent-id', error: null };
        },
      },
    },
  };
  delete require.cache[servicePath];
  t.after(() => {
    if (previousSupabase) require.cache[supabasePath] = previousSupabase;
    else delete require.cache[supabasePath];
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });
  const { canonicalLegalDocuments, recordCustomerLegalConsent, validateLegalConsent } = require(
    servicePath,
  );

  assert.throws(
    () => validateLegalConsent({ acceptedLegal: false }),
    (error) => error.code === 'LEGAL_CONSENT_REQUIRED',
  );
  assert.throws(
    () =>
      validateLegalConsent({
        acceptedLegal: true,
        legalConsent: {
          offerVersion: 'old',
          privacyVersion: '2026-07-27',
          locale: 'ru',
          channel: 'android',
        },
      }),
    (error) => error.code === 'LEGAL_DOCUMENT_VERSION_CHANGED',
  );

  const canonical = canonicalLegalDocuments('kk');
  const consent = validateLegalConsent({
    acceptedLegal: true,
    legalConsent: {
      offerVersion: canonical.offerVersion,
      offerHash: canonical.offerHash,
      privacyVersion: canonical.privacyVersion,
      privacyHash: canonical.privacyHash,
      locale: 'kk',
      channel: 'android',
      acceptedAt: new Date().toISOString(),
    },
  });
  assert.match(consent.offerHash, /^[a-f0-9]{64}$/);
  assert.match(consent.privacyHash, /^[a-f0-9]{64}$/);
  await recordCustomerLegalConsent('11111111-1111-4111-8111-111111111111', consent);
  assert.equal(calls[0][0], 'record_customer_legal_consent');
  assert.equal(calls[0][1].p_offer_sha256, canonical.offerHash);
  assert.equal(calls[0][1].p_privacy_sha256, canonical.privacyHash);
});

test('registration route enforces consent before creating or updating the customer', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'legacy.routes.js'),
    'utf8',
  );
  const registration = source.slice(
    source.indexOf("'/api/auth/register',"),
    source.indexOf("router.post('/api/auth/refresh'"),
  );
  assert.ok(
    registration.indexOf('validateLegalConsent') < registration.indexOf('getCustomerByPhone'),
  );
  assert.ok(
    registration.indexOf('recordCustomerLegalConsent') < registration.indexOf("from('customers')"),
  );
});

test('legal consent and payment claims migration keeps audit tables service-only', () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260729150000_payment_creation_legal_consent_key_rotation.sql',
    ),
    'utf8',
  );
  assert.match(migration, /create table if not exists public\.customer_legal_consents/i);
  assert.match(migration, /create or replace function public\.record_customer_legal_consent/i);
  assert.doesNotMatch(
    migration.slice(
      migration.indexOf('create or replace function public.record_customer_legal_consent'),
    ),
    /do update set\s+locale/i,
  );
  assert.match(
    migration,
    /revoke all on table public\.customer_legal_consents from public, anon, authenticated/i,
  );
  assert.match(migration, /create table if not exists public\.payment_creation_claims/i);
  assert.match(migration, /create or replace function public\.claim_payment_creation/i);
});

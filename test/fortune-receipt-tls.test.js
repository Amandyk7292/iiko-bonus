const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tls = require('node:tls');
const {
  createFiscalHttpsAgent,
  OOFD_INTERMEDIATE_PEM,
} = require('../src/services/fortune-receipt-tls');
const knownTime = Date.parse('2026-10-12T17:00:00Z');
const base = { now: knownTime, defaultRoots: tls.rootCertificates, systemRoots: [] };

test('OOFD missing issuer completes the real leaf chain to an existing globally trusted root', () => {
  const leaf = new crypto.X509Certificate(
    fs.readFileSync(path.join(__dirname, 'fixtures/fortune-oofd-server-leaf.pem')),
  );
  const issuer = new crypto.X509Certificate(OOFD_INTERMEDIATE_PEM);
  assert.equal(leaf.checkHost('consumer.oofd.kz'), '*.oofd.kz');
  assert.equal(leaf.checkHost('attacker.example'), undefined);
  assert.equal(leaf.checkIssued(issuer), true);
  assert.equal(leaf.verify(issuer.publicKey), true);
  const agent = createFiscalHttpsAgent('oofd', base);
  const anchors = tls.rootCertificates
    .map((pem) => new crypto.X509Certificate(pem))
    .filter((root) => issuer.checkIssued(root) && issuer.verify(root.publicKey));
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].checkIssued(anchors[0]), true);
  assert.equal(anchors[0].verify(anchors[0].publicKey), true);
  assert.equal(agent.options.ca.length, tls.rootCertificates.length + 1);
  assert.equal(agent.options.ca.at(-1), OOFD_INTERMEDIATE_PEM);
  assert.equal(agent.options.rejectUnauthorized, true);
  assert.equal(agent.options.allowPartialTrustChain, false);
  assert.equal(agent.options.minVersion, 'TLSv1.2');
  agent.destroy();
});

test('a missing trusted anchor, substituted certificate or expired issuer fails closed', () => {
  for (const options of [
    { ...base, bundledRoots: [] },
    { ...base, now: Date.parse('2028-09-06T00:00:00Z') },
    { ...base, now: Date.parse('2018-09-05T00:00:00Z') },
    { ...base, now: NaN },
    { ...base, intermediate: tls.rootCertificates[0] },
    { ...base, intermediate: 'broken certificate' },
  ])
    assert.throws(() => createFiscalHttpsAgent('oofd', options), {
      code: 'FORTUNE_RECEIPT_UNAVAILABLE',
      statusCode: 503,
    });
});

test('unrelated fiscal provider preserves ordinary trust and does not add the OOFD issuer', () => {
  const agent = createFiscalHttpsAgent('wofd', { ...base, intermediate: 'unused' });
  assert.deepEqual(agent.options.ca, [...tls.rootCertificates]);
  assert.equal(agent.options.rejectUnauthorized, true);
  assert.equal(agent.options.allowPartialTrustChain, false);
  agent.destroy();
});

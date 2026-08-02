import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Set TOKEN_SECRET_KEY before importing crypto module
process.env.TOKEN_SECRET_KEY = 'a'.repeat(64);
process.env.DEVICE_JSON_B64 = Buffer.from(
  JSON.stringify({ deviceId: 'TEST-DEVICE', installId: 'TEST-INSTALL', pinHash: '0'.repeat(32) }),
).toString('base64');

const { encryptSecret, decryptSecret, computeTokenSnMac, computeXSign, computeXSU } = await import('../src/crypto.js');
const { ecKeyPair } = await import('../src/config.js');

describe('encryptSecret / decryptSecret', () => {
  it('should round-trip a secret buffer', () => {
    const original = Buffer.from('my-super-secret-value');
    const encrypted = encryptSecret(original);
    const decrypted = decryptSecret(encrypted);
    assert.deepStrictEqual(decrypted, original);
  });

  it('should produce different ciphertexts for the same input (random IV)', () => {
    const original = Buffer.from('test');
    const a = encryptSecret(original);
    const b = encryptSecret(original);
    assert.notEqual(a, b);
  });

  it('should fail to decrypt tampered data', () => {
    const encrypted = encryptSecret(Buffer.from('secret'));
    const buf = Buffer.from(encrypted, 'base64');
    buf[20] ^= 0xff; // tamper with ciphertext
    assert.throws(() => decryptSecret(buf.toString('base64')));
  });
});

describe('computeTokenSnMac', () => {
  it('should return 6-digit string', () => {
    const secret = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
    const result = computeTokenSnMac('TSN12345', secret);
    assert.match(result, /^\d{6}$/);
  });

  it('should return 000000 when secret is null', () => {
    const result = computeTokenSnMac('TSN12345', null);
    assert.equal(result, '000000');
  });
});

describe('computeXSU', () => {
  it('should return md5 hex of lowercased url', () => {
    const result = computeXSU('https://example.com/Path');
    assert.match(result, /^[0-9a-f]{32}$/);
  });

  it('should be case-insensitive', () => {
    const a = computeXSU('HTTPS://EXAMPLE.COM');
    const b = computeXSU('https://example.com');
    assert.equal(a, b);
  });
});

describe('computeXSign', () => {
  it('signs the full lower-case URL, named headers and exact POST body', () => {
    const url = 'https://qrpay.kaspi.kz/v01/remote/create';
    const headers = { 'X-Install-ID': 'INSTALL-1', 'X-App-Ver': '4.112.1' };
    const xsh = 'url,X-Install-ID,X-App-Ver';
    const body = '{"Amount":1000}';
    const signature = Buffer.from(computeXSign(url, headers, xsh, body), 'base64');
    const signText = `url:${url.toLowerCase()}\nx-install-id:INSTALL-1\nx-app-ver:4.112.1\n${body}`;
    const digest = crypto.createHash('sha256').update(signText, 'utf8').digest();
    const verifier = crypto.createVerify('SHA256');
    verifier.update(digest);
    verifier.end();
    assert.equal(verifier.verify(ecKeyPair.publicKey, signature), true);

    const wrongDigest = crypto
      .createHash('sha256')
      .update(signText.replace('1000', '1001'), 'utf8')
      .digest();
    const wrongVerifier = crypto.createVerify('SHA256');
    wrongVerifier.update(wrongDigest);
    wrongVerifier.end();
    assert.equal(wrongVerifier.verify(ecKeyPair.publicKey, signature), false);
  });
});

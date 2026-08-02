import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Set TOKEN_SECRET_KEY before importing (helpers imports from crypto via config chain)
process.env.TOKEN_SECRET_KEY = 'a'.repeat(64);
process.env.DEVICE_JSON_B64 = Buffer.from(
  JSON.stringify({ deviceId: 'TEST-DEVICE', installId: 'TEST-INSTALL', pinHash: '0'.repeat(32) }),
).toString('base64');

const { generateUUID, nowISO, entranceCookie, extractUserToken, signedQrPayHeaders } = await import('../src/helpers.js');
const { APP, DEVICE } = await import('../src/config.js');

describe('generateUUID', () => {
  it('should return an uppercase UUID', () => {
    const uuid = generateUUID();
    assert.match(uuid, /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
  });

  it('should return unique values', () => {
    const a = generateUUID();
    const b = generateUUID();
    assert.notEqual(a, b);
  });
});

describe('nowISO', () => {
  it('should return ISO-like string with timezone offset', () => {
    const result = nowISO();
    // Should match pattern like 2025-05-09T12:00:00.000+0600
    assert.match(result, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/);
  });
});

describe('entranceCookie', () => {
  it('should contain deviceId and installId', () => {
    const cookie = entranceCookie();
    assert.ok(cookie.includes('deviceId='));
    assert.ok(cookie.includes('installId='));
    assert.ok(cookie.includes('is_mobile_app=true'));
  });

  it('should include user_token when provided', () => {
    const cookie = entranceCookie('my-token');
    assert.ok(cookie.includes('user_token=my-token'));
  });

  it('should not include user_token when not provided', () => {
    const cookie = entranceCookie();
    assert.ok(!cookie.includes('user_token='));
  });
});

describe('extractUserToken', () => {
  it('should extract user_token from set-cookie headers', () => {
    const fakeResp = {
      headers: {
        raw: () => ({
          'set-cookie': ['user_token=abc123; Path=/; HttpOnly'],
        }),
      },
    };
    assert.equal(extractUserToken(fakeResp), 'abc123');
  });

  it('should return null when no user_token cookie', () => {
    const fakeResp = {
      headers: {
        raw: () => ({
          'set-cookie': ['other=value; Path=/'],
        }),
      },
    };
    assert.equal(extractUserToken(fakeResp), null);
  });

  it('should return null when no set-cookie header', () => {
    const fakeResp = {
      headers: {
        raw: () => ({}),
      },
    };
    assert.equal(extractUserToken(fakeResp), null);
  });
});

describe('signedQrPayHeaders', () => {
  it('uses the current Kaspi device headers and signs the serialized body', () => {
    const headers = signedQrPayHeaders(
      'https://qrpay.kaspi.kz/v01/remote/create',
      { tokenSN: 'TOKEN', profileId: '42', decryptedSecret: Buffer.alloc(32, 1) },
      '{"Amount":1000}',
    );
    assert.equal(headers['X-PI'], '42');
    assert.equal(headers['X-Device-ID'], DEVICE.deviceId);
    assert.equal(headers['X-Platform-Type'], 'iOS');
    assert.equal(headers['X-Platform-Ver'], APP.platformVer);
    assert.equal(
      headers['X-SH'],
      'url,X-Install-ID,X-PI,X-App-Bld,X-Platform-Ver,X-Locale,X-App-Ver,X-Device-ID,X-SV,X-Time,X-Platform-Type,X-Call,X-Kb-TokenSnMac,X-Kb-TokenSn',
    );
    assert.match(headers['X-Sign'], /^[A-Za-z0-9+/]+=*$/);
  });
});

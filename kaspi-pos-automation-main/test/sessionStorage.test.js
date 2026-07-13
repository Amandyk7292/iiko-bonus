import assert from 'node:assert/strict';
import { it } from 'node:test';

process.env.SESSION_JSON_B64 = Buffer.from(
  JSON.stringify({ tokenSN: 'seed', vtokenSecret: 'encrypted-seed', profileId: 'profile' }),
).toString('base64');

const { getGlobalSession, saveGlobalSession } = await import('../src/sessionStorage.js');

it('keeps a refreshed session in memory when environment is the deployment seed', () => {
  assert.equal(getGlobalSession()?.tokenSN, 'seed');
  saveGlobalSession('fresh', 'encrypted-fresh', 'profile');
  assert.equal(getGlobalSession()?.tokenSN, 'fresh');
});

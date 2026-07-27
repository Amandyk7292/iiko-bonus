import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, it } from 'node:test';

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaspi-session-storage-'));
const sessionFile = path.join(runtimeDir, 'session.json');
const previousSessionFile = process.env.KASPI_SESSION_FILE;
const previousSessionSeed = process.env.SESSION_JSON_B64;

process.env.KASPI_SESSION_FILE = sessionFile;

after(() => {
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  if (previousSessionFile === undefined) delete process.env.KASPI_SESSION_FILE;
  else process.env.KASPI_SESSION_FILE = previousSessionFile;
  if (previousSessionSeed === undefined) delete process.env.SESSION_JSON_B64;
  else process.env.SESSION_JSON_B64 = previousSessionSeed;
});

process.env.SESSION_JSON_B64 = Buffer.from(
  JSON.stringify({ tokenSN: 'seed', vtokenSecret: 'encrypted-seed', profileId: 'profile' }),
).toString('base64');

const { clearGlobalSession, getGlobalSession, saveGlobalSession } = await import(
  `../src/sessionStorage.js?storage-test=${Date.now()}`
);

it('persists a refreshed session instead of resurrecting the deployment seed', async () => {
  assert.equal(getGlobalSession()?.tokenSN, 'seed');
  saveGlobalSession('fresh', 'encrypted-fresh', 'profile');
  assert.equal(getGlobalSession()?.tokenSN, 'fresh');

  const restarted = await import(`../src/sessionStorage.js?restart=${Date.now()}`);
  assert.equal(restarted.getGlobalSession()?.tokenSN, 'fresh');
  assert.equal(
    restarted.clearGlobalSession('stale_client', {
      tokenSN: 'fresh',
      vtokenSecret: 'corrupted-client-copy',
    }),
    false,
  );
  assert.equal(restarted.getGlobalSession()?.tokenSN, 'fresh');
});

it('persists a revoked tombstone so an old environment seed cannot return', async () => {
  clearGlobalSession('session_expired');
  assert.equal(getGlobalSession(), null);

  const restarted = await import(`../src/sessionStorage.js?revoked=${Date.now()}`);
  assert.equal(restarted.getGlobalSession(), null);
});

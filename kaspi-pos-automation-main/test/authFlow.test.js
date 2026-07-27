import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const authSource = fs.readFileSync(path.join(testDir, '..', 'src', 'routes', 'auth.js'), 'utf8');
const finishFlow = authSource.slice(
  authSource.indexOf('async function doFinish'),
  authSource.indexOf('//  Refresh — SignInLite'),
);

it('continues from SMS finish directly to organization context', () => {
  assert.ok(finishFlow.includes('/api/v1/kpentrance/finish'));
  assert.ok(finishFlow.includes('/v08/organizations/org-context-otp'));
  assert.equal(finishFlow.includes('/v03/auth/sign-in-lite'), false);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { walkingAssertionError, walkingDatabaseError } = require('../src/utils/walking-error.util');

test('walking assertion diagnostics distinguish counter, signature and identity without raw proof text', () => {
  for (const [message, reason] of [
    ['invalid signCount', 'counter_not_increasing'],
    ['invalid signature', 'signature_invalid'],
    ['appId does not match', 'app_identity_invalid'],
    ['payload=PRIVATE_PROOF key=PRIVATE_KEY', 'verification_rejected'],
  ]) {
    const error = walkingAssertionError(new Error(message));
    assert.equal(error.code, 'WALKING_PROOF_INVALID');
    assert.equal(error.statusCode, 409);
    assert.equal(error.walkingStage, 'assertion');
    assert.equal(error.walkingReason, reason);
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE_PROOF|PRIVATE_KEY/);
    assert.equal(error.message, 'WALKING_PROOF_INVALID');
  }
});
test('walking database diagnostics retain only SQLSTATE and allowlisted reason, preserving response status', () => {
  const counter = walkingDatabaseError(
    { code: 'P0001', message: 'walking counter conflict' },
    'apply_ios',
    ['22023', 'P0001'],
  );
  assert.equal(counter.walkingReason, 'counter_conflict');
  assert.equal(counter.databaseCode, 'P0001');
  assert.equal(counter.statusCode, 409);
  const unknown = walkingDatabaseError(
    { code: '42501', message: 'PRIVATE_DATABASE_SECRET' },
    'registration',
  );
  assert.equal(unknown.code, 'WALKING_UNAVAILABLE');
  assert.equal(unknown.statusCode, 503);
  assert.equal(unknown.databaseCode, '42501');
  assert.doesNotMatch(JSON.stringify(unknown), /PRIVATE_DATABASE_SECRET/);
  const unsafeCode = walkingDatabaseError(
    { code: 'PRIVATE_TOKEN', message: 'unavailable' },
    'status',
  );
  assert.equal(unsafeCode.databaseCode, undefined);
});

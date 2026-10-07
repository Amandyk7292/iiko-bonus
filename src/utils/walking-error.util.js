// Diagnostic labels are fixed values. Never retain proofs, key IDs or raw errors.
const assertionReasons = new Map([
  ['invalid signCount', 'counter_not_increasing'],
  ['invalid signature', 'signature_invalid'],
  ['appId does not match', 'app_identity_invalid'],
  ['invalid assertion', 'assertion_invalid'],
]);
const databaseReasons = new Map([
  ['invalid walking proof', 'period_or_counter_invalid'],
  ['walking rewards inactive', 'policy_inactive'],
  ['walking counter conflict', 'counter_conflict'],
  ['walking challenge reused', 'challenge_reused'],
  ['customer unavailable', 'customer_unavailable'],
  ['walking device changed today', 'device_changed_today'],
  ['invalid Android walking proof', 'android_proof_invalid'],
  ['invalid Android walking day', 'android_period_invalid'],
  ['duplicate Android walking day', 'android_duplicate_day'],
  ['Android walking key conflict', 'android_counter_conflict'],
  ['Android walking challenge reused', 'challenge_reused'],
]);
function walkingError(code, statusCode = 409, stage, reason) {
  return Object.assign(new Error(code), {
    code,
    statusCode,
    ...(stage ? { walkingStage: stage } : {}),
    ...(reason ? { walkingReason: reason } : {}),
  });
}
function walkingAssertionError(error) {
  return walkingError(
    'WALKING_PROOF_INVALID',
    409,
    'assertion',
    assertionReasons.get(error?.message) || 'verification_rejected',
  );
}
function walkingDatabaseError(error, stage, invalidCodes = []) {
  const invalid = invalidCodes.includes(error?.code);
  const result = walkingError(
    invalid ? 'WALKING_PROOF_INVALID' : 'WALKING_UNAVAILABLE',
    invalid ? 409 : 503,
    stage,
    databaseReasons.get(error?.message) || 'database_rejected',
  );
  // Only a valid PostgreSQL SQLSTATE can leave this helper, never database text.
  if (/^[A-Z0-9]{5}$/.test(error?.code || '')) result.databaseCode = error.code;
  return result;
}
module.exports = { walkingError, walkingAssertionError, walkingDatabaseError };

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  canonicalJson,
  describeSigningKey,
  loadEncryptedSigningPrivateKey,
  sha256,
  signManifest,
  verifyBackupSet,
  verifyManifestSignature,
} = require('../scripts/lib/backup-signature');

const PASSPHRASE = 'test-only-signing-passphrase';
const ENCRYPTION_FINGERPRINT = 'a'.repeat(64);
const createSigningKeys = () =>
  crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase: PASSPHRASE,
    },
  });

const keys = createSigningKeys();
const attackerKeys = createSigningKeys();
const signingFingerprint = describeSigningKey(crypto.createPublicKey(keys.publicKey)).fingerprint;

const createSandbox = () => fsp.mkdtemp(path.join(os.tmpdir(), 'bulka-signature-'));

const createBackupSet = async (root) => {
  const runId = '20260808T120000Z';
  const artifacts = [];
  for (const [role, prefix] of [
    ['environment', 'production-env'],
    ['storage', 'supabase-storage'],
    ['database', 'database'],
  ]) {
    const encryptedFile = `${prefix}-${runId}.bulka.enc`;
    const metadataFile = `${encryptedFile}.metadata.json`;
    const encrypted = Buffer.from(`encrypted-${role}-payload`);
    const encryptedSha256 = sha256(encrypted);
    const metadata = {
      schemaVersion: 1,
      backupSet: runId,
      encryption: {
        schemaVersion: 1,
        algorithm: 'RSA-OAEP-SHA256+AES-256-GCM',
        backupType: role,
        encryptedFile,
        encryptedSha256,
        keyFingerprintSha256: ENCRYPTION_FINGERPRINT,
        selfTestAuthenticatedDecrypt: true,
      },
    };
    const metadataBytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`);
    await fsp.writeFile(path.join(root, encryptedFile), encrypted);
    await fsp.writeFile(path.join(root, metadataFile), metadataBytes);
    artifacts.push({
      role,
      encryptedFile,
      metadataFile,
      encryptedSha256,
      metadataSha256: sha256(metadataBytes),
    });
  }
  const manifest = {
    schemaVersion: 2,
    completedAtUtc: '2026-08-08T12:00:00.000Z',
    backupSet: runId,
    algorithm: 'RSA-OAEP-SHA256+AES-256-GCM',
    keyFingerprintSha256: ENCRYPTION_FINGERPRINT,
    signingKeyFingerprintSha256: signingFingerprint,
    artifacts,
  };
  const manifestPath = path.join(root, `backup-set-${runId}.json`);
  const signaturePath = path.join(root, `backup-set-${runId}.signature.json`);
  await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const signatureEnvelope = signManifest({
    manifest,
    privateKeyPem: keys.privateKey,
    passphrase: PASSPHRASE,
    expectedFingerprint: signingFingerprint,
    manifestFile: path.basename(manifestPath),
  });
  await fsp.writeFile(signaturePath, `${JSON.stringify(signatureEnvelope, null, 2)}\n`);
  return { manifest, manifestPath, signatureEnvelope, signaturePath };
};

test('canonical signed backup set verifies every encrypted artifact and metadata file', async (t) => {
  const sandbox = await createSandbox();
  t.after(() => fsp.rm(sandbox, { recursive: true, force: true }));
  const backup = await createBackupSet(sandbox);

  const result = await verifyBackupSet({
    manifestPath: backup.manifestPath,
    signaturePath: backup.signaturePath,
    publicKeyPem: keys.publicKey,
    expectedSigningFingerprint: signingFingerprint,
    expectedEncryptionFingerprint: ENCRYPTION_FINGERPRINT,
  });
  assert.equal(result.valid, true);
  assert.equal(result.signingAlgorithm, 'Ed25519');
  assert.equal(result.artifactsVerified, 3);

  const reordered = JSON.parse(JSON.stringify(backup.manifest));
  reordered.artifacts = reordered.artifacts.map((artifact) => ({
    metadataSha256: artifact.metadataSha256,
    encryptedSha256: artifact.encryptedSha256,
    metadataFile: artifact.metadataFile,
    encryptedFile: artifact.encryptedFile,
    role: artifact.role,
  }));
  assert.equal(canonicalJson(reordered), canonicalJson(backup.manifest));
  assert.doesNotThrow(() =>
    verifyManifestSignature({
      manifest: reordered,
      signatureEnvelope: backup.signatureEnvelope,
      publicKeyPem: keys.publicKey,
      expectedFingerprint: signingFingerprint,
      manifestFile: path.basename(backup.manifestPath),
    }),
  );
});

test('manifest, encrypted payload, and metadata tampering all fail closed', async (t) => {
  const sandbox = await createSandbox();
  t.after(() => fsp.rm(sandbox, { recursive: true, force: true }));
  const backup = await createBackupSet(sandbox);
  const verify = () =>
    verifyBackupSet({
      manifestPath: backup.manifestPath,
      signaturePath: backup.signaturePath,
      publicKeyPem: keys.publicKey,
      expectedSigningFingerprint: signingFingerprint,
      expectedEncryptionFingerprint: ENCRYPTION_FINGERPRINT,
    });

  const originalManifest = await fsp.readFile(backup.manifestPath);
  const modifiedManifest = JSON.parse(originalManifest.toString('utf8'));
  modifiedManifest.completedAtUtc = '2026-08-08T12:00:01.000Z';
  await fsp.writeFile(backup.manifestPath, JSON.stringify(modifiedManifest));
  await assert.rejects(verify(), /signature verification failed|manifest hash does not match/i);
  await fsp.writeFile(backup.manifestPath, originalManifest);

  const environmentPath = path.join(sandbox, backup.manifest.artifacts[0].encryptedFile);
  await fsp.appendFile(environmentPath, 'tamper');
  await assert.rejects(verify(), /environment artifact checksum/i);
  await fsp.writeFile(environmentPath, 'encrypted-environment-payload');

  const metadataPath = path.join(sandbox, backup.manifest.artifacts[0].metadataFile);
  await fsp.appendFile(metadataPath, ' ');
  await assert.rejects(verify(), /environment artifact checksum/i);
});

test('wrong or attacker signing keys cannot forge a pinned backup set', async (t) => {
  const sandbox = await createSandbox();
  t.after(() => fsp.rm(sandbox, { recursive: true, force: true }));
  const backup = await createBackupSet(sandbox);
  const attackerFingerprint = describeSigningKey(
    crypto.createPublicKey(attackerKeys.publicKey),
  ).fingerprint;
  const forgedManifest = { ...backup.manifest, completedAtUtc: '2026-08-08T12:00:02.000Z' };
  const forgedSignature = signManifest({
    manifest: { ...forgedManifest, signingKeyFingerprintSha256: attackerFingerprint },
    privateKeyPem: attackerKeys.privateKey,
    passphrase: PASSPHRASE,
    expectedFingerprint: attackerFingerprint,
    manifestFile: path.basename(backup.manifestPath),
  });

  assert.throws(
    () =>
      verifyManifestSignature({
        manifest: forgedManifest,
        signatureEnvelope: forgedSignature,
        publicKeyPem: attackerKeys.publicKey,
        expectedFingerprint: signingFingerprint,
        manifestFile: path.basename(backup.manifestPath),
      }),
    /signature metadata is incompatible|does not match/i,
  );
  assert.throws(
    () =>
      signManifest({
        manifest: backup.manifest,
        privateKeyPem: attackerKeys.privateKey,
        passphrase: PASSPHRASE,
        expectedFingerprint: signingFingerprint,
        manifestFile: path.basename(backup.manifestPath),
      }),
    /does not match the expected fingerprint/i,
  );
});

test('unencrypted signing private keys and weak RSA signing keys are rejected', () => {
  const unencrypted = crypto.generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  assert.throws(
    () => loadEncryptedSigningPrivateKey(unencrypted.privateKey, PASSPHRASE),
    /encrypted PKCS#8/i,
  );
  const weakRsa = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  assert.throws(
    () => describeSigningKey(crypto.createPublicKey(weakRsa.publicKey)),
    /at least 3072 bits/i,
  );
});

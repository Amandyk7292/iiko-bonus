#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { publicKeyFingerprint } = require('./backup-envelope');

const SIGNATURE_SCHEMA_VERSION = 1;
const MANIFEST_SCHEMA_VERSION = 2;
const ENCRYPTION_ALGORITHM = 'RSA-OAEP-SHA256+AES-256-GCM';
const SIGNATURE_DOMAIN = Buffer.from('BULKA-BACKUP-MANIFEST-SIGNATURE-V1\0', 'utf8');
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RUN_ID_PATTERN = /^[0-9]{8}T[0-9]{6}Z$/;
const SAFE_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

const assertSha256 = (value, label) => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 fingerprint`);
  }
  return value;
};

const canonicalJson = (value) => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Canonical manifest numbers must be safe integers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new Error('Canonical manifest contains an unsupported value');
};

const canonicalManifest = (manifest) => Buffer.from(canonicalJson(manifest), 'utf8');
const signaturePayload = (manifest) => Buffer.concat([SIGNATURE_DOMAIN, canonicalManifest(manifest)]);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const describeSigningKey = (key) => {
  const publicKey = key.type === 'public' ? key : crypto.createPublicKey(key);
  const fingerprint = publicKeyFingerprint(publicKey);
  if (publicKey.asymmetricKeyType === 'ed25519') {
    return { algorithm: 'Ed25519', fingerprint, publicKey };
  }
  if (publicKey.asymmetricKeyType === 'rsa' || publicKey.asymmetricKeyType === 'rsa-pss') {
    if ((publicKey.asymmetricKeyDetails?.modulusLength || 0) < 3072) {
      throw new Error('RSA signing keys must be at least 3072 bits');
    }
    return { algorithm: 'RSA-PSS-SHA256', fingerprint, publicKey };
  }
  throw new Error('Signing key must be Ed25519 or RSA/RSA-PSS');
};

const loadEncryptedSigningPrivateKey = (privateKeyPem, passphrase) => {
  const pemText = Buffer.isBuffer(privateKeyPem)
    ? privateKeyPem.toString('utf8')
    : String(privateKeyPem || '');
  if (!pemText.includes('-----BEGIN ENCRYPTED PRIVATE KEY-----')) {
    throw new Error('Signing private key must be encrypted PKCS#8');
  }
  if (typeof passphrase !== 'string' || !passphrase) {
    throw new Error('Signing private-key passphrase is required through the environment');
  }
  return crypto.createPrivateKey({ key: privateKeyPem, format: 'pem', passphrase });
};

const signManifest = ({ manifest, privateKeyPem, passphrase, expectedFingerprint, manifestFile }) => {
  assertSha256(expectedFingerprint, 'Expected signing-key fingerprint');
  if (!SAFE_FILENAME_PATTERN.test(manifestFile) || path.basename(manifestFile) !== manifestFile) {
    throw new Error('Manifest filename is unsafe');
  }
  validateManifest(manifest);
  const privateKey = loadEncryptedSigningPrivateKey(privateKeyPem, passphrase);
  const key = describeSigningKey(privateKey);
  if (key.fingerprint !== expectedFingerprint) {
    throw new Error('Signing private key does not match the expected fingerprint');
  }
  const payload = signaturePayload(manifest);
  const signature =
    key.algorithm === 'Ed25519'
      ? crypto.sign(null, payload, privateKey)
      : crypto.sign('sha256', payload, {
          key: privateKey,
          padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
          saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
        });
  return {
    schemaVersion: SIGNATURE_SCHEMA_VERSION,
    algorithm: key.algorithm,
    signingKeyFingerprintSha256: key.fingerprint,
    manifestFile,
    canonicalManifestSha256: sha256(canonicalManifest(manifest)),
    signature: signature.toString('base64'),
  };
};

const decodeSignature = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('Detached signature encoding is invalid');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length < 64) throw new Error('Detached signature is too short');
  return decoded;
};

const verifyManifestSignature = ({
  manifest,
  signatureEnvelope,
  publicKeyPem,
  expectedFingerprint,
  manifestFile,
}) => {
  assertSha256(expectedFingerprint, 'Expected signing-key fingerprint');
  validateManifest(manifest);
  if (
    !signatureEnvelope ||
    signatureEnvelope.schemaVersion !== SIGNATURE_SCHEMA_VERSION ||
    signatureEnvelope.manifestFile !== manifestFile ||
    signatureEnvelope.signingKeyFingerprintSha256 !== expectedFingerprint
  ) {
    throw new Error('Detached signature metadata is incompatible');
  }
  const publicKey = crypto.createPublicKey(publicKeyPem);
  const key = describeSigningKey(publicKey);
  if (key.fingerprint !== expectedFingerprint) {
    throw new Error('Signing public key does not match the expected fingerprint');
  }
  if (signatureEnvelope.algorithm !== key.algorithm) {
    throw new Error('Detached signature algorithm does not match the signing key');
  }
  const canonical = canonicalManifest(manifest);
  if (signatureEnvelope.canonicalManifestSha256 !== sha256(canonical)) {
    throw new Error('Detached signature manifest hash does not match');
  }
  const payload = Buffer.concat([SIGNATURE_DOMAIN, canonical]);
  const signature = decodeSignature(signatureEnvelope.signature);
  const valid =
    key.algorithm === 'Ed25519'
      ? crypto.verify(null, payload, publicKey, signature)
      : crypto.verify(
          'sha256',
          payload,
          {
            key: publicKey,
            padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
            saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
          },
          signature,
        );
  if (!valid) throw new Error('Backup-set signature verification failed');
  return { algorithm: key.algorithm, signingKeyFingerprintSha256: key.fingerprint };
};

const validateManifest = (manifest, expectedEncryptionFingerprint = '') => {
  if (!manifest || Object.getPrototypeOf(manifest) !== Object.prototype) {
    throw new Error('Backup-set manifest must be an object');
  }
  if (
    manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    manifest.algorithm !== ENCRYPTION_ALGORITHM ||
    typeof manifest.backupSet !== 'string' ||
    !RUN_ID_PATTERN.test(manifest.backupSet)
  ) {
    throw new Error('Backup-set manifest format is incompatible');
  }
  if (
    typeof manifest.completedAtUtc !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(manifest.completedAtUtc) ||
    Number.isNaN(Date.parse(manifest.completedAtUtc)) ||
    new Date(manifest.completedAtUtc).toISOString() !== manifest.completedAtUtc
  ) {
    throw new Error('Backup-set completion timestamp is invalid');
  }
  assertSha256(manifest.keyFingerprintSha256, 'Manifest encryption-key fingerprint');
  assertSha256(manifest.signingKeyFingerprintSha256, 'Manifest signing-key fingerprint');
  if (expectedEncryptionFingerprint) {
    assertSha256(expectedEncryptionFingerprint, 'Expected encryption-key fingerprint');
    if (manifest.keyFingerprintSha256 !== expectedEncryptionFingerprint) {
      throw new Error('Manifest encryption key does not match the expected fingerprint');
    }
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 3) {
    throw new Error('Backup-set manifest must contain exactly three artifacts');
  }
  const roles = new Set();
  const filenames = new Set();
  for (const artifact of manifest.artifacts) {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      throw new Error('Backup-set artifact metadata is invalid');
    }
    if (!['environment', 'storage', 'database'].includes(artifact.role) || roles.has(artifact.role)) {
      throw new Error('Backup-set artifact roles are invalid');
    }
    roles.add(artifact.role);
    const expectedEncryptedFile = {
      environment: `production-env-${manifest.backupSet}.bulka.enc`,
      storage: `supabase-storage-${manifest.backupSet}.bulka.enc`,
      database: `database-${manifest.backupSet}.bulka.enc`,
    }[artifact.role];
    if (artifact.encryptedFile !== expectedEncryptedFile) {
      throw new Error('Backup-set artifact filename does not match its role and run id');
    }
    for (const [label, filename] of [
      ['encrypted', artifact.encryptedFile],
      ['metadata', artifact.metadataFile],
    ]) {
      if (
        typeof filename !== 'string' ||
        !SAFE_FILENAME_PATTERN.test(filename) ||
        path.basename(filename) !== filename ||
        filenames.has(filename)
      ) {
        throw new Error(`Backup-set ${label} filename is unsafe or duplicated`);
      }
      filenames.add(filename);
    }
    if (artifact.metadataFile !== `${artifact.encryptedFile}.metadata.json`) {
      throw new Error('Backup-set metadata filename does not match its encrypted artifact');
    }
    assertSha256(artifact.encryptedSha256, 'Encrypted artifact checksum');
    assertSha256(artifact.metadataSha256, 'Artifact metadata checksum');
  }
  return manifest;
};

const readRegularFile = async (filename, label) => {
  const stat = await fsp.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  return fsp.readFile(filename);
};

const hashRegularFile = async (filename, label) => {
  const stat = await fsp.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
};

const verifyBackupSet = async ({
  manifestPath,
  signaturePath,
  publicKeyPem,
  expectedSigningFingerprint,
  expectedEncryptionFingerprint,
}) => {
  if (!path.isAbsolute(manifestPath) || !path.isAbsolute(signaturePath)) {
    throw new Error('Manifest and signature paths must be absolute');
  }
  const manifestBuffer = await readRegularFile(manifestPath, 'Manifest');
  const signatureBuffer = await readRegularFile(signaturePath, 'Detached signature');
  let manifest;
  let signatureEnvelope;
  try {
    manifest = JSON.parse(manifestBuffer.toString('utf8'));
    signatureEnvelope = JSON.parse(signatureBuffer.toString('utf8'));
  } catch {
    throw new Error('Manifest or detached signature is invalid JSON');
  }
  validateManifest(manifest, expectedEncryptionFingerprint);
  if (path.basename(manifestPath) !== `backup-set-${manifest.backupSet}.json`) {
    throw new Error('Backup-set manifest filename does not match its run id');
  }
  if (path.basename(signaturePath) !== `backup-set-${manifest.backupSet}.signature.json`) {
    throw new Error('Detached signature filename does not match its run id');
  }
  if (manifest.signingKeyFingerprintSha256 !== expectedSigningFingerprint) {
    throw new Error('Manifest signing key does not match the expected fingerprint');
  }
  const verification = verifyManifestSignature({
    manifest,
    signatureEnvelope,
    publicKeyPem,
    expectedFingerprint: expectedSigningFingerprint,
    manifestFile: path.basename(manifestPath),
  });
  const root = path.dirname(manifestPath);
  if (path.dirname(signaturePath) !== root) {
    throw new Error('Manifest and detached signature must be in the same directory');
  }

  for (const artifact of manifest.artifacts) {
    const encryptedPath = path.join(root, artifact.encryptedFile);
    const metadataPath = path.join(root, artifact.metadataFile);
    const encryptedHash = await hashRegularFile(encryptedPath, `${artifact.role} encrypted artifact`);
    const metadataBuffer = await readRegularFile(metadataPath, `${artifact.role} metadata`);
    const metadataHash = sha256(metadataBuffer);
    if (encryptedHash !== artifact.encryptedSha256 || metadataHash !== artifact.metadataSha256) {
      throw new Error(`${artifact.role} artifact checksum verification failed`);
    }
    let metadata;
    try {
      metadata = JSON.parse(metadataBuffer.toString('utf8'));
    } catch {
      throw new Error(`${artifact.role} metadata is invalid JSON`);
    }
    if (
      metadata.backupSet !== manifest.backupSet ||
      metadata.encryption?.backupType !== artifact.role ||
      metadata.encryption?.encryptedFile !== artifact.encryptedFile ||
      metadata.encryption?.encryptedSha256 !== artifact.encryptedSha256 ||
      metadata.encryption?.keyFingerprintSha256 !== expectedEncryptionFingerprint ||
      metadata.encryption?.selfTestAuthenticatedDecrypt !== true
    ) {
      throw new Error(`${artifact.role} metadata does not match the signed manifest`);
    }
  }
  return {
    valid: true,
    backupSet: manifest.backupSet,
    signingAlgorithm: verification.algorithm,
    signingKeyFingerprintSha256: verification.signingKeyFingerprintSha256,
    encryptionKeyFingerprintSha256: manifest.keyFingerprintSha256,
    artifactsVerified: manifest.artifacts.length,
  };
};

module.exports = {
  ENCRYPTION_ALGORITHM,
  MANIFEST_SCHEMA_VERSION,
  SIGNATURE_SCHEMA_VERSION,
  canonicalJson,
  describeSigningKey,
  loadEncryptedSigningPrivateKey,
  sha256,
  signManifest,
  validateManifest,
  verifyBackupSet,
  verifyManifestSignature,
};

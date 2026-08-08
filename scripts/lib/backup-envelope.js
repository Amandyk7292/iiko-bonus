#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Transform, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const MAGIC = Buffer.from('BULKABK1', 'ascii');
const FORMAT_VERSION = 1;
const PREAMBLE_BYTES = MAGIC.length + 1 + 4;
const AUTH_TAG_BYTES = 16;
const FIXED_HEADER_BYTES = PREAMBLE_BYTES + AUTH_TAG_BYTES;
const MAX_HEADER_BYTES = 64 * 1024;
const ALGORITHM = 'RSA-OAEP-SHA256+AES-256-GCM';

class HashCounter extends Transform {
  constructor() {
    super();
    this.hash = crypto.createHash('sha256');
    this.bytes = 0;
  }

  _transform(chunk, encoding, callback) {
    this.hash.update(chunk);
    this.bytes += chunk.length;
    callback(null, chunk);
  }

  digest() {
    return this.hash.digest('hex');
  }
}

const temporaryPath = (outputPath) =>
  path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.partial-${process.pid}-${crypto.randomBytes(8).toString('hex')}`,
  );

const assertDistinctPaths = (inputPath, outputPath) => {
  if (!inputPath || inputPath === '-') return;
  if (path.resolve(inputPath) === path.resolve(outputPath)) {
    throw new Error('Input and output paths must be different');
  }
};

const assertOutputAvailable = async (outputPath) => {
  try {
    await fsp.access(outputPath, fs.constants.F_OK);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Refusing to overwrite existing output: ${outputPath}`);
};

const publicKeyFingerprint = (publicKey) => {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex');
};

const hashFile = async (filename) => {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(filename)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest('hex'), bytes };
};

const writePrefix = async (filename, preamble, header) => {
  const handle = await fsp.open(filename, 'wx', 0o600);
  try {
    await handle.writeFile(Buffer.concat([preamble, Buffer.alloc(AUTH_TAG_BYTES), header]));
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const patchAuthenticationTag = async (filename, tag) => {
  if (tag.length !== AUTH_TAG_BYTES) throw new Error('Unexpected AES-GCM tag length');
  const handle = await fsp.open(filename, 'r+');
  try {
    const result = await handle.write(tag, 0, tag.length, PREAMBLE_BYTES);
    if (result.bytesWritten !== tag.length) {
      throw new Error('Could not write the complete AES-GCM authentication tag');
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const normalizeMetadataValue = (value, label, maximumLength) => {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new Error(`${label} must be between 1 and ${maximumLength} characters`);
  }
  return normalized;
};

const assertSafeSourceName = (sourceName) => {
  const normalized = normalizeMetadataValue(sourceName, 'Source name', 255);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized) ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.includes('..')
  ) {
    throw new Error('Source name must be a plain filename without paths or control characters');
  }
  return normalized;
};

const assertStrictUtcTimestamp = (value) => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error('Encrypted backup creation timestamp is invalid');
  }
};

const decodeBase64 = (value, label) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`Encrypted backup ${label} is invalid`);
  }
  return Buffer.from(value, 'base64');
};

const encryptStream = async ({
  input,
  inputPath = '',
  outputPath,
  publicKeyPem,
  backupType,
  sourceName,
  createdAt = new Date(),
}) => {
  if (!input || typeof input.pipe !== 'function') throw new Error('A readable input is required');
  if (!path.isAbsolute(outputPath)) throw new Error('Output path must be absolute');
  assertDistinctPaths(inputPath, outputPath);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await assertOutputAvailable(outputPath);

  const normalizedType = normalizeMetadataValue(backupType, 'Backup type', 40);
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalizedType)) {
    throw new Error('Backup type may contain only lowercase letters, numbers, underscores and dashes');
  }
  const normalizedSource = assertSafeSourceName(sourceName);
  const publicKey = crypto.createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== 'rsa') {
    throw new Error('Escrow public key must be an RSA key');
  }
  if ((publicKey.asymmetricKeyDetails?.modulusLength || 0) < 3072) {
    throw new Error('Escrow RSA public key must be at least 3072 bits');
  }

  const contentKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const wrappedKey = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    contentKey,
  );
  const fingerprint = publicKeyFingerprint(publicKey);
  const headerObject = {
    schemaVersion: FORMAT_VERSION,
    algorithm: ALGORITHM,
    keyFingerprintSha256: fingerprint,
    wrappedKey: wrappedKey.toString('base64'),
    iv: iv.toString('base64'),
    backupType: normalizedType,
    sourceName: normalizedSource,
    createdAtUtc: createdAt.toISOString(),
  };
  const header = Buffer.from(JSON.stringify(headerObject), 'utf8');
  if (header.length > MAX_HEADER_BYTES) throw new Error('Backup envelope header is too large');
  const preamble = Buffer.alloc(PREAMBLE_BYTES);
  MAGIC.copy(preamble, 0);
  preamble.writeUInt8(FORMAT_VERSION, MAGIC.length);
  preamble.writeUInt32BE(header.length, MAGIC.length + 1);

  const partialPath = temporaryPath(outputPath);
  let published = false;
  const counter = new HashCounter();
  const cipher = crypto.createCipheriv('aes-256-gcm', contentKey, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  cipher.setAAD(Buffer.concat([preamble, header]));

  try {
    await writePrefix(partialPath, preamble, header);
    await pipeline(
      input,
      counter,
      cipher,
      fs.createWriteStream(partialPath, { flags: 'a', mode: 0o600 }),
    );
    await patchAuthenticationTag(partialPath, cipher.getAuthTag());
    const selfTest = await verifyEnvelopeWithContentKey(partialPath, contentKey);
    const plaintextSha256 = counter.digest();
    if (selfTest.sha256 !== plaintextSha256 || selfTest.bytes !== counter.bytes) {
      throw new Error('Authenticated backup self-test plaintext checksum failed');
    }
    const encrypted = await hashFile(partialPath);
    await fsp.link(partialPath, outputPath);
    published = true;
    await fsp.unlink(partialPath);
    await fsp.chmod(outputPath, 0o600);

    return {
      schemaVersion: FORMAT_VERSION,
      algorithm: ALGORITHM,
      backupType: normalizedType,
      sourceName: normalizedSource,
      createdAtUtc: headerObject.createdAtUtc,
      keyFingerprintSha256: fingerprint,
      plaintextSha256,
      plaintextBytes: counter.bytes,
      encryptedSha256: encrypted.sha256,
      encryptedBytes: encrypted.bytes,
      encryptedFile: path.basename(outputPath),
      selfTestAuthenticatedDecrypt: true,
    };
  } catch (error) {
    await fsp.rm(partialPath, { force: true }).catch(() => {});
    if (published) await fsp.rm(outputPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    contentKey.fill(0);
  }
};

const readEnvelopeHeader = async (inputPath) => {
  const handle = await fsp.open(inputPath, 'r');
  try {
    const stat = await handle.stat();
    if (stat.size < FIXED_HEADER_BYTES) throw new Error('Encrypted backup is truncated');
    const fixed = Buffer.alloc(FIXED_HEADER_BYTES);
    const fixedRead = await handle.read(fixed, 0, fixed.length, 0);
    if (fixedRead.bytesRead !== fixed.length) throw new Error('Encrypted backup header is truncated');
    if (!fixed.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('Encrypted backup magic is invalid');
    }
    const version = fixed.readUInt8(MAGIC.length);
    if (version !== FORMAT_VERSION) throw new Error(`Unsupported backup format version: ${version}`);
    const headerLength = fixed.readUInt32BE(MAGIC.length + 1);
    if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) {
      throw new Error('Encrypted backup header length is invalid');
    }
    if (stat.size < FIXED_HEADER_BYTES + headerLength) {
      throw new Error('Encrypted backup payload is truncated');
    }
    const headerBuffer = Buffer.alloc(headerLength);
    const headerRead = await handle.read(
      headerBuffer,
      0,
      headerLength,
      FIXED_HEADER_BYTES,
    );
    if (headerRead.bytesRead !== headerLength) throw new Error('Encrypted backup header is truncated');
    let header;
    try {
      header = JSON.parse(headerBuffer.toString('utf8'));
    } catch {
      throw new Error('Encrypted backup metadata is invalid JSON');
    }
    if (header.schemaVersion !== FORMAT_VERSION || header.algorithm !== ALGORITHM) {
      throw new Error('Encrypted backup metadata is incompatible');
    }
    assertStrictUtcTimestamp(header.createdAtUtc);
    if (
      typeof header.keyFingerprintSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(header.keyFingerprintSha256)
    ) {
      throw new Error('Encrypted backup public-key fingerprint is invalid');
    }
    if (
      typeof header.backupType !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(header.backupType) ||
      typeof header.sourceName !== 'string'
    ) {
      throw new Error('Encrypted backup source metadata is invalid');
    }
    assertSafeSourceName(header.sourceName);
    if (decodeBase64(header.iv, 'IV').length !== 12) {
      throw new Error('Encrypted backup IV length is invalid');
    }
    if (decodeBase64(header.wrappedKey, 'wrapped key').length < 384) {
      throw new Error('Encrypted backup wrapped key is invalid');
    }
    return {
      stat,
      header,
      headerBuffer,
      preamble: fixed.subarray(0, PREAMBLE_BYTES),
      authenticationTag: fixed.subarray(PREAMBLE_BYTES, FIXED_HEADER_BYTES),
      ciphertextOffset: FIXED_HEADER_BYTES + headerLength,
    };
  } finally {
    await handle.close();
  }
};

const verifyEnvelopeWithContentKey = async (inputPath, contentKey) => {
  const envelope = await readEnvelopeHeader(inputPath);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    contentKey,
    decodeBase64(envelope.header.iv, 'IV'),
    { authTagLength: AUTH_TAG_BYTES },
  );
  decipher.setAAD(Buffer.concat([envelope.preamble, envelope.headerBuffer]));
  decipher.setAuthTag(envelope.authenticationTag);
  const counter = new HashCounter();
  const discard = new Writable({
    write(chunk, encoding, callback) {
      callback();
    },
  });
  try {
    await pipeline(
      fs.createReadStream(inputPath, { start: envelope.ciphertextOffset }),
      decipher,
      counter,
      discard,
    );
  } catch {
    throw new Error('Authenticated backup self-test decrypt failed');
  }
  return { sha256: counter.digest(), bytes: counter.bytes };
};

const decryptFile = async ({ inputPath, outputPath, privateKeyPem, passphrase }) => {
  if (!path.isAbsolute(inputPath) || !path.isAbsolute(outputPath)) {
    throw new Error('Input and output paths must be absolute');
  }
  assertDistinctPaths(inputPath, outputPath);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await assertOutputAvailable(outputPath);

  const envelope = await readEnvelopeHeader(inputPath);
  const privateKey = crypto.createPrivateKey({ key: privateKeyPem, passphrase });
  if (privateKey.asymmetricKeyType !== 'rsa') {
    throw new Error('Escrow private key must be an RSA key');
  }
  if ((privateKey.asymmetricKeyDetails?.modulusLength || 0) < 3072) {
    throw new Error('Escrow RSA private key must be at least 3072 bits');
  }
  const publicKey = crypto.createPublicKey(privateKey);
  const fingerprint = publicKeyFingerprint(publicKey);
  if (fingerprint !== envelope.header.keyFingerprintSha256) {
    throw new Error('Private key does not match the backup public-key fingerprint');
  }
  let contentKey;
  try {
    contentKey = crypto.privateDecrypt(
      {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      decodeBase64(envelope.header.wrappedKey, 'wrapped key'),
    );
  } catch {
    throw new Error('Could not unwrap the backup content key');
  }
  if (contentKey.length !== 32) throw new Error('Unwrapped backup content key is invalid');

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    contentKey,
    decodeBase64(envelope.header.iv, 'IV'),
    { authTagLength: AUTH_TAG_BYTES },
  );
  decipher.setAAD(Buffer.concat([envelope.preamble, envelope.headerBuffer]));
  decipher.setAuthTag(envelope.authenticationTag);
  const counter = new HashCounter();
  const partialPath = temporaryPath(outputPath);
  let published = false;

  try {
    await pipeline(
      fs.createReadStream(inputPath, { start: envelope.ciphertextOffset }),
      decipher,
      counter,
      fs.createWriteStream(partialPath, { flags: 'wx', mode: 0o600 }),
    );
    await fsp.link(partialPath, outputPath);
    published = true;
    await fsp.unlink(partialPath);
    await fsp.chmod(outputPath, 0o600);
    const encrypted = await hashFile(inputPath);
    return {
      schemaVersion: FORMAT_VERSION,
      algorithm: ALGORITHM,
      backupType: envelope.header.backupType,
      sourceName: envelope.header.sourceName,
      createdAtUtc: envelope.header.createdAtUtc,
      keyFingerprintSha256: fingerprint,
      plaintextSha256: counter.digest(),
      plaintextBytes: counter.bytes,
      encryptedSha256: encrypted.sha256,
      encryptedBytes: encrypted.bytes,
      decryptedFile: path.basename(outputPath),
    };
  } catch (error) {
    await fsp.rm(partialPath, { force: true }).catch(() => {});
    if (published) await fsp.rm(outputPath, { force: true }).catch(() => {});
    if (error.code === 'ERR_OSSL_EVP_BAD_DECRYPT' || /authenticat/i.test(error.message)) {
      throw new Error('Backup authentication failed; the file is corrupt or has been modified');
    }
    throw error;
  } finally {
    contentKey.fill(0);
  }
};

module.exports = {
  ALGORITHM,
  FORMAT_VERSION,
  decryptFile,
  encryptStream,
  publicKeyFingerprint,
  readEnvelopeHeader,
};

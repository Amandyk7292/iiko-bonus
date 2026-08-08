const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Readable } = require('node:stream');

const {
  ALGORITHM,
  decryptFile,
  encryptStream,
  publicKeyFingerprint,
  readEnvelopeHeader,
} = require('../scripts/lib/backup-envelope');

const createKeys = () =>
  crypto.generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase: 'test-only-passphrase',
    },
  });

const keys = createKeys();
const wrongKeys = createKeys();

const createSandbox = async () => fsp.mkdtemp(path.join(os.tmpdir(), 'bulka-envelope-'));

test('backup envelope streams, authenticates and decrypts without changing bytes', async (t) => {
  const sandbox = await createSandbox();
  t.after(() => fsp.rm(sandbox, { recursive: true, force: true }));
  const plaintext = crypto.randomBytes(2 * 1024 * 1024 + 173);
  const encryptedPath = path.join(sandbox, 'database.bulka.enc');
  const restoredPath = path.join(sandbox, 'database.dump');

  const encrypted = await encryptStream({
    input: Readable.from([plaintext.subarray(0, 73), plaintext.subarray(73)]),
    outputPath: encryptedPath,
    publicKeyPem: keys.publicKey,
    backupType: 'database',
    sourceName: 'bulka-20260808T120000Z.dump',
    createdAt: new Date('2026-08-08T12:00:00.000Z'),
  });
  const header = await readEnvelopeHeader(encryptedPath);

  assert.equal(encrypted.algorithm, ALGORITHM);
  assert.equal(encrypted.selfTestAuthenticatedDecrypt, true);
  assert.equal(encrypted.plaintextBytes, plaintext.length);
  assert.equal(
    encrypted.plaintextSha256,
    crypto.createHash('sha256').update(plaintext).digest('hex'),
  );
  assert.equal(header.header.backupType, 'database');
  assert.equal(header.header.sourceName, 'bulka-20260808T120000Z.dump');
  assert.equal(
    header.header.keyFingerprintSha256,
    publicKeyFingerprint(crypto.createPublicKey(keys.publicKey)),
  );

  const restored = await decryptFile({
    inputPath: encryptedPath,
    outputPath: restoredPath,
    privateKeyPem: keys.privateKey,
    passphrase: 'test-only-passphrase',
  });
  assert.equal(restored.plaintextSha256, encrypted.plaintextSha256);
  assert.deepEqual(await fsp.readFile(restoredPath), plaintext);
  assert.equal(
    fs.readdirSync(sandbox).some((name) => name.includes('.partial-')),
    false,
  );
});

test('tampered encrypted backups fail closed and leave no plaintext or partial file', async (t) => {
  const sandbox = await createSandbox();
  t.after(() => fsp.rm(sandbox, { recursive: true, force: true }));
  const encryptedPath = path.join(sandbox, 'storage.bulka.enc');
  const restoredPath = path.join(sandbox, 'storage.tar');

  await encryptStream({
    input: Readable.from([Buffer.from('authenticated storage snapshot')]),
    outputPath: encryptedPath,
    publicKeyPem: keys.publicKey,
    backupType: 'storage',
    sourceName: 'supabase-storage-20260808T120000Z.tar',
  });
  const handle = await fsp.open(encryptedPath, 'r+');
  try {
    const stat = await handle.stat();
    const byte = Buffer.alloc(1);
    await handle.read(byte, 0, 1, stat.size - 1);
    byte[0] ^= 0xff;
    await handle.write(byte, 0, 1, stat.size - 1);
  } finally {
    await handle.close();
  }

  await assert.rejects(
    decryptFile({
      inputPath: encryptedPath,
      outputPath: restoredPath,
      privateKeyPem: keys.privateKey,
      passphrase: 'test-only-passphrase',
    }),
    /authentication failed/i,
  );
  assert.equal(fs.existsSync(restoredPath), false);
  assert.equal(
    fs.readdirSync(sandbox).some((name) => name.includes('.partial-')),
    false,
  );
});

test('wrong private key and existing outputs are rejected without overwrite', async (t) => {
  const sandbox = await createSandbox();
  t.after(() => fsp.rm(sandbox, { recursive: true, force: true }));
  const encryptedPath = path.join(sandbox, 'environment.bulka.enc');
  const restoredPath = path.join(sandbox, 'environment.env');

  await encryptStream({
    input: Readable.from([Buffer.from('SECRET=not-a-real-secret\n')]),
    outputPath: encryptedPath,
    publicKeyPem: keys.publicKey,
    backupType: 'environment',
    sourceName: 'production.env',
  });
  await assert.rejects(
    decryptFile({
      inputPath: encryptedPath,
      outputPath: restoredPath,
      privateKeyPem: wrongKeys.privateKey,
      passphrase: 'test-only-passphrase',
    }),
    /does not match/i,
  );

  await fsp.writeFile(restoredPath, 'keep-me');
  await assert.rejects(
    decryptFile({
      inputPath: encryptedPath,
      outputPath: restoredPath,
      privateKeyPem: keys.privateKey,
      passphrase: 'test-only-passphrase',
    }),
    /Refusing to overwrite/i,
  );
  assert.equal(await fsp.readFile(restoredPath, 'utf8'), 'keep-me');
});

test('weak RSA keys and path-like source names are rejected', async (t) => {
  const sandbox = await createSandbox();
  t.after(() => fsp.rm(sandbox, { recursive: true, force: true }));
  const weakKeys = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  await assert.rejects(
    encryptStream({
      input: Readable.from([Buffer.from('data')]),
      outputPath: path.join(sandbox, 'weak.bulka.enc'),
      publicKeyPem: weakKeys.publicKey,
      backupType: 'database',
      sourceName: 'database.dump',
    }),
    /at least 3072 bits/i,
  );
  await assert.rejects(
    encryptStream({
      input: Readable.from([Buffer.from('data')]),
      outputPath: path.join(sandbox, 'path.bulka.enc'),
      publicKeyPem: keys.publicKey,
      backupType: 'database',
      sourceName: '../database.dump',
    }),
    /plain filename/i,
  );
});

test('strict UTC envelope timestamps are validated before decryption', async (t) => {
  const sandbox = await createSandbox();
  t.after(() => fsp.rm(sandbox, { recursive: true, force: true }));
  const encryptedPath = path.join(sandbox, 'timestamp.bulka.enc');
  await encryptStream({
    input: Readable.from([Buffer.from('data')]),
    outputPath: encryptedPath,
    publicKeyPem: keys.publicKey,
    backupType: 'database',
    sourceName: 'database.dump',
    createdAt: new Date('2026-08-08T12:00:00.000Z'),
  });

  const contents = await fsp.readFile(encryptedPath);
  const validTimestamp = Buffer.from('2026-08-08T12:00:00.000Z');
  const invalidTimestamp = Buffer.from('2026-99-08T12:00:00.000Z');
  const timestampOffset = contents.indexOf(validTimestamp);
  assert.notEqual(timestampOffset, -1);
  invalidTimestamp.copy(contents, timestampOffset);
  await fsp.writeFile(encryptedPath, contents);
  await assert.rejects(readEnvelopeHeader(encryptedPath), /timestamp is invalid/i);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const AdmZip = require('adm-zip');
const { signRelease } = require('../scripts/sign-iiko-plugin-update.cjs');

const keys = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const unrelatedKeys = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const names = ['Resto.Front.Api.IikoBonusPlugin.dll', 'Manifest.xml', 'BulkaPluginUpdater.exe'];
const contents = {
  'Resto.Front.Api.IikoBonusPlugin.dll': Buffer.from('test-only plugin bytes'),
  'Manifest.xml': Buffer.from('<Manifest>test-only manifest bytes</Manifest>'),
  'BulkaPluginUpdater.exe': Buffer.from('test-only updater bytes'),
};
const domain = Buffer.from('BulkaPluginUpdate:v1\n', 'utf8');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function publicXml(publicKey) {
  const jwk = crypto.createPublicKey(publicKey).export({ format: 'jwk' });
  const decode = (value) => Buffer.from(value, 'base64url').toString('base64');
  return `<RSAKeyValue><Modulus>${decode(jwk.n)}</Modulus><Exponent>${decode(jwk.e)}</Exponent></RSAKeyValue>`;
}

async function fixture(t) {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), 'bulka-update-sign-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(target)), path.resolve(os.tmpdir()));
    assert.match(path.basename(target), /^bulka-update-sign-test-/);
    await fs.rm(target, { recursive: true, force: true });
  });
  const directory = path.join(target, 'files');
  await fs.mkdir(directory);
  for (const name of names) await fs.writeFile(path.join(directory, name), contents[name]);
  const keyPath = path.join(target, 'ephemeral-test-private.pem');
  const trustPath = path.join(target, 'test-trust.cs');
  await fs.writeFile(keyPath, keys.privateKey);
  await fs.writeFile(
    trustPath,
    `internal const string PublicKeyXml = "${publicXml(keys.publicKey)}";`,
  );
  const args = {
    directory,
    packagePath: path.join(target, 'BulkaPlugin-1.13.0-update.zip'),
    keyPath,
    trustPath,
    version: '1.13.0',
    sourceCommit: 'a'.repeat(40),
  };
  await storeZip(args.packagePath);
  return { ...args, target };
}

async function storeZip(packagePath, entries = contents) {
  const zip = new AdmZip();
  for (const [name, bytes] of Object.entries(entries)) zip.addFile(name, bytes);
  await fs.writeFile(packagePath, zip.toBuffer());
}

function verify(envelope, publicKey = keys.publicKey, useDomain = true) {
  const payload = Buffer.from(envelope.payloadBase64, 'base64');
  const bytes = useDomain ? Buffer.concat([domain, payload]) : payload;
  return crypto.verify(
    'RSA-SHA256',
    bytes,
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(envelope.signatureBase64, 'base64'),
  );
}

test('signer binds real ZIP bytes, exact source inventory and domain to the release envelope', async (t) => {
  const args = await fixture(t);
  const { payload, envelope } = signRelease(args);
  assert.deepEqual(
    JSON.parse(Buffer.from(envelope.payloadBase64, 'base64').toString('utf8')),
    payload,
  );
  assert.equal(envelope.algorithm, 'RSA-SHA256');
  assert.equal(envelope.keyId, 'bulka-plugin-2026');
  assert.equal(verify(envelope), true);
  assert.equal(
    verify(envelope, keys.publicKey, false),
    false,
    'signature must bind the protocol domain',
  );
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.version, args.version);
  assert.equal(payload.apiVersion, 'V9Preview7');
  assert.equal(payload.packageUrl, 'https://bulka.com.kz/downloads/BulkaPlugin-1.13.0-update.zip');
  const zipBytes = await fs.readFile(args.packagePath);
  assert.equal(payload.packageSha256, sha256(zipBytes));
  assert.equal(payload.packageSizeBytes, zipBytes.length);
  assert.deepEqual(
    payload.files,
    Object.fromEntries(names.map((name) => [name, sha256(contents[name])])),
  );
  assert.equal(payload.sourceCommit, args.sourceCommit);
  assert.equal(Number.isNaN(Date.parse(payload.publishedAt)), false);
});

test('altered payload/signature and a different public key cannot verify a signed release', async (t) => {
  const { envelope } = signRelease(await fixture(t));
  const changedPayload = JSON.parse(Buffer.from(envelope.payloadBase64, 'base64').toString('utf8'));
  changedPayload.version = '1.13.1';
  assert.equal(
    verify({
      ...envelope,
      payloadBase64: Buffer.from(JSON.stringify(changedPayload)).toString('base64'),
    }),
    false,
  );
  const changedSignature = Buffer.from(envelope.signatureBase64, 'base64');
  changedSignature[0] ^= 1;
  assert.equal(
    verify({ ...envelope, signatureBase64: changedSignature.toString('base64') }),
    false,
  );
  assert.equal(verify(envelope, unrelatedKeys.publicKey), false);
});

test('signer rejects a private key that differs from independently embedded release trust', async (t) => {
  const args = await fixture(t);
  const wrongKeyPath = path.join(args.target, 'unrelated-test-private.pem');
  await fs.writeFile(wrongKeyPath, unrelatedKeys.privateKey);
  assert.throws(() => signRelease({ ...args, keyPath: wrongKeyPath }), /match.*trust/i);
  await fs.writeFile(
    args.trustPath,
    `internal const string PublicKeyXml = "${publicXml(unrelatedKeys.publicKey)}";`,
  );
  assert.throws(() => signRelease(args), /match.*trust/i);
});

test('signer refuses missing, extra, renamed and local-data ZIP entries', async (t) => {
  const args = await fixture(t);
  const { 'BulkaPluginUpdater.exe': updater, ...withoutUpdater } = contents;
  for (const entries of [
    withoutUpdater,
    { ...contents, 'README.md': Buffer.from('extra documentation') },
    {
      ...contents,
      'Resto.Front.Api.IikoBonusPlugin.dll.config': Buffer.from(
        'must never be shipped in an update',
      ),
    },
    { ...contents, 'data/pending-receipts.json': Buffer.from('must never replace local queues') },
    { ...withoutUpdater, 'bulkapluginupdater.exe': updater },
  ]) {
    await storeZip(args.packagePath, entries);
    assert.throws(() => signRelease(args), /zip|inventory|unexpected|package/i);
  }
});

test('signer refuses ZIP content differing from the tested source files', async (t) => {
  const args = await fixture(t);
  await storeZip(args.packagePath, {
    ...contents,
    'Resto.Front.Api.IikoBonusPlugin.dll': Buffer.from('other build with same filename'),
  });
  assert.throws(() => signRelease(args), /zip|checksum|match|package/i);
  await storeZip(args.packagePath);
  await fs.writeFile(
    path.join(args.directory, 'Manifest.xml'),
    Buffer.from('source changed after archive creation'),
  );
  assert.throws(() => signRelease(args), /zip|checksum|match|package/i);
});

test('signer rejects missing, empty, invalid ZIP and packages above the 20 MiB limit', async (t) => {
  const args = await fixture(t);
  await fs.unlink(args.packagePath);
  assert.throws(() => signRelease(args), /ENOENT|not found/i);
  await fs.writeFile(args.packagePath, Buffer.alloc(0));
  assert.throws(() => signRelease(args), /size|package/i);
  await fs.writeFile(args.packagePath, Buffer.from('this is not a ZIP file'));
  assert.throws(() => signRelease(args), /zip|header|signature|package/i);
  await fs.writeFile(args.packagePath, Buffer.alloc(20 * 1024 * 1024 + 1));
  assert.throws(() => signRelease(args), /size|package/i);
});

test('signer rejects malformed source commits and noncanonical release versions', async (t) => {
  const args = await fixture(t);
  for (const sourceCommit of ['', 'HEAD', 'a'.repeat(39), 'g'.repeat(40), 'A'.repeat(40)]) {
    assert.throws(() => signRelease({ ...args, sourceCommit }), /source commit/i);
  }
  for (const version of ['1.13', '1.13.0.0', '01.13.0', '1.13.0-beta', '../1.13.0']) {
    assert.throws(() => signRelease({ ...args, version }), /release version/i);
  }
});

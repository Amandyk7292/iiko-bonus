#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { signManifest } = require('./lib/backup-signature');

const argumentValue = (name) => {
  const prefix = `--${name}=`;
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : '';
};

const main = async () => {
  const manifestPath = argumentValue('manifest');
  const outputPath = argumentValue('output');
  const privateKeyPath = argumentValue('private-key');
  const expectedFingerprint = argumentValue('expected-signing-key-fingerprint');
  if (![manifestPath, outputPath, privateKeyPath].every(path.isAbsolute) || !expectedFingerprint) {
    throw new Error(
      'Required absolute paths: --manifest --output --private-key and --expected-signing-key-fingerprint',
    );
  }
  if (path.dirname(manifestPath) !== path.dirname(outputPath)) {
    throw new Error('Manifest and detached signature must use the same directory');
  }
  const [manifestStat, privateKeyStat] = await Promise.all([
    fsp.lstat(manifestPath),
    fsp.lstat(privateKeyPath),
  ]);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error('Manifest is not regular');
  if (!privateKeyStat.isFile() || privateKeyStat.isSymbolicLink()) {
    throw new Error('Signing private key is not regular');
  }
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  const privateKeyPem = await fsp.readFile(privateKeyPath);
  const signature = signManifest({
    manifest,
    privateKeyPem,
    passphrase: process.env.BULKA_BACKUP_SIGNING_KEY_PASSPHRASE,
    expectedFingerprint,
    manifestFile: path.basename(manifestPath),
  });
  const partialPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.partial-${process.pid}-${crypto.randomBytes(8).toString('hex')}`,
  );
  let published = false;
  try {
    const handle = await fsp.open(partialPath, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(signature, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.link(partialPath, outputPath);
    published = true;
    await fsp.unlink(partialPath);
    await fsp.chmod(outputPath, 0o600);
  } catch (error) {
    await fsp.rm(partialPath, { force: true }).catch(() => {});
    if (published) await fsp.rm(outputPath, { force: true }).catch(() => {});
    throw error;
  }
  process.stdout.write(`${JSON.stringify({
    signed: true,
    algorithm: signature.algorithm,
    signingKeyFingerprintSha256: signature.signingKeyFingerprintSha256,
    canonicalManifestSha256: signature.canonicalManifestSha256,
    signatureFile: path.basename(outputPath),
  })}\n`);
};

main().catch((error) => {
  process.stderr.write(`Backup signing failed: ${error.message}\n`);
  process.exitCode = 1;
});

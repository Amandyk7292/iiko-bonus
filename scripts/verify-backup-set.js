#!/usr/bin/env node
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { verifyBackupSet } = require('./lib/backup-signature');

const argumentValue = (name) => {
  const prefix = `--${name}=`;
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : '';
};

const main = async () => {
  const manifestPath = argumentValue('manifest');
  const signaturePath = argumentValue('signature');
  const publicKeyPath = argumentValue('public-key');
  const expectedSigningFingerprint = argumentValue('expected-signing-key-fingerprint');
  const expectedEncryptionFingerprint = argumentValue('expected-encryption-key-fingerprint');
  if (
    ![manifestPath, signaturePath, publicKeyPath].every(path.isAbsolute) ||
    !expectedSigningFingerprint ||
    !expectedEncryptionFingerprint
  ) {
    throw new Error(
      'Required absolute paths: --manifest --signature --public-key plus both expected fingerprints',
    );
  }
  const publicKeyStat = await fsp.lstat(publicKeyPath);
  if (!publicKeyStat.isFile() || publicKeyStat.isSymbolicLink()) {
    throw new Error('Signing public key must be a regular file');
  }
  const result = await verifyBackupSet({
    manifestPath,
    signaturePath,
    publicKeyPem: await fsp.readFile(publicKeyPath),
    expectedSigningFingerprint,
    expectedEncryptionFingerprint,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

main().catch((error) => {
  process.stderr.write(`Backup verification failed: ${error.message}\n`);
  process.exitCode = 1;
});

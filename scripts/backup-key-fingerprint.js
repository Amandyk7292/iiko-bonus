#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { publicKeyFingerprint } = require('./lib/backup-envelope');
const {
  describeSigningKey,
  loadEncryptedSigningPrivateKey,
} = require('./lib/backup-signature');

const argumentValue = (name) => {
  const prefix = `--${name}=`;
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : '';
};

const main = async () => {
  const keyPath = argumentValue('key');
  const purpose = argumentValue('purpose');
  if (!path.isAbsolute(keyPath) || !['encryption-public', 'signing-public', 'signing-private'].includes(purpose)) {
    throw new Error('Required: --key=<absolute path> --purpose=<encryption-public|signing-public|signing-private>');
  }
  const stat = await fsp.lstat(keyPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Key must be a regular file');
  const pem = await fsp.readFile(keyPath);
  let result;
  if (purpose === 'encryption-public') {
    const key = crypto.createPublicKey(pem);
    if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength || 0) < 3072) {
      throw new Error('Encryption public key must be RSA with at least 3072 bits');
    }
    result = { purpose, algorithm: 'RSA-OAEP-SHA256', fingerprintSha256: publicKeyFingerprint(key) };
  } else if (purpose === 'signing-public') {
    const key = describeSigningKey(crypto.createPublicKey(pem));
    result = { purpose, algorithm: key.algorithm, fingerprintSha256: key.fingerprint };
  } else {
    const privateKey = loadEncryptedSigningPrivateKey(
      pem,
      process.env.BULKA_BACKUP_SIGNING_KEY_PASSPHRASE,
    );
    const key = describeSigningKey(privateKey);
    result = { purpose, algorithm: key.algorithm, fingerprintSha256: key.fingerprint };
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

main().catch((error) => {
  process.stderr.write(`Backup key inspection failed: ${error.message}\n`);
  process.exitCode = 1;
});

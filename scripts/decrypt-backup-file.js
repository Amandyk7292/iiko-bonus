#!/usr/bin/env node
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { decryptFile } = require('./lib/backup-envelope');

const readArgument = (name) => {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : '';
};

const main = async () => {
  const inputPath = readArgument('input');
  const outputPath = readArgument('output');
  const privateKeyPath = readArgument('private-key');
  if (!inputPath || !outputPath || !privateKeyPath) {
    throw new Error(
      'Required: --input=<absolute path> --output=<absolute path> --private-key=<absolute path>',
    );
  }
  if (![inputPath, outputPath, privateKeyPath].every(path.isAbsolute)) {
    throw new Error('Input, output and private-key paths must be absolute');
  }

  const privateKeyPem = await fsp.readFile(privateKeyPath);
  const result = await decryptFile({
    inputPath,
    outputPath,
    privateKeyPem,
    passphrase: process.env.BULKA_BACKUP_PRIVATE_KEY_PASSPHRASE || undefined,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

main().catch((error) => {
  process.stderr.write(`Backup decryption failed: ${error.message}\n`);
  process.exitCode = 1;
});

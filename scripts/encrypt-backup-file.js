#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { encryptStream } = require('./lib/backup-envelope');

const readArgument = (name) => {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : '';
};

const main = async () => {
  const inputPath = readArgument('input');
  const outputPath = readArgument('output');
  const publicKeyPath = readArgument('public-key');
  const backupType = readArgument('type');
  const sourceName = readArgument('source-name');
  if (!inputPath || !outputPath || !publicKeyPath || !backupType || !sourceName) {
    throw new Error(
      'Required: --input=<path|-> --output=<absolute path> --public-key=<path> --type=<type> --source-name=<name>',
    );
  }
  if (!path.isAbsolute(outputPath) || !path.isAbsolute(publicKeyPath)) {
    throw new Error('Output and public-key paths must be absolute');
  }
  if (inputPath !== '-' && !path.isAbsolute(inputPath)) {
    throw new Error('Input path must be absolute or - for stdin');
  }

  const publicKeyPem = await fsp.readFile(publicKeyPath);
  const input = inputPath === '-' ? process.stdin : fs.createReadStream(inputPath);
  const result = await encryptStream({
    input,
    inputPath,
    outputPath,
    publicKeyPem,
    backupType,
    sourceName,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

main().catch((error) => {
  process.stderr.write(`Backup encryption failed: ${error.message}\n`);
  process.exitCode = 1;
});

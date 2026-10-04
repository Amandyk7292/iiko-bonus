#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

function signRelease({ directory, packagePath, keyPath, version, sourceCommit, trustPath }) {
  if (typeof version !== 'string' || version.trim() !== version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('Invalid release version');
  }
  if (typeof sourceCommit !== 'string' || sourceCommit.length !== 40 || !/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Invalid source commit');
  const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath));
  const publicJwk = crypto.createPublicKey(privateKey).export({ format: 'jwk' });
  const toBase64 = (value) => Buffer.from(value, 'base64url').toString('base64');
  const publicXml = `<RSAKeyValue><Modulus>${toBase64(publicJwk.n)}</Modulus><Exponent>${toBase64(publicJwk.e)}</Exponent></RSAKeyValue>`;
  if (privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails.modulusLength < 2048 ||
      !fs.readFileSync(trustPath, 'utf8').includes(`PublicKeyXml = "${publicXml}"`)) {
    throw new Error('Signing key does not match embedded release trust');
  }
  const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
  const packageBytes = fs.readFileSync(packagePath);
  if (packageBytes.length < 1 || packageBytes.length > 20 * 1024 * 1024) throw new Error('Invalid package size');
  const files = Object.fromEntries([
    'Resto.Front.Api.IikoBonusPlugin.dll', 'Manifest.xml', 'BulkaPluginUpdater.exe',
  ].map((name) => [name, hash(fs.readFileSync(path.join(directory, name)))]));
  const entries = new AdmZip(packageBytes).getEntries();
  const seen = new Set();
  let expandedBytes = 0;
  for (const entry of entries) {
    if (entry.isDirectory || !Object.hasOwn(files, entry.entryName) || seen.has(entry.entryName)) {
      throw new Error('Package inventory differs from release files');
    }
    expandedBytes += entry.header.size;
    if (expandedBytes > 20 * 1024 * 1024) throw new Error('Expanded package exceeds limit');
    const data = entry.getData();
    if (data.length !== entry.header.size || hash(data) !== files[entry.entryName]) {
      throw new Error('Package file differs from built file');
    }
    seen.add(entry.entryName);
  }
  if (seen.size !== 3) throw new Error('Package inventory is incomplete');
  const payload = {
    schemaVersion: 1, version, apiVersion: 'V9Preview7',
    packageUrl: `https://bulka.com.kz/downloads/BulkaPlugin-${version}-update.zip`,
    packageSha256: hash(packageBytes), packageSizeBytes: packageBytes.length,
    files, sourceCommit, publishedAt: new Date().toISOString(),
  };
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signed = Buffer.concat([Buffer.from('BulkaPluginUpdate:v1\n', 'utf8'), bytes]);
  const signature = crypto.sign('RSA-SHA256', signed, { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING });
  if (!crypto.verify('RSA-SHA256', signed, crypto.createPublicKey(privateKey), signature)) {
    throw new Error('Release signature verification failed');
  }
  return {
    payload,
    envelope: {
      algorithm: 'RSA-SHA256', keyId: 'bulka-plugin-2026',
      payloadBase64: bytes.toString('base64'), signatureBase64: signature.toString('base64'),
    },
  };
}

if (require.main === module) {
  try {
    const [directory, packagePath, keyPath, version, sourceCommit, trustPath] = process.argv.slice(2);
    const { payload, envelope } = signRelease({ directory, packagePath, keyPath, version, sourceCommit, trustPath });
    fs.writeFileSync(packagePath.replace(/\.zip$/, '.manifest.json'), `${JSON.stringify(envelope, null, 2)}\n`, { flag: 'wx' });
    fs.writeFileSync(`${packagePath}.sha256`, `${payload.packageSha256}  ${path.basename(packagePath)}\n`, { flag: 'wx' });
    console.log(`Signed plugin ${version}: ${payload.packageSizeBytes} bytes, SHA256 ${payload.packageSha256}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { signRelease };

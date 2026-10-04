const fs = require('node:fs/promises');
const path = require('node:path');
const { z } = require('zod');
const { supabase } = require('../config/supabase');
const { getPolicy } = require('./pos-health.service');

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
const versionPattern = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const base64Schema = z
  .string()
  .min(4)
  .max(MAX_MANIFEST_BYTES)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const envelopeSchema = z
  .object({
    algorithm: z.literal('RSA-SHA256'),
    keyId: z.literal('bulka-plugin-2026'),
    payloadBase64: base64Schema,
    signatureBase64: base64Schema,
  })
  .strict();
const payloadSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string().regex(versionPattern),
  apiVersion: z.literal('V9Preview7'),
  packageUrl: z.string(),
  packageSha256: hashSchema,
  packageSizeBytes: z.number().int().min(1).max(MAX_PACKAGE_BYTES),
  files: z
    .object({
      'Resto.Front.Api.IikoBonusPlugin.dll': hashSchema,
      'Manifest.xml': hashSchema,
      'BulkaPluginUpdater.exe': hashSchema,
    })
    .strict(),
});

const unavailable = () =>
  Object.assign(new Error('Обновление плагина пока не опубликовано.'), {
    statusCode: 503,
    code: 'UPDATE_RELEASE_UNAVAILABLE',
  });

function decodeBase64(value) {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) throw unavailable();
  return decoded;
}

function validateEnvelope(value, expectedVersion) {
  const envelope = envelopeSchema.parse(value);
  const payloadBytes = decodeBase64(envelope.payloadBase64);
  const signature = decodeBase64(envelope.signatureBase64);
  if (signature.length < 256 || signature.length > 1024) throw unavailable();
  const payload = payloadSchema.parse(JSON.parse(payloadBytes.toString('utf8')));
  if (
    payload.version !== expectedVersion ||
    payload.packageUrl !==
      `https://bulka.com.kz/downloads/BulkaPlugin-${expectedVersion}-update.zip`
  ) {
    throw unavailable();
  }
  // Shape checks here are not a signature verification. The updater verifies
  // these exact payload bytes with its independently pinned public key.
  return envelope;
}

async function readBoundedManifest(manifestPath) {
  const file = await fs.open(manifestPath, 'r');
  try {
    const stats = await file.stat();
    if (!stats.isFile() || stats.size < 1 || stats.size > MAX_MANIFEST_BYTES) throw unavailable();
    const buffer = Buffer.alloc(MAX_MANIFEST_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_MANIFEST_BYTES || bytesRead !== stats.size) throw unavailable();
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
  } finally {
    await file.close();
  }
}

async function getLatestPluginUpdate(
  db = supabase,
  downloadsDirectory = path.join(process.cwd(), 'public', 'downloads'),
) {
  const policy = await getPolicy(db);
  const version = policy.latestVersion;
  if (
    !versionPattern.test(version) ||
    policy.downloadUrl !== `/downloads/BulkaPlugin-${version}-update.zip`
  ) {
    throw unavailable();
  }
  const manifestPath = path.join(downloadsDirectory, `BulkaPlugin-${version}-update.manifest.json`);
  try {
    return validateEnvelope(await readBoundedManifest(manifestPath), version);
  } catch {
    throw unavailable();
  }
}

module.exports = { getLatestPluginUpdate };

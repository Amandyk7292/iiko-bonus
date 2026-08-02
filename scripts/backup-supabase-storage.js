#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fsp = require('fs/promises');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const MAX_OBJECTS = 100_000;
const PAGE_SIZE = 1_000;

const argumentValue = (name) => {
  const prefix = `--${name}=`;
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : '';
};

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
};

const timestamp = () =>
  new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

const encodedSegment = (value) => Buffer.from(String(value), 'utf8').toString('base64url');

const objectFilePath = (snapshotRoot, bucket, objectName) => {
  const segments = String(objectName).split('/').filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Unsafe object name in bucket ${bucket}`);
  }
  const target = path.resolve(
    snapshotRoot,
    'objects',
    encodedSegment(bucket),
    ...segments.map(encodedSegment),
  );
  const objectRoot = `${path.resolve(snapshotRoot, 'objects')}${path.sep}`;
  if (!target.startsWith(objectRoot)) throw new Error('Resolved object path escaped the snapshot');
  return target;
};

const listObjects = async (client, bucket) => {
  const objects = [];
  const queue = [''];
  const visited = new Set();

  while (queue.length) {
    const prefix = queue.shift();
    if (visited.has(prefix)) continue;
    visited.add(prefix);
    let offset = 0;

    for (;;) {
      const { data, error } = await client.storage.from(bucket).list(prefix, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw new Error(`Could not list ${bucket}/${prefix}: ${error.message}`);
      const rows = Array.isArray(data) ? data : [];
      for (const row of rows) {
        const objectName = prefix ? `${prefix}/${row.name}` : row.name;
        if (row.id || row.metadata) {
          objects.push({
            name: objectName,
            expectedBytes: Number(row.metadata?.size || 0),
            contentType: String(row.metadata?.mimetype || ''),
          });
          if (objects.length > MAX_OBJECTS) {
            throw new Error(`Storage backup exceeds the ${MAX_OBJECTS} object safety limit`);
          }
        } else if (row.name) {
          queue.push(objectName);
        }
      }
      if (rows.length < PAGE_SIZE) break;
      offset += rows.length;
    }
  }

  return objects;
};

const backupStorage = async () => {
  if (process.argv.includes('--env-stdin')) {
    const parsed = dotenv.parse(await readStdin());
    for (const [key, value] of Object.entries(parsed)) process.env[key] = value;
  } else {
    dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || '.env' });
  }

  const outputRootValue = argumentValue('output');
  if (!outputRootValue || !path.isAbsolute(outputRootValue)) {
    throw new Error('Use --output with an absolute backup directory');
  }
  const outputRoot = path.resolve(outputRootValue);
  const filesystemRoot = path.parse(outputRoot).root;
  if (outputRoot === filesystemRoot) throw new Error('Refusing to use a filesystem root');

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const snapshotName = `supabase-storage-${timestamp()}`;
  const partialRoot = path.join(outputRoot, `${snapshotName}.partial`);
  const snapshotRoot = path.join(outputRoot, snapshotName);
  await fsp.mkdir(outputRoot, { recursive: true, mode: 0o700 });
  await fsp.mkdir(partialRoot, { recursive: false });

  const { data: buckets, error: bucketsError } = await client.storage.listBuckets();
  if (bucketsError) throw new Error(`Could not list storage buckets: ${bucketsError.message}`);

  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    source: new URL(supabaseUrl).hostname,
    buckets: [],
    totalFiles: 0,
    totalBytes: 0,
  };

  for (const bucket of buckets || []) {
    const objects = await listObjects(client, bucket.name);
    const bucketManifest = {
      name: bucket.name,
      public: bucket.public === true,
      files: [],
      totalBytes: 0,
    };

    for (const object of objects) {
      const { data, error } = await client.storage.from(bucket.name).download(object.name);
      if (error || !data) {
        throw new Error(`Could not download ${bucket.name}/${object.name}: ${error?.message}`);
      }
      const buffer = Buffer.from(await data.arrayBuffer());
      if (object.expectedBytes > 0 && buffer.length !== object.expectedBytes) {
        throw new Error(`Size mismatch for ${bucket.name}/${object.name}`);
      }
      const target = objectFilePath(partialRoot, bucket.name, object.name);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, buffer, { flag: 'wx', mode: 0o600 });
      const relativePath = path.relative(partialRoot, target).split(path.sep).join('/');
      bucketManifest.files.push({
        name: object.name,
        path: relativePath,
        bytes: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        contentType: object.contentType,
      });
      bucketManifest.totalBytes += buffer.length;
      manifest.totalFiles += 1;
      manifest.totalBytes += buffer.length;
    }
    manifest.buckets.push(bucketManifest);
  }

  await fsp.writeFile(
    path.join(partialRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  await fsp.rename(partialRoot, snapshotRoot);

  process.stdout.write(
    `${JSON.stringify({
      snapshot: snapshotRoot,
      files: manifest.totalFiles,
      bytes: manifest.totalBytes,
      buckets: manifest.buckets.length,
    })}\n`,
  );
};

backupStorage().catch((error) => {
  process.stderr.write(`Storage backup failed: ${error.message}\n`);
  process.exitCode = 1;
});

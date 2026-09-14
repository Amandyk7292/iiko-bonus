const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const fetch = require('node-fetch');
const sharp = require('sharp');
const root = path.join(process.env.PUBLIC_IMAGE_CACHE_DIR || os.tmpdir(), 'bulka-images-v1');
const edges = new Set([256, 384, 512, 768, 1024, 1536]);
const pending = new Map();
const TTL = 7 * 86400000;
let active = 0;
const queue = [];
let lastCleanup = 0;
const failure = (statusCode) => Object.assign(new Error('Image unavailable'), { statusCode });
function sourceUrl(objectPath) {
  if (
    typeof objectPath !== 'string' ||
    objectPath.length > 500 ||
    !/^(?:menu_images|stories)\/[A-Za-z0-9_./ -]+$/.test(objectPath) ||
    objectPath.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw failure(400);
  const base = new URL(process.env.SUPABASE_URL);
  if (base.protocol !== 'https:') throw failure(503);
  return new URL(
    '/storage/v1/object/public/' + objectPath.split('/').map(encodeURIComponent).join('/'),
    base,
  ).href;
}
async function cleanup() {
  if (Date.now() - lastCleanup < 3600000) return;
  lastCleanup = Date.now();
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => /^[a-f0-9]{64}\.webp$/.test(entry.name))
      .map(async (entry) => {
        const file = path.join(root, entry.name);
        return { file, ...(await fs.stat(file)) };
      }),
  );
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  let bytes = 0;
  for (const file of files) {
    bytes += file.size;
    if (Date.now() - file.mtimeMs > TTL || bytes > 512 * 1024 * 1024)
      await fs.unlink(file.file).catch(() => {});
  }
}
async function publicImage(objectPath, edge) {
  if (!edges.has(edge)) throw failure(400);
  const url = sourceUrl(objectPath);
  const key = crypto
    .createHash('sha256')
    .update(url + ':' + edge)
    .digest('hex');
  const file = path.join(root, key + '.webp');
  try {
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs < TTL) {
      const buffer = await fs.readFile(file);
      return { buffer, key: crypto.createHash('sha256').update(buffer).digest('hex') };
    }
  } catch (_) {
    /* A missing variant is generated below. */
  }
  if (pending.has(key)) return pending.get(key);
  if (pending.size >= 32) throw failure(503);
  const task = (async () => {
    if (active >= 3) await new Promise((resolve) => queue.push(resolve));
    else active++;
    try {
      const response = await fetch(url, {
        redirect: 'error',
        timeout: 15000,
        size: 12 * 1024 * 1024,
      });
      if (!response.ok) throw failure(404);
      const original = await response.buffer();
      const options = { limitInputPixels: 32 * 1024 * 1024, failOn: 'error' };
      const metadata = await sharp(original, options).metadata();
      if ((metadata.pages || 1) !== 1) throw failure(400);
      let buffer = await sharp(original, options)
        .rotate()
        .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
        .webp({ lossless: true, effort: 4 })
        .toBuffer();
      if (metadata.format === 'webp' && original.length < buffer.length) buffer = original;
      await fs.mkdir(root, { recursive: true });
      const temporary = file + '.' + process.pid + '.tmp';
      await fs.writeFile(temporary, buffer);
      await fs.rename(temporary, file);
      void cleanup().catch(() => {});
      return { buffer, key: crypto.createHash('sha256').update(buffer).digest('hex') };
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  })();
  pending.set(key, task);
  try {
    return await task;
  } finally {
    pending.delete(key);
  }
}
module.exports = { publicImage, sourceUrl };

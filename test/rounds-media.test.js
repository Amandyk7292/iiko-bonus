const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const sharp = require('sharp');
const {
  detectMedia,
  validateVideo,
  uploadMedia,
  safeFile,
  removeFile,
  sendMedia,
} = require('../src/services/rounds-media.service');
let root, previousRoot;
test.before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'bulka-rounds-test-'));
  previousRoot = process.env.BULKA_ROUNDS_MEDIA_DIR;
  process.env.BULKA_ROUNDS_MEDIA_DIR = root;
});
test.after(async () => {
  for (const name of await fs.readdir(root)) await fs.unlink(path.join(root, name));
  await fs.rmdir(root);
  if (previousRoot === undefined) delete process.env.BULKA_ROUNDS_MEDIA_DIR;
  else process.env.BULKA_ROUNDS_MEDIA_DIR = previousRoot;
});
test('media contents must agree with declared type and paths cannot escape private storage', async () => {
  assert.throws(() => detectMedia(Buffer.from('<svg>not-a-photo</svg>'), 'image/jpeg'));
  const jpeg = await sharp({ create: { width: 4, height: 6, channels: 3, background: '#fff' } })
    .jpeg()
    .toBuffer();
  assert.equal(detectMedia(jpeg, 'image/jpeg').kind, 'photo');
  assert.throws(() => detectMedia(jpeg, 'video/mp4'));
  assert.throws(() => safeFile('../../outside.jpg'), { statusCode: 404 });
});
test('photo is orientation-normalized with metadata removed, and DB failure removes disk file', async () => {
  const input = await sharp({
    create: { width: 12, height: 20, channels: 3, background: '#ffc000' },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  let saved;
  const service = {
    staffTask: async () => ({ task: { evidence_type: 'photo', completed_at: null } }),
    registerMedia: async (_actor, _task, value) => {
      saved = value;
      return value;
    },
  };
  await uploadMedia(service, {}, 'task', { buffer: input, mimetype: 'image/jpeg' });
  const output = await sharp(safeFile(saved.fileName)).metadata();
  assert.equal(output.width, 20);
  assert.equal(output.height, 12);
  assert.equal(output.orientation, undefined);
  await removeFile(saved.fileName);
  service.registerMedia = async () => {
    throw new Error('DB failed');
  };
  await assert.rejects(
    uploadMedia(service, {}, 'task', { buffer: input, mimetype: 'image/jpeg' }),
    /DB failed/,
  );
  assert.deepEqual(await fs.readdir(root), []);
});
test('completed task and wrong required evidence reject before writing files', async () => {
  const input = Buffer.alloc(20);
  input[0] = 0xff;
  input[1] = 0xd8;
  const upload = { buffer: input, mimetype: 'image/jpeg' };
  const completed = {
    staffTask: async () => ({ task: { completed_at: new Date(), evidence_type: 'photo' } }),
  };
  await assert.rejects(uploadMedia(completed, {}, 'task', upload), { statusCode: 409 });
  const videoOnly = {
    staffTask: async () => ({ task: { completed_at: null, evidence_type: 'video' } }),
  };
  await assert.rejects(uploadMedia(videoOnly, {}, 'task', upload), /не подходит/);
  assert.deepEqual(await fs.readdir(root), []);
});
function processMock(progress, code = 0, stderr = '') {
  let args;
  return {
    get args() {
      return args;
    },
    spawn: (_binary, received) => {
      args = received;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {};
      process.nextTick(() => {
        child.stdout.write(progress);
        if (stderr) child.stderr.write(stderr);
        child.emit('close', code);
      });
      return child;
    },
  };
}
test('video validator decodes video stream, bounds protocols/runtime and rejects excess duration or corrupt content', async () => {
  const good = processMock('frame=90\nout_time_us=3000000\nprogress=end\n');
  assert.equal(await validateVideo('/private/clip.mp4', 'mov', { spawnProcess: good.spawn }), 3);
  assert.ok(good.args.includes('0:v:0'));
  assert.ok(good.args.includes('file,pipe'));
  assert.ok(good.args.includes('61'));
  const long = processMock('out_time_us=61000000\n');
  await assert.rejects(
    validateVideo('/private/clip.mp4', 'mov', { spawnProcess: long.spawn }),
    /60 секунд/,
  );
  const bad = processMock('out_time_us=1000000\n', 1, 'invalid video');
  await assert.rejects(
    validateVideo('/private/clip.mp4', 'mov', { spawnProcess: bad.spawn }),
    /повреждено/,
  );
  const audioOnly = processMock('out_time_us=0\n', 0);
  await assert.rejects(
    validateVideo('/private/clip.mp4', 'mov', { spawnProcess: audioOnly.spawn }),
    /повреждено/,
  );
});
test('stuck decoder is killed on timeout and does not retain its concurrency slot', async () => {
  let killed = false;
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      killed = true;
      process.nextTick(() => child.emit('close', 1));
    };
    return child;
  };
  await assert.rejects(
    validateVideo('/private/clip.webm', 'matroska', { spawnProcess, timeoutMs: 5 }),
    /слишком сложное/,
  );
  assert.equal(killed, true);
  const good = processMock('frame=30\nout_time_us=1000000\n');
  assert.equal(
    await validateVideo('/private/clip.webm', 'matroska', { spawnProcess: good.spawn }),
    1,
  );
});
test('real FFmpeg accepts a camera-like MP4 and rejects a clip longer than one minute', async () => {
  for (const seconds of [1, 65]) {
    const fileName = `${randomUUID()}.mp4`,
      file = safeFile(fileName);
    execFileSync(
      require('ffmpeg-static'),
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=yellow:size=64x96:rate=2',
        '-t',
        String(seconds),
        '-c:v',
        'libx264',
        '-threads',
        '1',
        '-pix_fmt',
        'yuv420p',
        file,
      ],
      { windowsHide: true, timeout: 10000 },
    );
    try {
      if (seconds === 1) assert.equal(await validateVideo(file, 'mov'), 1);
      else await assert.rejects(validateVideo(file, 'mov'), /60 секунд/);
    } finally {
      await removeFile(fileName);
    }
  }
});
test('private video streaming supports byte ranges only after authorization', async () => {
  const fileName = `${randomUUID()}.mp4`;
  await fs.writeFile(
    safeFile(fileName),
    Buffer.from(Array.from({ length: 100 }, (_v, index) => index)),
  );
  const app = express();
  app.get('/private', async (req, res, next) => {
    const service = {
      readMedia: async () => {
        if (req.headers.authorization !== 'test-authorized')
          throw Object.assign(new Error('Not found'), { statusCode: 404 });
        return { file_name: fileName, mime: 'video/mp4' };
      },
    };
    try {
      await sendMedia(service, {}, 'media', false, res, next);
    } catch (error) {
      next(error);
    }
  });
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ error: error.message }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/private`;
  try {
    assert.equal((await fetch(url, { headers: { range: 'bytes=10-19' } })).status, 404);
    const response = await fetch(url, {
      headers: { authorization: 'test-authorized', range: 'bytes=10-19' },
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 10-19/100');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(
      [...new Uint8Array(await response.arrayBuffer())],
      [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await removeFile(fileName);
  }
});

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const sharp = require('sharp');
const { fail } = require('./rounds-access.service');
const MAX_BYTES = 8 * 1024 * 1024;
const mediaRoot = () =>
  path.resolve(process.env.BULKA_ROUNDS_MEDIA_DIR || path.join(__dirname, '../../storage/rounds'));
const mime = (value) =>
  String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
function detectMedia(buffer, declared) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > MAX_BYTES)
    throw fail('Материал должен быть не больше 8 МБ');
  const type = mime(declared);
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && type === 'image/jpeg')
    return { kind: 'photo', mime: 'image/jpeg', extension: 'jpg' };
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp' && type === 'video/mp4')
    return { kind: 'video', mime: 'video/mp4', extension: 'mp4', format: 'mov' };
  if (buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) && type === 'video/webm')
    return { kind: 'video', mime: 'video/webm', extension: 'webm', format: 'matroska' };
  throw fail('Снимите фото JPEG или видео MP4/WebM');
}
let videoProcesses = 0;
function validateVideo(file, format, { spawnProcess = spawn, timeoutMs = 30000 } = {}) {
  if (videoProcesses >= 2)
    return Promise.reject(
      fail('Обработка видео занята. Повторите через минуту', 503, 'ROUNDS_VIDEO_BUSY'),
    );
  videoProcesses += 1;
  return new Promise((resolve, reject) => {
    let settled = false,
      progress = '',
      diagnostics = '',
      duration = 0,
      lastFrameTime = 0,
      frames = 0,
      frameRate = 0,
      rejection = null,
      timer,
      child;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      videoProcesses -= 1;
      if (error) reject(error);
      else resolve(duration);
    };
    const terminate = (error) => {
      if (settled || rejection) return;
      rejection = error;
      clearTimeout(timer);
      child.kill('SIGKILL');
      // Keep the decoder slot and file alive until its handle closes.
      timer = setTimeout(() => finish(error), 2000);
    };
    const updateDuration = () => {
      duration = Math.max(duration, lastFrameTime + (frameRate > 0 ? 1 / frameRate : 0));
      if (duration > 60.2) {
        terminate(fail('Видео должно быть не длиннее 60 секунд'));
      }
    };
    try {
      child = spawnProcess(
        process.env.FFMPEG_PATH || require('ffmpeg-static') || 'ffmpeg',
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'info',
          '-xerror',
          '-max_alloc',
          '67108864',
          '-max_pixels',
          '8294400',
          '-threads',
          '1',
          '-protocol_whitelist',
          'file,pipe',
          '-f',
          format,
          '-i',
          file,
          '-map',
          '0:v:0',
          '-an',
          '-t',
          '61',
          '-progress',
          'pipe:1',
          '-f',
          'null',
          '-',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
      );
    } catch (_error) {
      finish(fail('Обработка видео недоступна', 503, 'ROUNDS_VIDEO_UNAVAILABLE'));
      return;
    }
    timer = setTimeout(() => {
      terminate(fail('Видео слишком сложное для обработки. Запишите короткое видео'));
    }, timeoutMs);
    child.on('error', () =>
      finish(fail('Обработка видео недоступна', 503, 'ROUNDS_VIDEO_UNAVAILABLE')),
    );
    child.stderr.on('data', (chunk) => {
      if (diagnostics.length < 8192)
        diagnostics += chunk.toString().slice(0, 8192 - diagnostics.length);
      const time = diagnostics.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (time)
        duration = Math.max(
          duration,
          Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]),
        );
      const fps = diagnostics.match(/([\d.]+) fps/);
      if (fps && Number(fps[1]) > 0 && Number(fps[1]) <= 240) frameRate = Number(fps[1]);
      updateDuration();
    });
    child.stdout.on('data', (chunk) => {
      progress += chunk.toString();
      const lines = progress.split('\n');
      progress = lines.pop().slice(-200);
      for (const line of lines) {
        const match = line.match(/^out_time_us=(\d+)$/);
        if (match) lastFrameTime = Math.max(lastFrameTime, Number(match[1]) / 1000000);
        const frame = line.match(/^frame=(\d+)$/);
        if (frame) frames = Math.max(frames, Number(frame[1]));
      }
      updateDuration();
    });
    child.on('close', (code) => {
      if (rejection) finish(rejection);
      else if (code !== 0 || duration <= 0 || frames < 1)
        finish(fail('Видео повреждено или не читается. Запишите его ещё раз'));
      else finish();
    });
  });
}
const safeFile = (fileName) => {
  if (!/^[a-f0-9-]{36}\.(jpg|mp4|webm)$/.test(String(fileName)))
    throw fail('Материал не найден', 404, 'ROUNDS_NOT_FOUND');
  return path.join(mediaRoot(), fileName);
};
async function removeFile(fileName) {
  await fsp.unlink(safeFile(fileName)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
async function uploadMedia(service, actor, taskId, upload) {
  const { task } = await service.staffTask(actor, taskId);
  if (task.completed_at) throw fail('Задание уже сдано', 409, 'ROUNDS_TASK_COMPLETED');
  const type = detectMedia(upload?.buffer, upload?.mimetype);
  if (![type.kind, 'photo_video'].includes(task.evidence_type))
    throw fail('Этот материал не подходит к заданию');
  const id = crypto.randomUUID(),
    fileName = `${id}.${type.extension}`;
  await fsp.mkdir(mediaRoot(), { recursive: true, mode: 0o700 });
  const file = safeFile(fileName);
  let buffer = upload.buffer;
  try {
    if (type.kind === 'photo') {
      const image = sharp(buffer, { limitInputPixels: 32_000_000, failOn: 'error' });
      const metadata = await image.metadata();
      if (metadata.format !== 'jpeg') throw fail('Снимите фото JPEG');
      buffer = await image
        .rotate()
        .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 86 })
        .toBuffer();
    }
    await fsp.writeFile(file, buffer, { flag: 'wx', mode: 0o600 });
    if (type.kind === 'video') await validateVideo(file, type.format);
    return {
      media: await service.registerMedia(actor, taskId, {
        id,
        fileName,
        ...type,
        bytes: buffer.length,
      }),
    };
  } catch (error) {
    await fsp.unlink(file).catch(() => {});
    if (error.statusCode || !/sharp|jpeg|corrupt|unsupported|premature/i.test(error.message || ''))
      throw error;
    throw fail('Фото повреждено. Снимите его ещё раз');
  }
}
async function sendMedia(service, actor, id, admin, res, next) {
  const m = await service.readMedia(actor, id, admin);
  const file = safeFile(m.file_name);
  const stat = await fsp.lstat(file).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink())
    throw fail('Материал не найден', 404, 'ROUNDS_NOT_FOUND');
  res.set({
    'Cache-Control': 'private, no-store',
    'Content-Type': m.mime,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename="${m.file_name}"`,
  });
  // Express sendFile supplies byte ranges for seeking private videos.
  res.sendFile(file, { dotfiles: 'deny', cacheControl: false }, (error) => {
    if (error && !res.headersSent) next(error);
    else if (error) res.destroy();
  });
}
module.exports = {
  MAX_BYTES,
  detectMedia,
  validateVideo,
  uploadMedia,
  sendMedia,
  removeFile,
  safeFile,
};

const { spawn } = require('node:child_process');

const MAX_VOICE_NOTE_BYTES = 8 * 1024 * 1024;
const MAX_VOICE_NOTE_SECONDS = 120;
const MAX_TRANSCODED_BYTES = 2 * 1024 * 1024;

const containerMimeTypes = {
  webm: new Set(['audio/webm']),
  ogg: new Set(['audio/ogg', 'application/ogg']),
  mp4: new Set(['audio/mp4', 'audio/x-m4a']),
};

function voiceNoteError(message, statusCode = 400, code = 'WHATSAPP_INVALID_AUDIO') {
  return Object.assign(new Error(message), { statusCode, code });
}

function normalizedMimeType(value) {
  return String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

function resolveFfmpegPath() {
  if (String(process.env.FFMPEG_PATH || '').trim()) return String(process.env.FFMPEG_PATH).trim();
  try {
    return require('ffmpeg-static') || 'ffmpeg';
  } catch (_error) {
    return 'ffmpeg';
  }
}

function detectVoiceNoteContainer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm';
  if (buffer.subarray(0, 4).toString('ascii') === 'OggS') return 'ogg';
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'mp4';
  return null;
}

function validateVoiceNoteUpload(buffer, declaredMimeType = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16 || buffer.length > MAX_VOICE_NOTE_BYTES) {
    throw voiceNoteError('Голосовое должно быть не больше 8 МБ');
  }
  const container = detectVoiceNoteContainer(buffer);
  if (!container) {
    throw voiceNoteError('Поддерживаются голосовые WebM, OGG и M4A');
  }
  const mimeType = normalizedMimeType(declaredMimeType);
  if (mimeType && !containerMimeTypes[container].has(mimeType)) {
    throw voiceNoteError('Формат голосового не совпадает с содержимым файла');
  }
  return { container, mimeType };
}

function normalizeVoiceNoteDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VOICE_NOTE_SECONDS + 1) {
    throw voiceNoteError('Голосовое должно длиться от 1 секунды до 2 минут');
  }
  return Math.max(1, Math.min(MAX_VOICE_NOTE_SECONDS, Math.round(duration)));
}

function transcodeVoiceNote(
  input,
  {
    declaredMimeType = '',
    ffmpegPath = resolveFfmpegPath(),
    spawnProcess = spawn,
    timeoutMs = 25_000,
  } = {},
) {
  validateVoiceNoteUpload(input, declaredMimeType);
  return new Promise((resolve, reject) => {
    let settled = false;
    let outputBytes = 0;
    let timeout = null;
    const output = [];
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (error) reject(error);
      else resolve(value);
    };

    let child;
    try {
      child = spawnProcess(
        ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          'pipe:0',
          '-t',
          String(MAX_VOICE_NOTE_SECONDS),
          '-vn',
          '-map_metadata',
          '-1',
          '-ac',
          '1',
          '-ar',
          '48000',
          '-c:a',
          'libopus',
          '-b:a',
          '32k',
          '-vbr',
          'on',
          '-application',
          'voip',
          '-f',
          'ogg',
          'pipe:1',
        ],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
      );
    } catch (_error) {
      finish(
        voiceNoteError(
          'Аудиоконвертер временно недоступен',
          503,
          'WHATSAPP_AUDIO_CONVERTER_UNAVAILABLE',
        ),
      );
      return;
    }

    timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(
        voiceNoteError(
          'Обработка голосового заняла слишком много времени',
          503,
          'WHATSAPP_AUDIO_TRANSCODE_TIMEOUT',
        ),
      );
    }, timeoutMs);

    child.on('error', (error) => {
      finish(
        voiceNoteError(
          error?.code === 'ENOENT'
            ? 'Аудиоконвертер временно недоступен'
            : 'Не удалось запустить обработку голосового',
          503,
          'WHATSAPP_AUDIO_CONVERTER_UNAVAILABLE',
        ),
      );
    });
    child.stderr.resume();
    child.stdout.on('data', (chunk) => {
      if (settled) return;
      outputBytes += chunk.length;
      if (outputBytes > MAX_TRANSCODED_BYTES) {
        child.kill('SIGKILL');
        finish(voiceNoteError('Голосовое получилось слишком большим'));
        return;
      }
      output.push(chunk);
    });
    child.on('close', (code) => {
      if (settled) return;
      const result = Buffer.concat(output);
      if (code !== 0 || result.length < 16 || result.subarray(0, 4).toString('ascii') !== 'OggS') {
        finish(voiceNoteError('Не удалось прочитать запись с микрофона'));
        return;
      }
      finish(null, result);
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

module.exports = {
  MAX_VOICE_NOTE_BYTES,
  MAX_VOICE_NOTE_SECONDS,
  detectVoiceNoteContainer,
  normalizeVoiceNoteDuration,
  resolveFfmpegPath,
  transcodeVoiceNote,
  validateVoiceNoteUpload,
};

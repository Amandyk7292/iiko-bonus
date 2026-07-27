const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  MAX_VOICE_NOTE_BYTES,
  detectVoiceNoteContainer,
  normalizeVoiceNoteDuration,
  resolveFfmpegPath,
  transcodeVoiceNote,
  validateVoiceNoteUpload,
} = require('../src/services/voice-note.service');

const webmVoice = () => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)]);

function fakeFfmpeg(result = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64, 2)])) {
  let invocation = null;
  const spawnProcess = (command, args, options) => {
    invocation = { command, args, options };
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => undefined;
    child.stdin.once('finish', () => {
      child.stdout.write(result);
      child.stdout.end();
      child.emit('close', 0);
    });
    return child;
  };
  return { spawnProcess, invocation: () => invocation };
}

test('voice note upload accepts only matching WebM, OGG and M4A signatures', () => {
  assert.equal(detectVoiceNoteContainer(webmVoice()), 'webm');
  assert.equal(
    detectVoiceNoteContainer(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(32)])),
    'ogg',
  );
  assert.equal(
    detectVoiceNoteContainer(
      Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.alloc(32)]),
    ),
    'mp4',
  );
  assert.equal(validateVoiceNoteUpload(webmVoice(), 'audio/webm;codecs=opus').container, 'webm');
  assert.throws(
    () => validateVoiceNoteUpload(webmVoice(), 'audio/mp4'),
    (error) => error.code === 'WHATSAPP_INVALID_AUDIO',
  );
  assert.throws(() => validateVoiceNoteUpload(Buffer.alloc(MAX_VOICE_NOTE_BYTES + 1)));
});

test('voice duration is bounded to a two-minute operator recording', () => {
  assert.equal(normalizeVoiceNoteDuration(1.4), 1);
  assert.equal(normalizeVoiceNoteDuration(119.6), 120);
  assert.throws(() => normalizeVoiceNoteDuration(0));
  assert.throws(() => normalizeVoiceNoteDuration(122));
});

test('browser audio is transcoded to mono OGG Opus without a shell', async () => {
  const fake = fakeFfmpeg();
  const result = await transcodeVoiceNote(webmVoice(), {
    declaredMimeType: 'audio/webm',
    ffmpegPath: '/safe/ffmpeg',
    spawnProcess: fake.spawnProcess,
  });

  assert.equal(result.subarray(0, 4).toString('ascii'), 'OggS');
  assert.equal(fake.invocation().command, '/safe/ffmpeg');
  assert.equal(fake.invocation().options.windowsHide, true);
  assert.equal(fake.invocation().options.stdio[0], 'pipe');
  assert.ok(fake.invocation().args.includes('libopus'));
  assert.ok(fake.invocation().args.includes('voip'));
  assert.ok(fake.invocation().args.includes('120'));
});

test('missing ffmpeg fails closed with a service-unavailable error', async () => {
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => undefined;
    process.nextTick(() => {
      child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }));
    });
    return child;
  };

  await assert.rejects(
    transcodeVoiceNote(webmVoice(), {
      declaredMimeType: 'audio/webm',
      spawnProcess,
    }),
    (error) => error.statusCode === 503 && error.code === 'WHATSAPP_AUDIO_CONVERTER_UNAVAILABLE',
  );
});

test('bundled ffmpeg produces a WhatsApp-compatible OGG Opus voice note', async () => {
  const ffmpegPath = resolveFfmpegPath();
  const generated = spawnSync(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.5',
      '-c:a',
      'libopus',
      '-f',
      'webm',
      'pipe:1',
    ],
    { maxBuffer: 2 * 1024 * 1024, windowsHide: true },
  );
  assert.equal(generated.status, 0, generated.stderr?.toString());
  const result = await transcodeVoiceNote(generated.stdout, {
    declaredMimeType: 'audio/webm',
    ffmpegPath,
  });
  assert.equal(result.subarray(0, 4).toString('ascii'), 'OggS');
  assert.ok(result.length > 100);
});

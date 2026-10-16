const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Capture, recorderType, MAX_BYTES, cameraError } = require('../public/rounds/camera');
const M = require('../public/rounds/model');

function fixture({ supported = ['video/webm'], secure = true, deferred = false } = {}) {
  let now = 0,
    interval,
    resolveMedia;
  const tracks = [
    {
      stopped: 0,
      stop() {
        this.stopped++;
      },
    },
    {
      stopped: 0,
      stop() {
        this.stopped++;
      },
    },
  ];
  const stream = { getTracks: () => tracks };
  const video = {
    srcObject: null,
    videoWidth: 1080,
    videoHeight: 1920,
    pauses: 0,
    async play() {},
    pause() {
      this.pauses++;
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    args: null,
    getContext: () => ({
      drawImage(...args) {
        canvas.args = args;
      },
    }),
    toBlob(callback, type, quality) {
      canvas.type = type;
      canvas.quality = quality;
      callback(new Blob(['photo'], { type }));
    },
  };
  class Recorder {
    static isTypeSupported(type) {
      return supported.includes(type);
    }
    constructor(_stream, options) {
      this.mimeType = options.mimeType;
      this.state = 'inactive';
      Recorder.last = this;
    }
    start(timeslice) {
      this.state = 'recording';
      this.timeslice = timeslice;
    }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['video']) });
      this.onstop?.();
    }
  }
  const env = {
    isSecureContext: secure,
    navigator: {
      mediaDevices: {
        getUserMedia(constraints) {
          env.constraints = constraints;
          return deferred
            ? new Promise((resolve) => {
                resolveMedia = resolve;
              })
            : Promise.resolve(stream);
        },
      },
    },
    document: { createElement: () => canvas },
    Date: { now: () => now },
    Blob,
    MediaRecorder: Recorder,
    setInterval(callback) {
      interval = callback;
      return 1;
    },
    clearInterval() {
      interval = null;
    },
  };
  const capture = new Capture(video, env);
  return {
    capture,
    env,
    stream,
    tracks,
    video,
    canvas,
    Recorder,
    resolveMedia() {
      resolveMedia(stream);
    },
    tick(ms) {
      now = ms;
      interval?.();
    },
  };
}

test('camera closes a stream returned after cancellation; cannot reopen itself', async () => {
  const f = fixture({ deferred: true });
  const opening = f.capture.open('photo');
  f.capture.close();
  f.resolveMedia();
  assert.equal(await opening, false);
  assert.deepEqual(
    f.tracks.map((track) => track.stopped),
    [1, 1],
  );
  assert.equal(f.video.srcObject, null);
});

test('photo preserves portrait dimensions, directly draws sensor frame without mirroring and strips EXIF', async () => {
  const f = fixture();
  await f.capture.open('photo', 'user');
  const photo = await f.capture.photo();
  assert.equal(f.canvas.width, 900);
  assert.equal(f.canvas.height, 1600);
  assert.deepEqual(f.canvas.args, [f.video, 0, 0, 900, 1600]);
  assert.equal(photo.type, 'image/jpeg');
  assert.equal(f.canvas.quality, 0.88);
  assert.equal(f.env.constraints.audio, false);
  assert.equal(f.env.constraints.video.facingMode.ideal, 'user');
  f.capture.close();
  assert.equal(f.video.srcObject, null);
  assert.deepEqual(
    f.tracks.map((track) => track.stopped),
    [1, 1],
  );
});

test('landscape frame is not forced into portrait or stretched', async () => {
  const f = fixture();
  f.video.videoWidth = 1920;
  f.video.videoHeight = 1080;
  await f.capture.open('photo');
  await f.capture.photo();
  assert.deepEqual([f.canvas.width, f.canvas.height], [1600, 900]);
  f.capture.close();
});

test('camera securely fails without HTTPS or supported video recording', async () => {
  const insecure = fixture({ secure: false });
  await assert.rejects(insecure.capture.open('photo'), /https:/);
  assert.equal(insecure.env.constraints, undefined);
  const unsupported = fixture({ supported: [] });
  await assert.rejects(unsupported.capture.open('video'), /Safari/);
  assert.equal(unsupported.env.constraints, undefined);
});

test('recording chooses Safari MP4 before WebM when supported', async () => {
  const f = fixture({ supported: ['video/mp4', 'video/webm'] });
  assert.equal(recorderType(f.Recorder), 'video/mp4');
  await f.capture.open('video');
  const recording = f.capture.startRecording();
  f.tick(4000);
  f.capture.stopRecording();
  assert.equal((await recording).type, 'video/mp4');
  assert.equal(f.env.constraints.audio, true);
  assert.equal(f.Recorder.last.timeslice, 250);
  f.capture.close();
});

test('recording automatically stops before 60-second boundary and resolves actual video', async () => {
  const f = fixture();
  await f.capture.open('video');
  const progress = [];
  const recording = f.capture.startRecording((seconds) => progress.push(seconds));
  f.tick(59000);
  const blob = await recording;
  assert.ok(blob.size > 0);
  assert.equal(blob.type, 'video/webm');
  assert.equal(f.Recorder.last.state, 'inactive');
  assert.deepEqual(progress, [59]);
  f.capture.close();
});

test('navigation closes recording, stops all tracks and rejects instead of uploading partial video', async () => {
  const f = fixture();
  await f.capture.open('video');
  const recording = f.capture.startRecording();
  const cancelled = assert.rejects(recording, { name: 'AbortError' });
  f.capture.close();
  await cancelled;
  assert.equal(f.Recorder.last.state, 'inactive');
  assert.equal(f.video.srcObject, null);
  assert.deepEqual(
    f.tracks.map((track) => track.stopped),
    [1, 1],
  );
});

test('oversize recording fails and does not retain chunks or report success', async () => {
  const f = fixture();
  await f.capture.open('video');
  const recording = f.capture.startRecording();
  const failed = assert.rejects(recording, /8 МБ/);
  f.Recorder.last.ondataavailable({ data: { size: MAX_BYTES + 1 } });
  await failed;
  assert.equal(f.capture.recording, null);
  assert.equal(f.Recorder.last.state, 'inactive');
  f.capture.close();
});

test('stalled browser cannot accept video longer than 60 seconds on manual stop', async () => {
  const f = fixture();
  await f.capture.open('video');
  const recording = f.capture.startRecording();
  const failed = assert.rejects(recording, /60 секунд/);
  f.tick(65000);
  await failed;
  f.capture.close();
});

test('permission failure has clear camera and microphone instructions', () => {
  assert.match(cameraError({ name: 'NotAllowedError' }), /настройках браузера/);
  assert.match(cameraError({ name: 'NotAllowedError' }), /микрофон/);
});

test('required evidence is checked per task: photo and video must both exist before completion', () => {
  assert.equal(M.evidenceReady({ evidenceType: 'none' }), true);
  assert.equal(M.evidenceReady({ evidenceType: 'photo', evidence: [] }), false);
  assert.equal(
    M.evidenceReady({ evidenceType: 'photo_video', evidence: [{ kind: 'photo' }] }),
    false,
  );
  assert.equal(
    M.evidenceReady({
      evidenceType: 'photo_video',
      evidence: [{ kind: 'photo' }, { kind: 'video' }],
    }),
    true,
  );
  assert.equal(M.evidenceReady({ evidenceType: 'video', evidence: [{ kind: 'photo' }] }), false);
  assert.equal(M.evidenceReady({ evidenceType: 'unknown' }), false);
});

test('cancelled rounds do not prevent a fully completed green day', () => {
  assert.deepEqual(M.summary([{ status: 'completed' }, { status: 'cancelled' }]), {
    total: 1,
    completed: 1,
    allDone: true,
  });
  assert.equal(M.summary([]).allDone, false);
  assert.equal(M.editable({ status: 'cancelled' }), false);
  assert.equal(M.editable({ status: 'completed' }), false);
  assert.equal(M.editable({ status: 'overdue' }), true);
});

test('day navigation uses Kazakhstan calendar and crosses month/year boundaries', () => {
  assert.equal(M.localDate(new Date('2026-10-15T20:01:00Z')), '2026-10-16');
  assert.equal(M.shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(M.shiftDate('2026-03-01', -1), '2026-02-28');
});

test('evidence is always private same-origin and user content is escaped', () => {
  assert.equal(
    M.mediaUrl({ id: 'ea829279-4b48-5e9f-a763-e8ef06a53e57', url: 'https://evil.example/photo' }),
    '/api/rounds/media/ea829279-4b48-5e9f-a763-e8ef06a53e57',
  );
  assert.equal(M.mediaUrl({ id: '../secret' }), '');
  assert.equal(
    M.escape('<img src=x onerror="alert(1)">'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
  );
});

test('staff document has no album/file input, inline scripts/styles, password persistence or fake complete on upload', () => {
  const root = path.resolve(__dirname, '../public/rounds');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.doesNotMatch(html, /type=["']file["']|<script(?![^>]*\bsrc=)|\bstyle=/i);
  assert.doesNotMatch(app, /localStorage|sessionStorage|\.click\(\)/);
  assert.match(app, /xhr\.setRequestHeader\('x-csrf-token', state\.csrf\)/);
  assert.match(app, /!data\.success\s*\|\|\s*!data\.media\?\.id/);
  assert.match(app, /state\.uploads\.has\(id\)/);
  assert.match(app, /window\.addEventListener\('pagehide'/);
  assert.match(app, /visibilitychange/);
});

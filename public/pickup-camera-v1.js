(() => {
  'use strict';
  const nonce = new URLSearchParams(location.hash.slice(1)).get('nonce');
  const channel = window.BulkaPickupCamera;
  if (!/^[a-f0-9]{32}$/.test(nonce || '') || typeof channel?.postMessage !== 'function') return;
  const video = document.getElementById('camera');
  const maxBytes = 5 * 1024 * 1024;
  let generation = 0;
  let stream = null;
  let facingMode = 'user';
  let busy = false;
  let ready = false;
  let terminal = false;
  const post = (type, detail = {}) =>
    channel.postMessage(JSON.stringify({ v: 1, nonce, type, ...detail }));
  const stopTracks = (media) => media?.getTracks().forEach((track) => track.stop());
  const clear = () => {
    ready = false;
    const previous = stream;
    stream = null;
    stopTracks(previous);
    video.srcObject = null;
    video.classList.remove('ready', 'front');
  };
  const active = (revision) => !terminal && revision === generation && !document.hidden;
  const fail = (code) => {
    generation++;
    clear();
    busy = false;
    if (!terminal) post('error', { code });
  };
  const frameDimensions = () => {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width * height > 16000000 ||
      video.readyState < 2
    )
      throw new Error('frame');
    return { width, height };
  };
  const verifyLens = (media, expected) => {
    const tracks = media?.getVideoTracks();
    if (
      tracks?.length !== 1 ||
      tracks[0].readyState !== 'live' ||
      tracks[0].getSettings().facingMode !== expected
    )
      throw new Error('lens');
    return tracks[0];
  };
  const waitForFrame = () =>
    new Promise((resolve, reject) => {
      const check = () => {
        try {
          frameDimensions();
          done();
          resolve();
        } catch {
          /* Wait for a decoded frame. */
        }
      };
      const done = () => {
        clearTimeout(timeout);
        video.removeEventListener('loadeddata', check);
        video.removeEventListener('canplay', check);
      };
      const timeout = setTimeout(() => {
        done();
        reject(new Error('frame'));
      }, 8000);
      video.addEventListener('loadeddata', check);
      video.addEventListener('canplay', check);
      check();
    });
  const acquire = async (desired, revision) => {
    let settled = false;
    let timeout;
    const request = navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: { exact: desired },
          width: { ideal: 1200 },
          height: { ideal: 1600 },
          aspectRatio: { ideal: 3 / 4 },
        },
      })
      .then((media) => {
        if (settled || !active(revision)) {
          stopTracks(media);
          throw new Error('cancelled');
        }
        return media;
      });
    try {
      return await Promise.race([
        request,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('timeout')), 20000);
        }),
      ]);
    } finally {
      settled = true;
      clearTimeout(timeout);
    }
  };
  const open = async (desired, reason) => {
    if (terminal || busy || document.hidden) return;
    const revision = ++generation;
    clear();
    busy = true;
    post('busy', { reason });
    try {
      if (
        !window.isSecureContext ||
        !navigator.mediaDevices?.getUserMedia ||
        !navigator.mediaDevices.getSupportedConstraints?.().facingMode
      ) {
        throw new Error('unsupported');
      }
      const media = await acquire(desired, revision);
      if (!active(revision)) {
        stopTracks(media);
        return;
      }
      stream = media;
      const track = verifyLens(media, desired);
      track.addEventListener(
        'ended',
        () => {
          if (active(revision) && stream === media) fail('unavailable');
        },
        { once: true },
      );
      video.srcObject = media;
      await video.play();
      await waitForFrame();
      if (!active(revision)) return;
      verifyLens(media, desired);
      facingMode = desired;
      video.classList.toggle('front', facingMode === 'user');
      video.classList.add('ready');
      ready = true;
      busy = false;
      post('ready', { facingMode, ...frameDimensions() });
    } catch (error) {
      if (!active(revision)) return;
      const code = ['unsupported', 'lens'].includes(error.message)
        ? error.message
        : ['NotAllowedError', 'SecurityError'].includes(error.name)
          ? 'permission'
          : 'unavailable';
      fail(code);
    }
  };
  const capture = () => {
    if (terminal || busy || !ready || document.hidden) return;
    busy = true;
    post('busy', { reason: 'capture' });
    try {
      verifyLens(stream, facingMode);
      const source = frameDimensions();
      // Camera constraints are preferences: WebKit may still return a wide frame.
      // Use the same centered 3:4 crop as the visible frame, without rotating pixels.
      const width = Math.min(source.width, (source.height * 3) / 4);
      const height = (width * 4) / 3;
      const left = (source.width - width) / 2;
      const top = (source.height - height) / 2;
      const ratio = Math.min(1, 1200 / width, 1600 / height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('canvas');
      // Match the visible preview. Only the verified front lens is mirrored.
      if (facingMode === 'user') {
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
      }
      context.drawImage(video, left, top, width, height, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', 0.88);
      if (!data.startsWith('data:image/jpeg;base64,')) throw new Error('jpeg');
      const base64 = data.slice('data:image/jpeg;base64,'.length);
      if (!base64 || base64.length > 4 * Math.ceil(maxBytes / 3)) throw new Error('size');
      terminal = true;
      generation++;
      clear();
      post('photo', {
        facingMode,
        width: canvas.width,
        height: canvas.height,
        mimeType: 'image/jpeg',
        base64,
      });
    } catch (error) {
      fail(error.message === 'lens' ? 'lens' : 'capture');
    }
  };
  const stop = () => {
    if (terminal) return;
    terminal = true;
    generation++;
    clear();
    busy = false;
    post('cancel');
  };
  window.BulkaPickupCameraControls = Object.freeze({
    start: () => open(facingMode, 'start'),
    switchCamera: () => open(facingMode === 'user' ? 'environment' : 'user', 'switch'),
    capture,
    stop,
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });
  window.addEventListener('pagehide', stop, { once: true });
  void open('user', 'start');
})();

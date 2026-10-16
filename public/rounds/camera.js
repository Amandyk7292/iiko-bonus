(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BulkaRoundsCamera = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const MAX_BYTES = 8 * 1024 * 1024;
  const MAX_SECONDS = 60;
  function cameraError(error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError')
      return 'Разрешите доступ к камере в настройках браузера. Для видео также нужен микрофон.';
    if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError')
      return 'Камера не найдена. Откройте страницу на телефоне с камерой.';
    if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError')
      return 'Камера занята. Закройте другое приложение с камерой и попробуйте снова.';
    return error?.userMessage || 'Не удалось открыть камеру. Попробуйте снова.';
  }
  function failure(message, name = 'CaptureError') {
    const error = new Error(message);
    error.name = name;
    error.userMessage = message;
    return error;
  }
  function recorderType(Recorder) {
    if (!Recorder?.isTypeSupported) return '';
    return (
      [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ].find((type) => Recorder.isTypeSupported(type)) || ''
    );
  }
  class Capture {
    constructor(video, env = globalThis) {
      this.video = video;
      this.env = env;
      this.stream = null;
      this.recording = null;
      this.generation = 0;
    }
    async open(kind, facing = 'environment') {
      this.close();
      const generation = this.generation;
      if (!this.env.isSecureContext)
        throw failure(
          'Камера работает только на защищённой странице. Откройте сайт через https://bulka.com.kz.',
        );
      if (!this.env.navigator?.mediaDevices?.getUserMedia)
        throw failure(
          'Этот браузер не поддерживает камеру. Откройте страницу в Safari или Chrome.',
        );
      if (kind === 'video' && !recorderType(this.env.MediaRecorder))
        throw failure(
          'Запись видео недоступна в этом браузере. Откройте страницу в актуальном Safari или Chrome.',
        );
      const stream = await this.env.navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: kind === 'video' ? 720 : 1920 },
          frameRate: { ideal: 24, max: 30 },
        },
        audio: kind === 'video',
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      try {
        await this.video.play();
      } catch (error) {
        this.close();
        throw error;
      }
      if (generation !== this.generation) return false;
      return true;
    }
    async photo() {
      const width = this.video.videoWidth,
        height = this.video.videoHeight;
      if (!this.stream || width < 1 || height < 1)
        throw failure('Камера ещё не готова. Подождите секунду и повторите снимок.');
      const canvas = this.env.document.createElement('canvas');
      const scale = Math.min(1, 1600 / Math.max(width, height));
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      // Draw the sensor frame directly: preserve portrait/landscape and never mirror.
      canvas.getContext('2d').drawImage(this.video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
      if (!blob || blob.size < 1 || blob.size > MAX_BYTES)
        throw failure('Не удалось сохранить фото. Сделайте снимок ещё раз.');
      return blob;
    }
    startRecording(onProgress = () => {}) {
      if (!this.stream || this.recording) return Promise.reject(failure('Камера ещё не готова.'));
      const mimeType = recorderType(this.env.MediaRecorder);
      if (!mimeType)
        return Promise.reject(failure('Запись видео не поддерживается этим браузером.'));
      return new Promise((resolve, reject) => {
        const recorder = new this.env.MediaRecorder(this.stream, {
          mimeType,
          videoBitsPerSecond: 700000,
          audioBitsPerSecond: 64000,
        });
        const state = {
          recorder,
          chunks: [],
          bytes: 0,
          started: this.env.Date.now(),
          timer: null,
          reject,
          resolve,
        };
        this.recording = state;
        const fail = (error) => {
          if (this.recording !== state) return;
          this.recording = null;
          this.env.clearInterval(state.timer);
          recorder.ondataavailable = null;
          recorder.onstop = null;
          recorder.onerror = null;
          try {
            if (recorder.state !== 'inactive') recorder.stop();
          } catch {
            /* Already stopped. */
          }
          reject(error);
        };
        recorder.ondataavailable = (event) => {
          if (!event.data?.size) return;
          state.bytes += event.data.size;
          if (state.bytes > MAX_BYTES)
            return fail(failure('Видео больше 8 МБ. Снимите более короткое видео.'));
          state.chunks.push(event.data);
        };
        recorder.onerror = () => fail(failure('Запись прервалась. Снимите видео ещё раз.'));
        recorder.onstop = () => {
          if (this.recording !== state) return;
          this.recording = null;
          this.env.clearInterval(state.timer);
          const blob = new this.env.Blob(state.chunks, { type: recorder.mimeType || mimeType });
          const duration = (this.env.Date.now() - state.started) / 1000;
          if (!blob.size) return reject(failure('Видео пустое. Начните запись ещё раз.'));
          if (blob.size > MAX_BYTES || duration > MAX_SECONDS + 0.1)
            return reject(
              failure('Видео должно быть не длиннее 60 секунд и до 8 МБ. Снимите ещё раз.'),
            );
          resolve(blob);
        };
        try {
          recorder.start(250);
          state.timer = this.env.setInterval(() => {
            const seconds = (this.env.Date.now() - state.started) / 1000;
            onProgress(Math.min(MAX_SECONDS, Math.floor(seconds)));
            // Leave a little room for the container's final video frame.
            if (seconds >= MAX_SECONDS - 1 && recorder.state !== 'inactive') recorder.stop();
          }, 200);
        } catch (error) {
          fail(failure(cameraError(error)));
        }
      });
    }
    stopRecording() {
      const recorder = this.recording?.recorder;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    }
    close() {
      this.generation++;
      const state = this.recording;
      if (state) {
        this.recording = null;
        this.env.clearInterval(state.timer);
        state.recorder.ondataavailable = null;
        state.recorder.onstop = null;
        state.recorder.onerror = null;
        try {
          if (state.recorder.state !== 'inactive') state.recorder.stop();
        } catch {
          /* Cleanup remains safe. */
        }
        state.reject(failure('Запись отменена.', 'AbortError'));
      }
      this.stream?.getTracks().forEach((track) => track.stop());
      this.stream = null;
      this.video.pause();
      this.video.srcObject = null;
    }
  }
  return { Capture, cameraError, recorderType, MAX_BYTES, MAX_SECONDS };
});

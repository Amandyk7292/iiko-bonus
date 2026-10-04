import 'dart:async';
import 'dart:js_interop';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/widgets.dart';
import 'package:web/web.dart' as web;

import 'cashier_live_camera_types.dart';

CashierLiveCamera createCashierLiveCamera() => _WebCashierCamera();

class _WebCashierCamera extends CashierLiveCamera {
  _WebCashierCamera() {
    _video
      ..autoplay = true
      ..muted = true
      ..playsInline = true
      ..setAttribute('playsinline', '')
      ..setAttribute('aria-hidden', 'true')
      ..style.width = '100%'
      ..style.height = '100%'
      ..style.objectFit = 'cover'
      ..style.pointerEvents = 'none';
    _hiddenListener = ((web.Event event) {
      if (web.document.hidden) _interrupt();
    }).toJS;
    _pageHideListener = ((web.Event event) => _interrupt()).toJS;
    _endedListener = ((web.Event event) => _interrupt()).toJS;
    web.document.addEventListener('visibilitychange', _hiddenListener);
    web.window.addEventListener('pagehide', _pageHideListener);
  }

  final _video = web.HTMLVideoElement();
  final _canvas = web.HTMLCanvasElement();
  late final JSFunction _hiddenListener;
  late final JSFunction _pageHideListener;
  late final JSFunction _endedListener;
  web.MediaStream? _stream;
  int _generation = 0;
  bool _disposed = false;

  @override
  Widget buildPreview() => HtmlElementView.fromTagName(
    tagName: 'div',
    onElementCreated: (element) {
      final container = element as web.HTMLDivElement;
      container
        ..style.width = '100%'
        ..style.height = '100%'
        ..style.pointerEvents = 'none';
      if (!_disposed) container.append(_video);
    },
  );

  @override
  Future<void> start() async {
    stop();
    final generation = _generation;
    if (_disposed || !web.window.isSecureContext || web.document.hidden) {
      throw const CashierCameraException(CashierCameraFailure.unavailable);
    }
    try {
      final stream = await web.window.navigator.mediaDevices
          .getUserMedia(
            web.MediaStreamConstraints(
              audio: false.toJS,
              video: web.MediaTrackConstraints(
                facingMode: 'environment'.toJS,
                width: web.ConstrainULongRange(ideal: 1280),
                height: web.ConstrainULongRange(ideal: 720),
              ),
            ),
          )
          .toDart;
      // A browser permission prompt cannot be cancelled. A late permission
      // grant must never leave a camera running after this route has closed.
      if (_disposed || generation != _generation || web.document.hidden) {
        for (final track in stream.getTracks().toDart) {
          track.stop();
        }
        return;
      }
      _stream = stream;
      for (final track in stream.getTracks().toDart) {
        track.addEventListener('ended', _endedListener);
      }
      _video.srcObject = stream;
      await _video.play().toDart;
    } catch (error) {
      if (_disposed || generation != _generation) return;
      stop();
      // JS promise rejections are browser errors, not Dart DOMException
      // instances. Their standard name is preserved in the error string.
      final description = error.toString();
      final denied =
          description.contains('NotAllowedError') ||
          description.contains('SecurityError');
      throw CashierCameraException(
        denied ? CashierCameraFailure.denied : CashierCameraFailure.unavailable,
      );
    }
  }

  @override
  CashierCameraFrame? captureFrame() {
    if (_disposed || _stream == null || _video.readyState < 2) return null;
    final side = math.min(_video.videoWidth, _video.videoHeight);
    if (side <= 0) return null;
    // At most 720² pixels, sampled sequentially. ZXing also works on Safari
    // where BarcodeDetector is unavailable; no photo encoding is necessary.
    final size = math.min(side, 720);
    _canvas
      ..width = size
      ..height = size;
    final context = _canvas.getContext('2d') as web.CanvasRenderingContext2D;
    context.drawImage(
      _video,
      (_video.videoWidth - side) / 2,
      (_video.videoHeight - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );
    final rgba = context.getImageData(0, 0, size, size).data.toDart;
    return CashierCameraFrame(size, size, Uint8List.fromList(rgba));
  }

  void _interrupt() {
    if (_disposed) return;
    stop();
    onInterrupted?.call();
  }

  @override
  void stop() {
    _generation++;
    final stream = _stream;
    _stream = null;
    if (stream != null) {
      for (final track in stream.getTracks().toDart) {
        track.removeEventListener('ended', _endedListener);
        track.stop();
      }
    }
    _video
      ..pause()
      ..srcObject = null;
    _canvas
      ..width = 0
      ..height = 0;
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    onInterrupted = null;
    stop();
    web.document.removeEventListener('visibilitychange', _hiddenListener);
    web.window.removeEventListener('pagehide', _pageHideListener);
    _video.remove();
  }
}

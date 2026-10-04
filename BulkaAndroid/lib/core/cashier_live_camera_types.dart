import 'dart:typed_data';

import 'package:flutter/widgets.dart';

class CashierCameraFrame {
  const CashierCameraFrame(this.width, this.height, this.rgba);

  final int width;
  final int height;
  final Uint8List rgba;

  Map<String, Object> get decoderInput => {
    'width': width,
    'height': height,
    'rgba': rgba,
  };
}

enum CashierCameraFailure { denied, unavailable }

class CashierCameraException implements Exception {
  const CashierCameraException(this.failure);
  final CashierCameraFailure failure;
}

/// Owns only a local preview and frames, with no recording or network transport.
abstract class CashierLiveCamera {
  VoidCallback? onInterrupted;
  Future<void> start();
  CashierCameraFrame? captureFrame();
  Widget buildPreview();
  void stop();
  void dispose();
}

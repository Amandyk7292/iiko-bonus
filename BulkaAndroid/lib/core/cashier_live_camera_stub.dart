import 'package:flutter/widgets.dart';

import 'cashier_live_camera_types.dart';

CashierLiveCamera createCashierLiveCamera() => _UnavailableCamera();

class _UnavailableCamera extends CashierLiveCamera {
  @override
  Future<void> start() async =>
      throw const CashierCameraException(CashierCameraFailure.unavailable);

  @override
  CashierCameraFrame? captureFrame() => null;

  @override
  Widget buildPreview() => const SizedBox.expand();

  @override
  void stop() {}

  @override
  void dispose() => onInterrupted = null;
}

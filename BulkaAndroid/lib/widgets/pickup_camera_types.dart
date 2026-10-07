class PickupCameraLabels {
  const PickupCameraLabels({
    required this.title,
    required this.capture,
    required this.switchCamera,
    required this.close,
    required this.retry,
    required this.error,
    this.permissionError,
  });

  final String title;
  final String capture;
  final String switchCamera;
  final String close;
  final String retry;
  final String error;
  final String? permissionError;
}

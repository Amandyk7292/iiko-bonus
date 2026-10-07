import 'package:flutter/widgets.dart';
import 'package:image_picker/image_picker.dart';

import 'pickup_camera_types.dart';

bool get usesPickupCamera => false;

Future<XFile?> capturePickupCamera(
  BuildContext context, {
  required PickupCameraLabels labels,
}) async => null;

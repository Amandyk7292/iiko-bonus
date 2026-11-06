import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// Use the physical display, not a potentially letterboxed app viewport.
@visibleForTesting
List<DeviceOrientation> bulkaOrientationsForDisplay(
  Size physicalSize,
  double devicePixelRatio,
) =>
    devicePixelRatio > 0 &&
        math.min(physicalSize.width, physicalSize.height) / devicePixelRatio <
            600
    ? const [DeviceOrientation.portraitUp]
    : const [];

class BulkaOrientationPolicy with WidgetsBindingObserver {
  List<DeviceOrientation>? _last;
  bool _started = false;

  void start() {
    if (_started ||
        kIsWeb ||
        (defaultTargetPlatform != TargetPlatform.iOS &&
            defaultTargetPlatform != TargetPlatform.android)) {
      return;
    }
    _started = true;
    WidgetsBinding.instance.addObserver(this);
    didChangeMetrics();
  }

  void dispose() {
    if (_started) WidgetsBinding.instance.removeObserver(this);
    _started = false;
  }

  @override
  void didChangeMetrics() {
    if (!_started) return;
    final display =
        WidgetsBinding.instance.platformDispatcher.views.firstOrNull?.display;
    if (display == null) return;
    final orientations = bulkaOrientationsForDisplay(
      display.size,
      display.devicePixelRatio,
    );
    if (listEquals(_last, orientations)) return;
    _last = orientations;
    unawaited(
      SystemChrome.setPreferredOrientations(orientations).catchError((
        Object error,
        StackTrace stack,
      ) {
        _last = null;
        FlutterError.reportError(
          FlutterErrorDetails(
            exception: error,
            stack: stack,
            library: 'Bulka orientation',
          ),
        );
      }),
    );
  }
}

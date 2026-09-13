import 'package:web/web.dart' as web;

import 'browser_form_factor_classifier.dart';

bool browserIsTablet() {
  final navigator = web.window.navigator;
  return browserUserAgentLooksLikeTablet(
    userAgent: navigator.userAgent,
    platformName: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  );
}

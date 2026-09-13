import 'browser_form_factor_stub.dart'
    if (dart.library.js_interop) 'browser_form_factor_web.dart'
    as platform;
export 'browser_form_factor_classifier.dart';

bool get bulkaBrowserIsTablet => platform.browserIsTablet();

import 'cashier_live_camera_stub.dart'
    if (dart.library.js_interop) 'cashier_live_camera_web.dart'
    as implementation;
import 'cashier_live_camera_types.dart';

export 'cashier_live_camera_types.dart';

CashierLiveCamera createCashierLiveCamera() =>
    implementation.createCashierLiveCamera();

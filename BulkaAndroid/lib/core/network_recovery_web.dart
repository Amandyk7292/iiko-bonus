import 'dart:async';
import 'dart:js_interop';
import 'package:web/web.dart' as web;

Stream<void> networkRecoveryEvents() {
  late StreamController<void> controller;
  final listener = ((web.Event event) => controller.add(null)).toJS;
  controller = StreamController<void>(
    onListen: () => web.window.addEventListener('online', listener),
    onCancel: () => web.window.removeEventListener('online', listener),
  );
  return controller.stream;
}

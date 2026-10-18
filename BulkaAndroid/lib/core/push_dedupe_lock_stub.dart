import 'dart:async';

/// Web delivery has one application isolate, so an in-isolate queue is enough.
abstract final class PushDedupeLock {
  static Future<void>? _tail;

  static Future<T> synchronized<T>(Future<T> Function() action) {
    final previous = _tail;
    final released = Completer<void>();
    _tail = released.future;
    return (() async {
      if (previous != null) await previous;
      try {
        return await action();
      } finally {
        released.complete();
        if (identical(_tail, released.future)) _tail = null;
      }
    })();
  }
}

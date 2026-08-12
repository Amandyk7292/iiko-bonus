import 'dart:async';
import 'dart:io';
import 'dart:math';

/// Serializes push claims both inside an isolate and across Flutter's main and
/// Firebase background isolates. The lock file contains no application data.
abstract final class PushDedupeLock {
  static Future<void> _tail = Future<void>.value();
  static const _staleAfter = Duration(seconds: 15);
  static const _acquireTimeout = Duration(seconds: 20);

  static Future<T> synchronized<T>(Future<T> Function() action) {
    final previous = _tail;
    final released = Completer<void>();
    _tail = released.future;
    return (() async {
      await previous;
      try {
        return await (Platform.isWindows
            ? _withWindowsLock(action)
            : _withPosixLock(action));
      } finally {
        released.complete();
      }
    })();
  }

  static String get _lockPath =>
      '${Directory.systemTemp.path}${Platform.pathSeparator}'
      'bulka-push-dedupe-v1.lock';

  static Future<T> _withWindowsLock<T>(Future<T> Function() action) async {
    final handle = await File(_lockPath).open(mode: FileMode.append);
    await handle.lock(FileLock.blockingExclusive);
    try {
      return await action();
    } finally {
      try {
        await handle.unlock();
      } finally {
        await handle.close();
      }
    }
  }

  static Future<T> _withPosixLock<T>(Future<T> Function() action) async {
    // Dart's advisory FileLock is process-scoped on Darwin/Linux, so separate
    // isolates can both acquire it. Creating one symbolic link is an atomic
    // EEXIST mutex at the filesystem level and therefore works across isolates.
    final lock = Link(_lockPath);
    final createdMicros = DateTime.now().toUtc().microsecondsSinceEpoch;
    final owner = '$createdMicros-$pid-${Random.secure().nextInt(1 << 32)}';
    final deadline = DateTime.now().add(_acquireTimeout);
    while (true) {
      try {
        await lock.create(owner);
        break;
      } on FileSystemException {
        await _removeStalePosixLock(lock);
        if (DateTime.now().isAfter(deadline)) {
          throw TimeoutException('push dedupe lock unavailable');
        }
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }
    }
    try {
      return await action();
    } finally {
      try {
        if (await lock.target() == owner) await lock.delete();
      } on FileSystemException {
        // A stale-lock recovery can remove only leases older than the maximum
        // claim duration. Missing the already-released link is harmless.
      }
    }
  }

  static Future<void> _removeStalePosixLock(Link lock) async {
    try {
      final target = await lock.target();
      final separator = target.indexOf('-');
      final createdMicros = separator < 1
          ? null
          : int.tryParse(target.substring(0, separator));
      if (createdMicros == null) return;
      final created = DateTime.fromMicrosecondsSinceEpoch(
        createdMicros,
        isUtc: true,
      );
      if (DateTime.now().toUtc().difference(created) > _staleAfter) {
        await lock.delete();
      }
    } on FileSystemException {
      // The owner may release or another contender may recover between calls.
    }
  }
}

part of '../main.dart';

typedef AdminPortalWakelockEnabled = Future<bool> Function();
typedef AdminPortalWakelockAction = Future<void> Function();

bool shouldKeepAdminPortalAwake({
  required Size screenSize,
  required TargetPlatform platform,
  bool isWeb = kIsWeb,
}) {
  if (isWeb) return false;
  if (platform != TargetPlatform.iOS && platform != TargetPlatform.android) {
    return false;
  }
  return screenSize.shortestSide >= 600;
}

/// Owns the staff portal's wakelock without disturbing a lock acquired by
/// another feature. All changes are serialized so closing the portal while a
/// platform call is still pending cannot leave the display awake.
class AdminPortalWakelockController {
  AdminPortalWakelockController({
    AdminPortalWakelockEnabled? isEnabled,
    AdminPortalWakelockAction? enable,
    AdminPortalWakelockAction? disable,
  }) : _isEnabled = isEnabled ?? (() => WakelockPlus.enabled),
       _enable = enable ?? WakelockPlus.enable,
       _disable = disable ?? WakelockPlus.disable;

  final AdminPortalWakelockEnabled _isEnabled;
  final AdminPortalWakelockAction _enable;
  final AdminPortalWakelockAction _disable;

  Future<void> _tail = Future<void>.value();
  bool _desired = false;
  bool _acquired = false;
  bool _disposed = false;

  @visibleForTesting
  bool get acquired => _acquired;

  Future<void> setActive(bool active) {
    if (_disposed) return _tail;
    _desired = active;
    return _queueReconcile();
  }

  Future<void> dispose() {
    if (_disposed) return _tail;
    _disposed = true;
    _desired = false;
    return _queueReconcile();
  }

  Future<void> _queueReconcile() {
    _tail = _tail.then((_) => _reconcile());
    return _tail;
  }

  Future<void> _reconcile() async {
    if (!_desired) {
      await _releaseOwnedLock();
      return;
    }
    if (_acquired) return;

    final wasEnabled = await _readEnabled();
    if (wasEnabled == null || wasEnabled || !_desired) return;

    try {
      await _enable();
      _acquired = true;
    } catch (_) {
      return;
    }

    // A pause or dispose can arrive while the platform enable call is pending.
    if (!_desired) await _releaseOwnedLock();
  }

  Future<bool?> _readEnabled() async {
    try {
      return await _isEnabled();
    } catch (_) {
      return null;
    }
  }

  Future<void> _releaseOwnedLock() async {
    if (!_acquired) return;
    try {
      await _disable();
      _acquired = false;
    } catch (_) {}
  }
}

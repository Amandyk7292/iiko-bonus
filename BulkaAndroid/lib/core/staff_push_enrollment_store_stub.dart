/// Native staff push is unavailable on web. This implementation exists only
/// so shared code remains compilable without importing a native keychain API.
abstract final class StaffPushEnrollmentStore {
  static bool _enabled = false;

  static Future<bool> read() async => _enabled;

  static Future<void> write(bool enabled) async {
    _enabled = enabled;
  }
}

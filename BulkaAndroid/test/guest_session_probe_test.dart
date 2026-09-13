import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('a first-time web guest does not probe protected sessions', () {
    expect(
      shouldProbeStaffSession(
        isWeb: true,
        isAuthenticated: false,
        currentUri: Uri(path: '/catalog'),
      ),
      isFalse,
    );
    expect(
      shouldProbeCustomerSession(
        isWeb: true,
        hasCachedIdentity: false,
        hasAccessToken: false,
        hasRefreshToken: false,
      ),
      isFalse,
    );
  });

  test('known identities and administrative routes still restore sessions', () {
    expect(
      shouldProbeStaffSession(
        isWeb: true,
        isAuthenticated: false,
        currentUri: Uri(path: '/admin'),
      ),
      isTrue,
    );
    expect(
      shouldProbeCustomerSession(
        isWeb: true,
        hasCachedIdentity: true,
        hasAccessToken: false,
        hasRefreshToken: false,
      ),
      isTrue,
    );
  });
}

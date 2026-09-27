import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:bulka_bonus/core/referral_link.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));
  test(
    'accepts supported links and rejects unrelated hosts and invalid codes',
    () {
      expect(
        PendingReferral.codeFromUri(
          Uri.parse('https://bulka.com.kz/catalog?ref=bulka-1234abcd'),
        ),
        'BULKA-1234ABCD',
      );
      expect(
        PendingReferral.codeFromUri(
          Uri.parse('bulka://catalog?ref=BULKA-1234ABCD'),
        ),
        'BULKA-1234ABCD',
      );
      for (final link in [
        'https://other.test/catalog?ref=BULKA-1234ABCD',
        'http://bulka.com.kz/catalog?ref=BULKA-1234ABCD',
        'https://bulka.com.kz/catalog?ref=invalid',
      ]) {
        expect(PendingReferral.codeFromUri(Uri.parse(link)), isNull);
      }
    },
  );
  test(
    'keeps the first invitation until registration and allows clearing it',
    () async {
      await PendingReferral.capture(
        Uri.parse('https://bulka.com.kz/catalog?ref=BULKA-1234ABCD'),
      );
      await PendingReferral.capture(
        Uri.parse('https://bulka.com.kz/catalog?ref=BULKA-8888ABCD'),
      );
      expect(await PendingReferral.read(), 'BULKA-1234ABCD');
      await PendingReferral.set('');
      expect(await PendingReferral.read(), isNull);
    },
  );
  test(
    'does not retain invitations for an already authenticated account',
    () async {
      SharedPreferences.setMockInitialValues({'phone': '+77010000000'});
      await PendingReferral.capture(
        Uri.parse('https://bulka.com.kz/catalog?ref=BULKA-1234ABCD'),
      );
      expect(await PendingReferral.read(), isNull);
    },
  );
}

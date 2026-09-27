import 'package:shared_preferences/shared_preferences.dart';

class PendingReferral {
  static const key = 'pendingReferralCodeV1';

  static String? codeFromUri(Uri uri) {
    final trusted =
        (uri.scheme == 'https' && uri.host == 'bulka.com.kz') ||
        (uri.scheme == 'bulka' && uri.host == 'catalog');
    if (!trusted) return null;
    final code = uri.queryParameters['ref']?.trim().toUpperCase();
    return code != null && RegExp(r'^BULKA-[A-Z0-9]{8}$').hasMatch(code)
        ? code
        : null;
  }

  static Future<void> capture(Uri uri) async {
    final code = codeFromUri(uri);
    if (code == null) return;
    final prefs = await SharedPreferences.getInstance();
    // Do not carry a logged-in customer's invitation over to another account.
    if (prefs.getString('phone') != null || prefs.getString(key) != null) {
      return;
    }
    await prefs.setString(key, code);
  }

  static Future<String?> read() async =>
      (await SharedPreferences.getInstance()).getString(key);

  static Future<void> set(String code) async {
    final prefs = await SharedPreferences.getInstance();
    if (code.trim().isEmpty) {
      await prefs.remove(key);
    } else {
      await prefs.setString(key, code.trim().toUpperCase());
    }
  }
}

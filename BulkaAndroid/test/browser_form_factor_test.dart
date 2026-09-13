import 'package:bulka_bonus/core/browser_form_factor.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('iPad and Android tablet user agents skip the desktop phone frame', () {
    expect(
      browserUserAgentLooksLikeTablet(
        userAgent:
            'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
        platformName: 'iPad',
        maxTouchPoints: 5,
      ),
      isTrue,
    );
    expect(
      browserUserAgentLooksLikeTablet(
        userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15',
        platformName: 'MacIntel',
        maxTouchPoints: 5,
      ),
      isTrue,
    );
    expect(
      browserUserAgentLooksLikeTablet(
        userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel Tablet)',
        platformName: 'Linux armv8l',
        maxTouchPoints: 10,
      ),
      isTrue,
    );
  });

  test('phones and touch laptops keep their own layouts', () {
    expect(
      browserUserAgentLooksLikeTablet(
        userAgent: 'Mozilla/5.0 (Linux; Android 15; Mobile)',
        platformName: 'Linux armv8l',
        maxTouchPoints: 5,
      ),
      isFalse,
    );
    expect(
      browserUserAgentLooksLikeTablet(
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        platformName: 'Win32',
        maxTouchPoints: 10,
      ),
      isFalse,
    );
  });
}

import 'package:bulka_bonus/core/api_origin.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('web API defaults to the current HTTP origin', () {
    expect(
      resolveBulkaApiBaseUrl(
        configuredBaseUrl: '',
        isWeb: true,
        browserUri: Uri.parse('http://127.0.0.1:4320/catalog?source=smoke'),
      ),
      'http://127.0.0.1:4320',
    );
  });

  test(
    'explicit native configuration wins and native fallback stays production',
    () {
      expect(
        resolveBulkaApiBaseUrl(
          configuredBaseUrl: ' https://staging.bulka.example ',
          isWeb: false,
          browserUri: Uri.parse('file:///app/index.html'),
        ),
        'https://staging.bulka.example',
      );
      expect(
        resolveBulkaApiBaseUrl(
          configuredBaseUrl: '',
          isWeb: false,
          browserUri: Uri.parse('file:///app/index.html'),
        ),
        bulkaProductionOrigin,
      );
    },
  );
}

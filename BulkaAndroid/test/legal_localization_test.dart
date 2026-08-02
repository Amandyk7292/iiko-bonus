import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  tearDown(() {
    appLanguageNotifier.value = 'ru';
  });

  test('legal links use the selected application language', () {
    expect(
      bulkaLegalPageUri('payment-and-refund', language: 'ru').toString(),
      'https://bulka.com.kz/payment-and-refund',
    );
    expect(
      bulkaLegalPageUri('delivery-terms', language: 'kk').toString(),
      'https://bulka.com.kz/kk/delivery-terms',
    );
    expect(
      bulkaLegalPageUri('/company-details/', language: 'en').toString(),
      'https://bulka.com.kz/en/company-details',
    );

    appLanguageNotifier.value = 'kk';
    expect(
      bulkaLegalPageUri('privacy').toString(),
      'https://bulka.com.kz/kk/privacy',
    );
    expect(
      bulkaLegalPageUri('public-offer').toString(),
      'https://bulka.com.kz/kk/public-offer',
    );
  });

  test('unknown language safely falls back to Russian', () {
    expect(
      bulkaLegalPageUri('terms', language: 'de').toString(),
      'https://bulka.com.kz/terms',
    );
  });
}

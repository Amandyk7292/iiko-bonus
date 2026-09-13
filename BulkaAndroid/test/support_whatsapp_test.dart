import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  setUp(() => appLanguageNotifier.value = 'ru');

  test('general support opens the configured WhatsApp number', () {
    final uri = bulkaSupportWhatsAppUri();

    expect(uri.scheme, 'https');
    expect(uri.host, 'wa.me');
    expect(uri.path, '/77011872233');
    expect(uri.queryParameters['text'], contains('Bulka'));
  });

  test('order support includes the visible order number', () {
    final uri = bulkaSupportWhatsAppUri(orderNumber: 100060);

    expect(uri.path, '/77011872233');
    expect(uri.queryParameters['text'], contains('100060'));
  });
}

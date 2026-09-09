import 'dart:convert';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('order mutation and refund roles preserve the web permissions', () {
    expect(staffCanCancelOrders('cashier'), isTrue);
    expect(staffCanRefundOrders('cashier'), isFalse);
    expect(staffCanCancelOrders('viewer'), isFalse);
    for (final role in ['owner', 'admin', 'branch_manager']) {
      expect(staffCanEditOrders(role), isTrue);
      expect(staffCanRefundOrders(role), isTrue);
    }
    for (final role in ['operator', 'editor']) {
      expect(staffCanEditOrders(role), isTrue);
      expect(staffCanRefundOrders(role), isFalse);
    }
    for (final role in [
      'viewer',
      'cashier',
      'marketer',
      'courier',
      'unknown',
    ]) {
      expect(staffCanEditOrders(role), isFalse);
      expect(staffCanRefundOrders(role), isFalse);
    }
  });
  test('refund request identifiers match the server UUID contract', () {
    final values = List.generate(100, (_) => staffRequestId());
    expect(values.toSet().length, 100);
    for (final value in values) {
      expect(
        value,
        matches(
          RegExp(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          ),
        ),
      );
    }
  });
  testWidgets(
    'refund requires server preview and keeps key on uncertain retry',
    (tester) async {
      final submitted = <Map<String, dynamic>>[];
      var previews = 0;
      final api = StaffApiClient(
        baseUrl: 'https://bulka.test',
        client: MockClient((request) async {
          final path = request.url.path;
          if (path.endsWith('/refund-options')) {
            return http.Response(
              jsonEncode({
                'refund': {
                  'paidAmount': 1800,
                  'alreadyRefunded': 0,
                  'remainingAmount': 1800,
                  'previewSupported': true,
                  'lines': [
                    {
                      'lineKey': 'line-1',
                      'name': 'Test product',
                      'refundableQuantity': 2,
                    },
                  ],
                },
              }),
              200,
            );
          }
          if (path.endsWith('/partial-refund-preview')) {
            previews++;
            return http.Response(
              jsonEncode({
                'preview': {
                  'amount': 777,
                  'adjustment': {
                    'spentBonusRestored': 20,
                    'earnedBonusReversed': 5,
                  },
                },
              }),
              200,
            );
          }
          if (path.endsWith('/partial-refund')) {
            submitted.add(jsonDecode(request.body) as Map<String, dynamic>);
            if (submitted.length == 1) throw http.ClientException('Offline');
            return http.Response(
              jsonEncode({
                'refund': {'status': 'completed'},
              }),
              200,
            );
          }
          return http.Response('{}', 404);
        }),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: StaffRefund(
            api: api,
            order: const {'id': 'order-1', 'number': 42},
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Подтвердить сумму'), findsNothing);
      await tester.enterText(find.byType(TextField).first, '0.5');
      await tester.tap(find.text('Рассчитать возврат'));
      await tester.pumpAndSettle();
      expect(previews, 0);
      expect(submitted, isEmpty);
      await tester.enterText(find.byType(TextField).first, '1');
      await tester.tap(find.text('Рассчитать возврат'));
      await tester.pumpAndSettle();
      expect(previews, 1);
      expect(find.text('777 ₸'), findsOneWidget);
      expect(submitted, isEmpty);
      await tester.ensureVisible(find.text('Подтвердить сумму'));
      await tester.tap(find.text('Подтвердить сумму'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Вернуть деньги'));
      await tester.pumpAndSettle();
      expect(submitted.length, 1);
      expect(find.textContaining('Нет связи'), findsOneWidget);
      await tester.tap(find.text('Вернуть деньги'));
      await tester.pumpAndSettle();
      expect(submitted.length, 2);
      expect(submitted[1]['idempotencyKey'], submitted[0]['idempotencyKey']);
      expect(submitted[0]['items'], [
        {'lineKey': 'line-1', 'quantity': 1},
      ]);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      api.close();
    },
  );
}

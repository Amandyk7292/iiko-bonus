import 'dart:convert';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  for (final language in ['ru', 'kk']) {
    for (final width in [390.0, 1024.0]) {
      testWidgets(
        'cashier order details keep choices and supplements per item ($language, $width)',
        (tester) async {
          appLanguageNotifier.value = language;
          addTearDown(() => appLanguageNotifier.value = 'ru');
          tester.view.physicalSize = Size(width, 1400);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final descriptions = {
            'ru': 'Размер: Большой (+500 ₸); Упаковка: Коробка (+100 ₸)',
            'kk': 'Өлшем: Үлкен (+500 ₸); Қаптама: Қорап (+100 ₸)',
          };
          final otherChoices = {
            'ru': 'Размер: Маленький; Упаковка: Без упаковки',
            'kk': 'Өлшем: Кішкентай; Қаптама: Қаптамасыз',
          };
          final api = StaffApiClient(
            baseUrl: 'https://bulka.test',
            client: MockClient((_) async => http.Response('{}', 200)),
          );
          await tester.pumpWidget(
            MaterialApp(
              theme: staffTheme(),
              home: StaffOrderDetail(
                api: api,
                role: 'cashier',
                order: {
                  'id': 'order-choices',
                  'number': 42,
                  'amount': 4300,
                  'paymentStatus': 'paid',
                  'orderStatus': 'completed',
                  'fulfillmentType': 'pickup',
                  'items': [
                    {
                      'name': 'Кофе',
                      'quantity': 2,
                      'price': 1600,
                      'optionSummary': descriptions['ru'],
                      'optionSummaries': descriptions,
                    },
                    {
                      'name': 'Кофе',
                      'quantity': 1,
                      'price': 1000,
                      'optionSummary': otherChoices['ru'],
                      'optionSummaries': otherChoices,
                    },
                    {'name': 'Вода', 'quantity': 1, 'price': 100},
                  ],
                },
              ),
            ),
          );
          await tester.pumpAndSettle();
          final configuredItem = find.text('Кофе\n${descriptions[language]}');
          await tester.ensureVisible(configuredItem);
          expect(configuredItem, findsOneWidget);
          final tile = find.ancestor(
            of: configuredItem,
            matching: find.byType(ListTile),
          );
          expect(
            find.descendant(
              of: tile,
              matching: find.text('2 × ${staffMoney(1600)}'),
            ),
            findsOneWidget,
          );
          expect(find.text('Кофе\n${otherChoices[language]}'), findsOneWidget);
          expect(
            find.text(localizedOrderItemName({'name': 'Вода'})),
            findsOneWidget,
          );
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox.shrink());
          api.close();
        },
      );
    }
  }
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
  for (final weighted in [false, true]) {
    testWidgets(
      'refund requires server preview and keeps key on uncertain retry (weighted: $weighted)',
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
                        'refundableQuantity': weighted ? 0.75 : 2,
                        'quantityStep': weighted ? 0.001 : 1,
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
        await tester.enterText(
          find.byType(TextField).first,
          weighted ? '0.1234' : '0.5',
        );
        await tester.tap(find.text('Рассчитать возврат'));
        await tester.pumpAndSettle();
        expect(previews, 0);
        expect(submitted, isEmpty);
        await tester.enterText(
          find.byType(TextField).first,
          weighted ? '0,375' : '1',
        );
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
          {'lineKey': 'line-1', 'quantity': weighted ? 0.375 : 1},
        ]);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
        api.close();
      },
    );
  }
}

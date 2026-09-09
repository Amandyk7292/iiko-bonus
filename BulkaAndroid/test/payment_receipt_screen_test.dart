import 'dart:convert';
import 'dart:io';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const receiptUrl =
    'https://bulka.com.kz/payment-receipts/117615f9-b35f-4eb4-9f6d-777f2236bb25?token=signed&expires=9999999999';
final receiptData = <String, dynamic>{
  'documentNumber': 'BLK-100039',
  'orderNumber': 100039,
  'transactionAt': '2026-09-08T17:18:17Z',
  'amount': 1060.30,
  'discount': 29.70,
  'deliveryFee': 100,
  'currency': 'KZT',
  'cardLastFour': '1328',
  'operation': 'purchase',
  'paymentMethod': 'card',
  'items': [
    {
      'name': 'Плюшка Московская',
      'quantity': 2,
      'unitPrice': 495,
      'lineTotal': 990,
    },
  ],
};

void main() {
  tearDown(() => appLanguageNotifier.value = 'ru');

  for (final language in ['ru', 'kk', 'en']) {
    testWidgets(
      'native receipt and PDF use $language, actual card and fractional totals',
      (tester) async {
        tester.view.physicalSize = const Size(320, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        appLanguageNotifier.value = language;
        final api = BulkaApiClient(
          client: MockClient((request) async {
            expect(request.headers['Accept'], 'application/json');
            expect(request.headers['Authorization'], isNull);
            expect(request.url.queryParameters['lang'], language);
            return http.Response(
              jsonEncode({'success': true, 'receipt': receiptData}),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            );
          }),
        );
        addTearDown(api.dispose);
        await tester.pumpWidget(
          MaterialApp(
            theme: buildBulkaTheme(),
            home: PaymentReceiptScreen(receiptUrl: receiptUrl, api: api),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('receipt_title'.tr), findsOneWidget);
        expect(
          find.text(localizeCatalogName('Плюшка Московская')),
          findsOneWidget,
        );
        expect(find.text('1060.30 ₸'), findsOneWidget);
        expect(find.text('receipt_goods'.tr), findsOneWidget);
        expect(find.text('checkout_delivery_fee'.tr), findsOneWidget);
        expect(find.text('100 ₸'), findsOneWidget);
        expect(find.text('−29.70 ₸'), findsOneWidget);
        await tester.scrollUntilVisible(find.text('receipt_share'.tr), 200);
        expect(
          find.text('receipt_paid_card_last_four'.trArgs({'lastFour': '1328'})),
          findsOneWidget,
        );
        expect(find.textContaining('forte_widget'), findsNothing);
        expect(tester.takeException(), isNull);
        await tester.runAsync(() async {
          final bytes = await buildPaymentReceiptPdf(
            PaymentReceipt.fromJson(receiptData),
          );
          expect(ascii.decode(bytes.take(5).toList()), '%PDF-');
          final out = File('../scratch/receipt-preview-$language.pdf');
          await out.writeAsBytes(bytes);
        });
      },
    );
  }

  test(
    'missing card suffix stays unknown and foreign URLs never receive requests',
    () async {
      final receipt = PaymentReceipt.fromJson({
        ...receiptData,
        'cardLastFour': null,
      });
      expect(receipt.paymentLabel, 'receipt_paid_card'.tr);
      expect(receipt.paymentLabel, isNot(contains('1328')));
      var requests = 0;
      final api = BulkaApiClient(
        client: MockClient((request) async {
          requests++;
          return http.Response('{}', 200);
        }),
      );
      addTearDown(api.dispose);
      await expectLater(
        api.getPaymentReceipt(
          receiptUrl.replaceFirst('bulka.com.kz', 'example.com'),
        ),
        throwsA(isA<ApiException>()),
      );
      expect(requests, 0);
    },
  );

  testWidgets(
    'free delivery is shown separately from goods in native receipt and staff orders',
    (tester) async {
      final data = {
        ...receiptData,
        'amount': 10000,
        'discount': 0,
        'deliveryFee': 0,
        'hasDelivery': true,
      };
      final receipt = PaymentReceipt.fromJson(data);
      expect(receipt.goodsSubtotal, 10000);
      expect(receipt.hasDelivery, isTrue);
      final api = BulkaApiClient(
        client: MockClient(
          (_) async => http.Response(
            jsonEncode({'success': true, 'receipt': data}),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          ),
        ),
      );
      addTearDown(api.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: PaymentReceiptScreen(receiptUrl: receiptUrl, api: api),
        ),
      );
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('checkout_delivery_fee'.tr),
        150,
      );
      expect(find.text('0 ₸'), findsOneWidget);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: StaffOrderAmounts(
              order: {
                'amount': 2506,
                'discount': 0,
                'deliveryFee': 2471,
                'orderType': 'delivery',
                'providerDeliveryPrice': 3000,
              },
            ),
          ),
        ),
      );
      expect(find.text('35 ₸'), findsOneWidget);
      expect(find.text('2 471 ₸'), findsOneWidget);
      expect(find.text('2 506 ₸'), findsOneWidget);
      expect(find.text('3000 ₸'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('receipt failures remain native and can be retried', (
    tester,
  ) async {
    var attempts = 0;
    final api = BulkaApiClient(
      client: MockClient(
        (_) async => ++attempts == 1
            ? http.Response('expired', 403)
            : http.Response(
                jsonEncode({'success': true, 'receipt': receiptData}),
                200,
                headers: {'content-type': 'application/json; charset=utf-8'},
              ),
      ),
    );
    addTearDown(api.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: PaymentReceiptScreen(receiptUrl: receiptUrl, api: api),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('receipt_load_error'.tr), findsOneWidget);
    await tester.tap(find.text('retry_btn'.tr));
    await tester.pumpAndSettle();
    expect(find.text('BLK-100039'), findsOneWidget);
  });

  for (final language in ['ru', 'kk', 'en']) {
    testWidgets('receipt separates spent bonuses from delivery in $language', (
      tester,
    ) async {
      appLanguageNotifier.value = language;
      final data = {
        ...receiptData,
        'amount': 1900,
        'discount': 200,
        'bonusSpent': 900,
        'deliveryFee': 1000,
      };
      final receipt = PaymentReceipt.fromJson(data);
      expect(receipt.goodsSubtotal, 2000);
      final api = BulkaApiClient(
        client: MockClient(
          (_) async => http.Response(
            jsonEncode({'success': true, 'receipt': data}),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          ),
        ),
      );
      addTearDown(api.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: PaymentReceiptScreen(receiptUrl: receiptUrl, api: api),
        ),
      );
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('checkout_bonus_spent'.tr),
        150,
      );
      expect(find.text('checkout_bonus_spent'.tr), findsOneWidget);
      expect(find.text('−900 ₸'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}

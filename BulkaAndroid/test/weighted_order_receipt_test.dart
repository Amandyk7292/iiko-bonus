import 'dart:convert';
import 'dart:io';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const _weightedItem = <String, dynamic>{
  'id': 'weight',
  'name': 'Бауырсак',
  'price': 1490,
  'quantity': 0.375,
  'quantityStep': 0.001,
  'unit': 'кг',
  'lineTotal': 559,
};
const _receiptItem = <String, dynamic>{
  'name': 'Бауырсак',
  'unitPrice': 1490,
  'quantity': 0.375,
  'unit': 'кг',
  'lineTotal': 559,
};
const _receiptUrl =
    'https://bulka.com.kz/payment-receipts/117615f9-b35f-4eb4-9f6d-777f2236bb25?token=fixture&expires=9999999999';

class _OrderApi extends BulkaApiClient {
  _OrderApi(http.Client client) : super(client: client);
  @override
  Stream<Map<String, dynamic>> get customerEvents => const Stream.empty();
}

Map<String, dynamic> _receiptData({bool discounted = false}) => {
  'documentNumber': 'BLK-WEIGHTED',
  'orderNumber': 42,
  'transactionAt': '2026-10-08T12:00:00Z',
  'amount': discounted ? 509 : 559,
  'discount': discounted ? 100 : 0,
  'bonusSpent': discounted ? 50 : 0,
  'deliveryFee': discounted ? 100 : 0,
  'currency': 'KZT',
  'items': [_receiptItem],
};

void main() {
  setUp(() => appLanguageNotifier.value = 'ru');
  tearDown(() => appLanguageNotifier.value = 'ru');

  test(
    'fractional quantities and units survive saved numeric and string values',
    () {
      expect(orderItemQuantityLabel(_weightedItem), '0.375 кг');
      expect(
        orderItemQuantityLabel({..._weightedItem, 'quantity': '0.375'}),
        '0.375 кг',
      );
      expect(orderItemQuantityLabel({..._weightedItem, 'quantity': 1}), '1 кг');
      expect(orderItemQuantityLabel({'quantity': 2, 'unit': 'шт.'}), '2');
      expect(orderItemQuantityLabel({'quantity': 10, 'unit': 'pcs'}), '10');
      expect(orderItemQuantityLabel({}), '1');
    },
  );

  test(
    'saved line total wins over multiplication and legacy lines round once',
    () {
      expect(orderItemLineTotal(_weightedItem), 559);
      expect(
        orderItemLineTotal({..._weightedItem, 'lineTotal': 550.25}),
        550.25,
      );
      expect(
        orderItemLineTotal({..._weightedItem, 'lineTotal': '550.25'}),
        550.25,
      );
      expect(orderItemLineTotal({..._weightedItem, 'lineTotal': 0}), 0);
      expect(orderItemLineTotal({..._weightedItem}..remove('lineTotal')), 559);
      expect(orderItemLineTotal({..._receiptItem}..remove('lineTotal')), 559);
      expect(orderItemLineTotal({'price': 300, 'quantity': 2}), 600);
    },
  );

  test(
    'PDF table keeps fractional weight and discounts outside item totals',
    () {
      final receipt = PaymentReceipt.fromJson(_receiptData(discounted: true));
      expect(paymentReceiptItemRows(receipt), [
        ['Бауырсак', '0.375 кг', '1490 ₸', '559 ₸'],
      ]);
      expect(receipt.goodsSubtotal, 559);
      expect(
        receipt.goodsSubtotal -
            receipt.discount -
            receipt.bonusSpent +
            receipt.deliveryFee,
        receipt.amount,
      );
    },
  );

  for (final status in ['completed', 'preparing']) {
    testWidgets(
      '$status weighted order shows weight and saved canonical total',
      (tester) async {
        final api = _OrderApi(
          MockClient((_) async => http.Response('{}', 200)),
        );
        addTearDown(api.dispose);
        final order = CustomerOrder(
          id: 'weighted',
          number: 42,
          paymentStatus: 'paid',
          orderStatus: status,
          fulfillmentType: 'pickup',
          amount: 459,
          subtotal: 559,
          discount: 100,
          branch: '',
          earnedBonus: 0,
          deliveryStatus: 'unassigned',
          createdAt: DateTime.utc(2026, 10, 8),
          items: const [_weightedItem],
        );
        await tester.pumpWidget(
          MaterialApp(
            theme: buildBulkaTheme(),
            home: OrderDetailsScreen(
              api: api,
              initialOrder: order,
              onRepeat: (_) async {},
              onOrderChanged: (_) {},
            ),
          ),
        );
        await tester.pumpAndSettle();
        if (status == 'preparing') {
          await tester.scrollUntilVisible(find.text('× 0.375 кг'), 150);
        }
        expect(find.text('× 0.375 кг'), findsOneWidget);
        expect(find.text('× 0'), findsNothing);
        if (status == 'completed') {
          expect(find.text('559 ₸'), findsOneWidget);
          expect(find.text('459 ₸'), findsOneWidget);
          expect(find.text('−100 ₸'), findsOneWidget);
          expect(find.text('0 ₸'), findsNothing);
        }
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  for (final discounted in [false, true]) {
    testWidgets(
      'weighted native receipt ${discounted ? 'with discounts' : 'without discounts'} uses canonical amounts',
      (tester) async {
        final api = _OrderApi(
          MockClient(
            (_) async => http.Response(
              jsonEncode({
                'success': true,
                'receipt': _receiptData(discounted: discounted),
              }),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            ),
          ),
        );
        addTearDown(api.dispose);
        await tester.pumpWidget(
          MaterialApp(
            theme: buildBulkaTheme(),
            home: PaymentReceiptScreen(api: api, receiptUrl: _receiptUrl),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('0.375 кг × 1490 ₸'), findsOneWidget);
        expect(find.text('0 × 1490 ₸'), findsNothing);
        expect(find.text('559 ₸'), findsNWidgets(discounted ? 2 : 3));
        if (discounted) {
          expect(find.text('509 ₸'), findsOneWidget);
          expect(find.text('−100 ₸'), findsOneWidget);
          expect(find.text('−50 ₸'), findsOneWidget);
          expect(find.text('100 ₸'), findsOneWidget);
        }
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  testWidgets(
    'weighted receipt generates a PDF using the same canonical table',
    (tester) async {
      await tester.runAsync(() async {
        final receipt = PaymentReceipt.fromJson(_receiptData(discounted: true));
        expect(paymentReceiptItemRows(receipt).single, [
          'Бауырсак',
          '0.375 кг',
          '1490 ₸',
          '559 ₸',
        ]);
        final bytes = await buildPaymentReceiptPdf(receipt);
        expect(ascii.decode(bytes.take(5).toList()), '%PDF-');
        expect(bytes.length, greaterThan(1000));
        // An optional local output lets the audit inspect the actual PDF text.
        final output = Platform.environment['BULKA_WEIGHTED_RECEIPT_PROOF'];
        if (output != null) await File(output).writeAsBytes(bytes);
      });
      expect(tester.takeException(), isNull);
    },
  );
}

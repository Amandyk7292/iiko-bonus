import 'dart:async';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _CheckoutApi extends BulkaApiClient {
  final events = StreamController<Map<String, dynamic>>.broadcast();
  final requests = <String?>[];
  final scheduledAt = DateTime.utc(2026, 9, 12, 12);
  Completer<Map<String, dynamic>>? pending;
  var directoryLoads = 0;
  int deliveryFee = 0;

  Map<String, dynamic> quote({int discount = 0, int available = 2000}) => {
    'success': true,
    'subtotal': 1120,
    'discount': discount,
    'deliveryFee': deliveryFee,
    'bonusAvailable': available,
    'bonusMaximum': available < (1120 - discount) ~/ 2
        ? available
        : (1120 - discount) ~/ 2,
    'bonusSpent': 0,
    'total': 1120 - discount + deliveryFee,
    'deliveryQuoteToken': 'validated-delivery',
  };

  @override
  Stream<Map<String, dynamic>> get customerEvents => events.stream;
  @override
  Future<List<DeliveryAddress>> getCustomerAddresses() async => [];
  @override
  Future<bool> isFortePaymentAvailable() async => true;
  @override
  Future<List<Map<String, dynamic>>> getFortePaymentMethods() async => [
    {'id': 'card-one', 'brand': 'visa', 'lastFour': '1328', 'isDefault': true},
  ];
  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async {
    directoryLoads++;
    return const [
      BakeryLocation(
        id: 'branch-one',
        name: 'Филиал',
        address: 'Дом 1',
        city: 'Актау',
      ),
    ];
  }

  @override
  Future<List<FulfillmentSlot>> getFulfillmentSlots({
    required String branchId,
    required String orderType,
    int days = 7,
  }) async => [
    FulfillmentSlot(
      startsAt: scheduledAt,
      endsAt: scheduledAt.add(const Duration(hours: 1)),
      capacity: 10,
      remaining: 10,
      serverTime: scheduledAt.subtract(const Duration(hours: 1)),
    ),
  ];
  @override
  Future<Map<String, dynamic>> quoteForteOrder({
    required List<Map<String, dynamic>> cartItems,
    String? orderType,
    String? branch,
    String? branchId,
    String? scheduledAt,
    String? preorderFulfillmentType,
    DeliveryAddress? deliveryAddress,
    String? promoCode,
    bool useBonuses = false,
  }) async {
    requests.add(promoCode);
    return pending?.future ?? quote(discount: promoCode == 'SALE' ? 120 : 0);
  }

  void change() => events.add({
    'type': 'client.data.changed',
    'data': {
      'domains': ['menu'],
    },
  });
}

final _promo = find.byKey(const ValueKey('checkout-promo-input'));
final _apply = find.byKey(const ValueKey('checkout-apply-promo'));
final _bonus = find.byKey(const ValueKey('checkout-use-bonuses'));
final _submit = find.byKey(const ValueKey('checkout-submit'));

Future<_CheckoutApi> _open(WidgetTester tester, {int deliveryFee = 0}) async {
  appLanguageNotifier.value = 'ru';
  tester.view.physicalSize = const Size(430, 1800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final api = _CheckoutApi()..deliveryFee = deliveryFee;
  SharedPreferences.setMockInitialValues({
    'selected_order_type': 'pickup',
    'selected_bakery_location': 'Филиал',
    'selected_bakery_location_id': 'branch-one',
    'checkout_scheduled_at_guest': api.scheduledAt.toIso8601String(),
  });
  await tester.pumpWidget(
    MaterialApp(
      theme: buildBulkaTheme(),
      home: buildCheckoutScreenForTest(
        api: api,
        total: 1120,
        cartItems: const [
          {'productId': 'bun', 'quantity': 2},
        ],
      ),
    ),
  );
  await tester.pumpAndSettle();
  expect(api.requests, ['']);
  expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    await api.events.close();
    api.dispose();
  });
  return api;
}

void main() {
  testWidgets('bonus total changes on the next frame without a quote request', (
    tester,
  ) async {
    final api = await _open(tester);
    for (var i = 0; i < 3; i++) {
      await tester.tap(_bonus);
      await tester.pump();
      expect(find.text('560 ₸'), findsOneWidget);
      expect(find.text('− 560 ₸'), findsOneWidget);
      expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
      await tester.tap(_bonus);
      await tester.pump();
      expect(find.text('1 120 ₸'), findsNWidgets(2));
    }
    expect(api.requests, ['']);
  });

  testWidgets('focus and cursor movement do not discard a valid total', (
    tester,
  ) async {
    final api = await _open(tester);
    await tester.tap(_promo);
    await tester.pump();
    final controller = tester.widget<TextField>(_promo).controller!;
    controller.selection = const TextSelection.collapsed(offset: 0);
    await tester.pump();
    expect(find.text('1 120 ₸'), findsNWidgets(2));
    expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
    expect(api.requests.length, 1);
  });

  testWidgets('empty promo never spins during a slow background quote', (
    tester,
  ) async {
    final api = await _open(tester);
    await tester.pump(const Duration(seconds: 31));
    final pending = api.pending = Completer<Map<String, dynamic>>();
    api.change();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    expect(api.requests.length, 2);
    expect(
      find.descendant(
        of: _apply,
        matching: find.byType(CircularProgressIndicator),
      ),
      findsNothing,
    );
    expect(find.text('1 120 ₸'), findsNWidgets(2));
    await tester.tap(_bonus);
    await tester.pump();
    expect(find.text('560 ₸'), findsOneWidget);
    pending.complete(api.quote());
    await tester.pumpAndSettle();
    expect(find.text('560 ₸'), findsOneWidget);
    expect(tester.widget<SwitchListTile>(_bonus).value, isTrue);
    expect(api.requests.length, 2);
  });

  testWidgets('repeated live events are coalesced and keep totals visible', (
    tester,
  ) async {
    final api = await _open(tester);
    for (var i = 0; i < 8; i++) {
      api.change();
      await tester.pump();
      await tester.pump(const Duration(seconds: 3));
      await tester.pump();
      expect(find.text('1 120 ₸'), findsNWidgets(2));
    }
    expect(api.requests.length, 1);
    expect(api.directoryLoads, 2);
    await tester.pump(const Duration(seconds: 8));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    expect(api.requests.length, 2);
  });

  testWidgets('promo waits for Apply and updates the goods-only bonus limit', (
    tester,
  ) async {
    final api = await _open(tester, deliveryFee: 1000);
    await tester.tap(_bonus);
    await tester.pump();
    expect(find.text('1 560 ₸'), findsOneWidget);
    await tester.enterText(_promo, 'SALE');
    await tester.pump();
    expect(api.requests.length, 1);
    expect(tester.widget<GradientButton>(_submit).onPressed, isNull);
    await tester.tap(_apply);
    await tester.pumpAndSettle();
    expect(api.requests, ['', 'SALE']);
    expect(find.text('− 500 ₸'), findsOneWidget);
    expect(find.text('1 500 ₸'), findsOneWidget);
    expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
    await tester.tap(_apply);
    await tester.pumpAndSettle();
    expect(api.requests.length, 2);
    await tester.enterText(_promo, '');
    await tester.tap(_apply);
    await tester.pumpAndSettle();
    expect(api.requests, ['', 'SALE', '']);
    expect(find.text('1 560 ₸'), findsOneWidget);
  });

  testWidgets('an old background response cannot overwrite the applied promo', (
    tester,
  ) async {
    final api = await _open(tester);
    await tester.pump(const Duration(seconds: 31));
    final pending = api.pending = Completer<Map<String, dynamic>>();
    api.change();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    await tester.enterText(_promo, 'SALE');
    await tester.pump();
    await tester.tap(_apply);
    await tester.pump();
    expect(api.requests, ['', '']);
    expect(tester.widget<GradientButton>(_submit).onPressed, isNull);
    api.pending = null;
    pending.complete(api.quote());
    await tester.pumpAndSettle();
    expect(api.requests, ['', '', 'SALE']);
    expect(find.text('1 000 ₸'), findsOneWidget);
    expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
  });

  testWidgets('failed quote keeps the shown total but prevents payment', (
    tester,
  ) async {
    final api = await _open(tester);
    final pending = api.pending = Completer<Map<String, dynamic>>();
    await tester.enterText(_promo, 'BAD');
    await tester.pump();
    await tester.tap(_apply);
    await tester.pump();
    pending.completeError(ApiException('Промокод недействителен'));
    await tester.pumpAndSettle();
    expect(find.text('1 120 ₸'), findsNWidgets(2));
    expect(tester.widget<GradientButton>(_submit).onPressed, isNull);
    expect(find.byKey(const ValueKey('checkout-quote-error')), findsOneWidget);
  });
}

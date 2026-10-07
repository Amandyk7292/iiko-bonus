import 'dart:async';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _home = DeliveryAddress(
  id: 'home',
  title: 'Дом',
  location: DeliveryLocation(
    city: 'Актау',
    address: 'Промзона 3',
    latitude: 43.65,
    longitude: 51.16,
  ),
  house: '4',
);

const _work = DeliveryAddress(
  id: 'work',
  title: 'Работа',
  location: DeliveryLocation(
    city: 'Актау',
    address: '19-й микрорайон',
    latitude: 43.67,
    longitude: 51.17,
  ),
  house: '12',
);

class _DeliveryQuoteApi extends BulkaApiClient {
  final events = StreamController<Map<String, dynamic>>.broadcast();
  final requestedAddresses = <String>[];
  bool directoryFails = false;
  String? quoteError;
  Completer<Map<String, dynamic>>? pending;

  @override
  Stream<Map<String, dynamic>> get customerEvents => events.stream;

  @override
  Future<bool> isFortePaymentAvailable() async => true;

  @override
  Future<List<Map<String, dynamic>>> getFortePaymentMethods() async => [
    {'id': 'card-one', 'brand': 'visa', 'lastFour': '1328', 'isDefault': true},
  ];

  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async {
    if (directoryFails) throw ApiException('Список филиалов недоступен');
    // The server can resolve a delivery branch even with an empty local cache.
    return const [];
  }

  @override
  Future<List<FulfillmentSlot>> getFulfillmentSlots({
    required String branchId,
    required String orderType,
    int days = 7,
    List<String> productIds = const [],
  }) async => throw StateError('ASAP delivery must not restore pickup slots');

  Map<String, dynamic> quote(String addressId) => {
    'success': true,
    'branchId': 'server-fallback-branch',
    'scheduledAt': '2026-10-07T11:00:00.000Z',
    'subtotal': 180,
    'discount': 0,
    'deliveryFee': addressId == 'work' ? 700 : 500,
    'bonusAvailable': 1000,
    'bonusMaximum': 90,
    'bonusSpent': 0,
    'total': addressId == 'work' ? 880 : 680,
    'deliveryQuoteToken': 'signed-$addressId',
  };

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
    expect(orderType, 'delivery');
    expect(scheduledAt, isNull);
    expect(branch, isNull);
    expect(branchId, isNull);
    final address = deliveryAddress!;
    requestedAddresses.add(address.id);
    if (quoteError != null) {
      throw ApiException(
        quoteError!,
        code: 'CHECKOUT_DELIVERY_SLOT_UNAVAILABLE',
      );
    }
    final waiting = pending;
    pending = null;
    return waiting?.future ?? quote(address.id);
  }

  void branchesChanged() => events.add({
    'type': 'client.data.changed',
    'data': {
      'branchId': 'another-delivery-branch',
      'domains': ['locations'],
    },
  });
}

final _submit = find.byKey(const ValueKey('checkout-submit'));

Future<_DeliveryQuoteApi> _open(
  WidgetTester tester, {
  _DeliveryQuoteApi? client,
  bool withAddress = true,
}) async {
  appLanguageNotifier.value = 'ru';
  tester.view.physicalSize = const Size(430, 1500);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  SharedPreferences.setMockInitialValues({
    'selected_order_type': 'delivery',
    'selected_bakery_location_id': 'old-pickup-branch',
    'checkout_scheduled_at_guest': '2026-10-06T09:00:00.000Z',
  });
  final api = client ?? _DeliveryQuoteApi();
  if (withAddress) {
    final repository = AddressRepository(api: api);
    await repository.saveAddress(_work);
    await repository.saveAddress(_home);
  }
  await tester.pumpWidget(
    MaterialApp(
      theme: buildBulkaTheme(),
      home: buildCheckoutScreenForTest(
        api: api,
        total: 180,
        cartItems: const [
          {'id': 'bun', 'quantity': 1},
        ],
      ),
    ),
  );
  await tester.pumpAndSettle();
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    await api.events.close();
    api.dispose();
  });
  return api;
}

Future<void> _chooseWork(WidgetTester tester) async {
  await tester.tap(find.text(_home.displayAddress));
  await tester.pumpAndSettle();
  await tester.tap(find.text(_work.title));
  await tester.pumpAndSettle();
  await tester.tap(find.text('continue_btn'.tr));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'delivery immediately quotes address with goods and delivery fee',
    (tester) async {
      final api = await _open(tester);
      expect(api.requestedAddresses, ['home']);
      expect(find.text('680 ₸'), findsOneWidget);
      expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
    },
  );

  testWidgets('a failed local directory cannot prevent the server quote', (
    tester,
  ) async {
    final api = await _open(
      tester,
      client: _DeliveryQuoteApi()..directoryFails = true,
    );
    expect(api.requestedAddresses, ['home']);
    expect(find.text('680 ₸'), findsOneWidget);
    expect(find.text('checkout_delivery_unavailable'.tr), findsNothing);
    expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
  });

  testWidgets('changing the delivery address immediately recalculates total', (
    tester,
  ) async {
    final api = await _open(tester);
    await _chooseWork(tester);
    expect(api.requestedAddresses, ['home', 'work']);
    expect(find.text('680 ₸'), findsNothing);
    expect(find.text('880 ₸'), findsOneWidget);
    expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
  });

  testWidgets(
    'unavailable delivery shows cause and recovers for another branch',
    (tester) async {
      final api = await _open(
        tester,
        client: _DeliveryQuoteApi()
          ..quoteError = 'Нет свободного времени доставки',
      );
      expect(find.text('checkout_delivery_no_slots'.tr), findsOneWidget);
      expect(tester.widget<GradientButton>(_submit).onPressed, isNull);
      api.quoteError = null;
      api.branchesChanged();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pumpAndSettle();
      expect(api.requestedAddresses, ['home', 'home']);
      expect(find.text('680 ₸'), findsOneWidget);
      expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
    },
  );

  testWidgets('a late old-address quote cannot replace the current total', (
    tester,
  ) async {
    final api = await _open(tester);
    final waiting = api.pending = Completer<Map<String, dynamic>>();
    api.branchesChanged();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await _chooseWork(tester);
    expect(tester.widget<GradientButton>(_submit).onPressed, isNull);
    waiting.complete(api.quote('home'));
    await tester.pumpAndSettle();
    expect(api.requestedAddresses, ['home', 'home', 'work']);
    expect(find.text('680 ₸'), findsNothing);
    expect(find.text('880 ₸'), findsOneWidget);
    expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
  });

  testWidgets('delivery without a chosen address cannot quote or pay', (
    tester,
  ) async {
    final api = await _open(tester, withAddress: false);
    expect(api.requestedAddresses, isEmpty);
    expect(tester.widget<GradientButton>(_submit).onPressed, isNull);
  });

  testWidgets('live directory failure still refreshes the delivery quote', (
    tester,
  ) async {
    final api = await _open(tester);
    api.directoryFails = true;
    api.branchesChanged();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    expect(api.requestedAddresses, ['home', 'home']);
    expect(find.text('680 ₸'), findsOneWidget);
    expect(find.byKey(const ValueKey('checkout-quote-error')), findsNothing);
    expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
  });

  testWidgets(
    'reselecting same address keeps the pending initial quote valid',
    (tester) async {
      final waiting = Completer<Map<String, dynamic>>();
      final api = await _open(
        tester,
        client: _DeliveryQuoteApi()..pending = waiting,
      );
      await tester.tap(find.text(_home.displayAddress));
      await tester.pumpAndSettle();
      await tester.tap(find.text('continue_btn'.tr));
      await tester.pumpAndSettle();
      waiting.complete(api.quote('home'));
      await tester.pumpAndSettle();
      expect(api.requestedAddresses, ['home']);
      expect(find.text('680 ₸'), findsOneWidget);
      expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
    },
  );

  testWidgets('leaving checkout ignores a late delivery quote', (tester) async {
    final waiting = Completer<Map<String, dynamic>>();
    final api = await _open(
      tester,
      client: _DeliveryQuoteApi()..pending = waiting,
    );
    await tester.pumpWidget(const SizedBox.shrink());
    waiting.complete(api.quote('home'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}

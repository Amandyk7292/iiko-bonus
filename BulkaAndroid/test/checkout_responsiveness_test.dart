import 'dart:async';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _CheckoutApi extends BulkaApiClient {
  final events = StreamController<Map<String, dynamic>>.broadcast();
  final requests = <String?>[];
  DateTime scheduledAt = DateTime.utc(2026, 9, 12, 12);
  DateTime? serverNow;
  Completer<Map<String, dynamic>>? pending;
  var directoryLoads = 0;
  int deliveryFee = 0;
  int slotDuration = 60;
  bool slotsAvailable = true;
  Completer<List<FulfillmentSlot>>? pendingSlots;
  Completer<List<BakeryLocation>>? pendingLocations;
  bool branchAvailable = true;

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
    final waiting = pendingLocations;
    pendingLocations = null;
    if (waiting != null) return waiting.future;
    if (!branchAvailable) return [];
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
    List<String> productIds = const [],
  }) async {
    final waiting = pendingSlots;
    pendingSlots = null;
    if (waiting != null) return waiting.future;
    if (!slotsAvailable) return [];
    return [
      FulfillmentSlot(
        startsAt: scheduledAt,
        endsAt: scheduledAt.add(Duration(minutes: slotDuration)),
        capacity: 10,
        remaining: 10,
        serverTime: serverNow ?? scheduledAt.subtract(const Duration(hours: 1)),
      ),
    ];
  }

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

  void change([String domain = 'menu']) => events.add({
    'type': 'client.data.changed',
    'data': {
      'domains': [domain],
    },
  });
}

final _promo = find.byKey(const ValueKey('checkout-promo-input'));
final _apply = find.byKey(const ValueKey('checkout-apply-promo'));
final _bonus = find.byKey(const ValueKey('checkout-use-bonuses'));
final _submit = find.byKey(const ValueKey('checkout-submit'));

Future<_CheckoutApi> _open(
  WidgetTester tester, {
  int deliveryFee = 0,
  DateTime? scheduledAt,
  DateTime? serverNow,
  Future<FortePaymentOutcome> Function()? onSubmit,
}) async {
  appLanguageNotifier.value = 'ru';
  tester.view.physicalSize = const Size(430, 1800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final api = _CheckoutApi()..deliveryFee = deliveryFee;
  if (scheduledAt != null) api.scheduledAt = scheduledAt;
  api.serverNow = serverNow;
  SharedPreferences.setMockInitialValues({
    'selected_order_type': 'pickup',
    'selected_bakery_location': 'Филиал',
    'selected_bakery_location_id': 'branch-one',
    'checkout_scheduled_at_guest': api.scheduledAt.toIso8601String(),
  });
  await tester.pumpWidget(
    MaterialApp(
      theme: buildBulkaTheme(),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(alwaysUse24HourFormat: true),
        child: child!,
      ),
      home: buildCheckoutScreenForTest(
        api: api,
        total: 1120,
        cartItems: const [
          {'productId': 'bun', 'quantity': 2},
        ],
        onSubmit: onSubmit,
      ),
    ),
  );
  await tester.pumpAndSettle();
  expect(api.requests, ['']);
  expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
  expect(find.byKey(const ValueKey('checkout-steps')), findsOneWidget);
  expect(find.text('Адрес'), findsOneWidget);
  expect(find.text('Время'), findsOneWidget);
  expect(find.text('Оплата'), findsOneWidget);
  expect(find.byKey(const ValueKey('checkout-sticky-action')), findsOneWidget);
  expect(find.byKey(const ValueKey('checkout-price-breakdown')), findsNothing);
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    await api.events.close();
    api.dispose();
  });
  return api;
}

void main() {
  testWidgets(
    'ordinary midnight slots show Tomorrow in checkout and the time picker',
    (tester) async {
      final scheduledAt = DateTime.utc(
        2026,
        12,
        31,
        19,
      ); // 00:00 on January 1 in Kazakhstan.
      final api = await _open(
        tester,
        scheduledAt: scheduledAt,
        serverNow: DateTime.utc(2026, 12, 31, 18, 50),
      );
      expect(find.text('Завтра, 00:00–01:00'), findsOneWidget);
      await tester.tap(find.text('Завтра, 00:00–01:00'));
      await tester.pumpAndSettle();
      expect(find.text('Завтра, 00:00–01:00'), findsNWidgets(2));
      await tester.tap(find.text('continue_btn'.tr));
      await tester.pumpAndSettle();
      final prefs = await SharedPreferences.getInstance();
      expect(
        prefs.getString('checkout_scheduled_at_guest'),
        api.scheduledAt.toIso8601String(),
      );
      expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
    },
  );
  testWidgets('cached time choices open before a slow refresh finishes', (
    tester,
  ) async {
    final api = await _open(tester);
    final waiting = api.pendingSlots = Completer<List<FulfillmentSlot>>();
    await tester.tap(find.text('17:00–18:00'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('continue_btn'.tr), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    waiting.complete([]);
    await tester.pumpAndSettle();
    expect(find.text('checkout_no_time_slots'.tr), findsOneWidget);
  });

  testWidgets(
    'hours changes bypass checkout cooldown and update the selected interval',
    (tester) async {
      final api = await _open(tester);
      api.change();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pumpAndSettle();
      expect(api.requests.length, 2);
      expect(find.text('17:00–18:00'), findsOneWidget);
      await tester.enterText(_promo, 'DRAFT');
      api.slotDuration = 30;
      api.change('locations');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pumpAndSettle();
      expect(find.text('17:00–17:30'), findsOneWidget);
      expect(api.requests.length, 3);
      expect(tester.widget<TextField>(_promo).controller!.text, 'DRAFT');
    },
  );

  testWidgets('removed selected time is cleared without allowing payment', (
    tester,
  ) async {
    final api = await _open(tester);
    api.slotsAvailable = false;
    api.change('locations');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    expect(find.text('17:00–18:00'), findsNothing);
    expect(tester.widget<GradientButton>(_submit).onPressed, isNull);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('checkout_scheduled_at_guest'), isNull);
  });

  testWidgets('an already open time picker refreshes after hours change', (
    tester,
  ) async {
    final api = await _open(tester);
    await tester.tap(find.text('17:00–18:00'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    api.slotDuration = 30;
    api.change('locations');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.text('17:00–18:00'), findsNothing);
    expect(find.text('17:00–17:30'), findsWidgets);
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('continue_btn'.tr));
    await tester.pumpAndSettle();
    expect(find.text('17:00–17:30'), findsOneWidget);
    expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
  });

  testWidgets('a late slot response cannot restore an outdated interval', (
    tester,
  ) async {
    final api = await _open(tester);
    final outdated = await api.getFulfillmentSlots(
      branchId: 'branch-one',
      orderType: 'pickup',
    );
    final waiting = api.pendingSlots = Completer<List<FulfillmentSlot>>();
    await tester.tap(find.text('17:00–18:00'));
    await tester.pump();
    api.slotDuration = 30;
    api.change('locations');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    waiting.complete(outdated);
    await tester.pumpAndSettle();
    expect(find.text('17:00–18:00'), findsNothing);
    expect(find.text('17:00–17:30'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('open picker recovers after a failed hours refresh', (
    tester,
  ) async {
    final api = await _open(tester);
    await tester.tap(find.text('17:00–18:00'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    final waiting = api.pendingSlots = Completer<List<FulfillmentSlot>>();
    api.change('locations');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    waiting.completeError(StateError('Schedule unavailable'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.byType(ListWheelScrollView), findsNothing);
    expect(tester.widget<GradientButton>(_submit).onPressed, isNull);
    api.slotDuration = 30;
    api.change('locations');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.byType(ListWheelScrollView), findsOneWidget);
    expect(find.text('17:00–17:30'), findsWidgets);
    await tester.tap(find.text('continue_btn'.tr));
    await tester.pumpAndSettle();
    expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'closing time explains why a new pickup can no longer be scheduled',
    (tester) async {
      final api = await _open(tester);
      final waiting = api.pendingSlots = Completer<List<FulfillmentSlot>>();
      await tester.tap(find.text('17:00–18:00'));
      await tester.pump();
      waiting.completeError(
        FulfillmentSlotsUnavailable('checkout_time_closing_soon'.tr),
      );
      await tester.pumpAndSettle();
      expect(find.text('checkout_time_closing_soon'.tr), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('bonus total changes on the next frame without a quote request', (
    tester,
  ) async {
    final api = await _open(tester);
    for (var i = 0; i < 3; i++) {
      await tester.tap(_bonus);
      await tester.pump();
      expect(find.text('560 ₸'), findsOneWidget);
      expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
      await tester.tap(_bonus);
      await tester.pump();
      expect(find.text('1 120 ₸'), findsOneWidget);
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
    expect(find.text('1 120 ₸'), findsOneWidget);
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
    expect(find.text('1 120 ₸'), findsOneWidget);
    await tester.tap(_bonus);
    await tester.pump();
    expect(find.text('560 ₸'), findsOneWidget);
    pending.complete(api.quote());
    await tester.pumpAndSettle();
    expect(find.text('560 ₸'), findsOneWidget);
    expect(tester.widget<SwitchListTile>(_bonus).value, isTrue);
    expect(api.requests.length, 2);
  });

  testWidgets('unchanged checkout stays actionable throughout live refresh', (
    tester,
  ) async {
    final api = await _open(tester);
    final locations = await api.getFulfillmentLocations();
    final directory = api.pendingLocations = Completer<List<BakeryLocation>>();
    final quote = api.pending = Completer<Map<String, dynamic>>();
    api.change();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
    directory.complete(locations);
    await tester.pump();
    expect(api.requests.length, 2);
    for (var second = 0; second < 5; second++) {
      await tester.pump(const Duration(seconds: 1));
      expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
      expect(find.text('1 120 ₸'), findsOneWidget);
    }
    quote.complete(api.quote());
    await tester.pumpAndSettle();
    expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
  });

  testWidgets('a failed unchanged-input refresh blocks payment until retry', (
    tester,
  ) async {
    final api = await _open(tester);
    final waiting = api.pending = Completer<Map<String, dynamic>>();
    api.change();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
    waiting.completeError(ApiException('Не удалось проверить цену'));
    await tester.pumpAndSettle();
    expect(tester.widget<GradientButton>(_submit).onPressed, isNull);
    expect(find.text('1 120 ₸'), findsOneWidget);
    expect(find.byKey(const ValueKey('checkout-quote-error')), findsOneWidget);
    api.pending = null;
    api.change();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
  });

  testWidgets('a tap waits for live validation and starts only one order', (
    tester,
  ) async {
    var submitted = 0;
    final api = await _open(
      tester,
      onSubmit: () async {
        submitted++;
        return FortePaymentOutcome.pending;
      },
    );
    final slots = await api.getFulfillmentSlots(
      branchId: 'branch-one',
      orderType: 'pickup',
    );
    final quote = api.pending = Completer<Map<String, dynamic>>();
    final schedule = api.pendingSlots = Completer<List<FulfillmentSlot>>();
    api.change();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(_submit);
    await tester.pump();
    await tester.tap(_submit);
    await tester.pump();
    expect(submitted, 0);
    expect(tester.widget<GradientButton>(_submit).loading, isTrue);
    quote.complete(api.quote());
    await tester.pump();
    expect(submitted, 0);
    schedule.complete(slots);
    await tester.pumpAndSettle();
    expect(submitted, 1);
    expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
  });

  testWidgets('a price changed after the tap requires a second confirmation', (
    tester,
  ) async {
    var submitted = 0;
    final api = await _open(
      tester,
      onSubmit: () async {
        submitted++;
        return FortePaymentOutcome.pending;
      },
    );
    final quote = api.pending = Completer<Map<String, dynamic>>();
    api.change();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(_submit);
    await tester.pump();
    quote.complete({...api.quote(), 'subtotal': 1500, 'total': 1500});
    await tester.pumpAndSettle();
    expect(submitted, 0);
    expect(find.text('1 500 ₸'), findsOneWidget);
    expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
    await tester.tap(_submit);
    await tester.pumpAndSettle();
    expect(submitted, 1);
  });

  testWidgets('a failed quote during a tap cannot start payment', (
    tester,
  ) async {
    var submitted = 0;
    final api = await _open(
      tester,
      onSubmit: () async {
        submitted++;
        return FortePaymentOutcome.pending;
      },
    );
    final quote = api.pending = Completer<Map<String, dynamic>>();
    api.change();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(_submit);
    await tester.pump();
    quote.completeError(ApiException('Товар недоступен'));
    await tester.pumpAndSettle();
    expect(submitted, 0);
    expect(tester.widget<GradientButton>(_submit).onPressed, isNull);
    expect(tester.widget<GradientButton>(_submit).loading, isFalse);
  });

  testWidgets('a removed branch invalidates a previously valid checkout', (
    tester,
  ) async {
    final api = await _open(tester);
    api.branchAvailable = false;
    api.change('locations');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    expect(tester.widget<GradientButton>(_submit).onPressed, isNull);
  });

  testWidgets('repeated live events are coalesced and keep totals visible', (
    tester,
  ) async {
    final api = await _open(tester);
    for (var i = 0; i < 8; i++) {
      api.change();
      await tester.pump();
      expect(find.text('1 120 ₸'), findsOneWidget);
    }
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    expect(api.requests.length, 2);
    api.change();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    expect(api.requests.length, 3);
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
    expect(find.text('1 120 ₸'), findsOneWidget);
    expect(tester.widget<GradientButton>(_submit).onPressed, isNull);
    expect(find.byKey(const ValueKey('checkout-quote-error')), findsOneWidget);
  });
}

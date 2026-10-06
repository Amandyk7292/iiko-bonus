import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _PaymentUiApi extends BulkaApiClient {
  final events = StreamController<Map<String, dynamic>>.broadcast();
  final startsAt = DateTime.utc(2026, 10, 6, 6);
  Completer<Map<String, dynamic>>? pendingAccount;
  Completer<List<Map<String, dynamic>>>? pendingCards;
  bool accountBlocked = false;
  int cardSetupCalls = 0;
  Completer<Map<String, dynamic>>? pendingCardSetup;

  @override
  Stream<Map<String, dynamic>> get customerEvents => events.stream;
  @override
  Future<List<DeliveryAddress>> getCustomerAddresses() async => [];
  @override
  Future<bool> isFortePaymentAvailable() async => true;
  @override
  Future<Map<String, dynamic>> getPersonalAccount() async =>
      pendingAccount?.future ?? account;

  Map<String, dynamic> get account => {
    'enabled': true,
    'blocked': accountBlocked,
    'balance': 2500,
  };

  @override
  Future<List<Map<String, dynamic>>> getFortePaymentMethods() async =>
      pendingCards?.future ?? cards;

  @override
  Future<Map<String, dynamic>> createForteCardSetup() async {
    cardSetupCalls++;
    if (pendingCardSetup != null) return pendingCardSetup!.future;
    throw ApiException(
      'Bank unavailable',
      code: 'FORTE_WIDGET_CHECKOUT_DISABLED',
    );
  }

  List<Map<String, dynamic>> get cards => [
    {'id': 'card-one', 'brand': 'visa', 'lastFour': '1328', 'isDefault': true},
    {'id': 'card-two', 'brand': 'mastercard', 'lastFour': '2046'},
  ];

  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => const [
    BakeryLocation(
      id: 'branch-one',
      name: '19а ЖК Жасыл дала',
      address: 'Дом 1',
      city: 'Актау',
    ),
  ];

  @override
  Future<List<FulfillmentSlot>> getFulfillmentSlots({
    required String branchId,
    required String orderType,
    int days = 7,
    List<String> productIds = const [],
  }) async => [
    FulfillmentSlot(
      startsAt: startsAt,
      endsAt: startsAt.add(const Duration(hours: 1)),
      capacity: 10,
      remaining: 10,
      serverTime: startsAt.subtract(const Duration(hours: 1)),
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
  }) async => {
    'success': true,
    'subtotal': 180,
    'discount': 0,
    'deliveryFee': 0,
    'bonusAvailable': 1000,
    'bonusMaximum': 90,
    'bonusSpent': 0,
    'total': 180,
    'deliveryQuoteToken': 'validated-delivery',
    'eta': {'estimatedReadyAt': startsAt.toIso8601String()},
  };
}

Future<void> _loadFonts() async {
  for (final entry in {
    'MontserratBold': 'assets/fonts/Montserrat-Bold-subset.ttf',
    'Montserrat': 'assets/fonts/Montserrat-Regular-subset.ttf',
    'MaterialIcons': 'assets/fonts/BulkaIcons.ttf',
  }.entries) {
    final loader = FontLoader(entry.key)..addFont(rootBundle.load(entry.value));
    await loader.load();
  }
}

Future<void> _capture(WidgetTester tester, String name) async {
  final directory = Platform.environment['BULKA_CHECKOUT_RENDER_DIR'];
  if (directory == null) return;
  final boundary = tester.renderObject<RenderRepaintBoundary>(
    find.byKey(const ValueKey('checkout-ui-render')),
  );
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 1);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await Directory(directory).create(recursive: true);
    await File(
      '$directory/$name.png',
    ).writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}

Future<_PaymentUiApi> _openCheckout(
  WidgetTester tester, {
  double width = 430,
  double textScale = 1,
}) async {
  appLanguageNotifier.value = 'ru';
  tester.view.physicalSize = Size(width, 932);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final api = _PaymentUiApi();
  SharedPreferences.setMockInitialValues({
    'selected_order_type': 'pickup',
    'selected_bakery_location': '19а ЖК Жасыл дала',
    'selected_bakery_location_id': 'branch-one',
    'checkout_scheduled_at_guest': api.startsAt.toIso8601String(),
  });
  await tester.runAsync(_loadFonts);
  await tester.pumpWidget(
    RepaintBoundary(
      key: const ValueKey('checkout-ui-render'),
      child: MaterialApp(
        theme: buildBulkaTheme(),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: TextScaler.linear(textScale),
            alwaysUse24HourFormat: true,
          ),
          child: child!,
        ),
        home: buildCheckoutScreenForTest(
          api: api,
          total: 180,
          cartItems: const [
            {'productId': 'bun', 'quantity': 1},
          ],
        ),
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

Future<void> _openMethods(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('checkout-choose-card')));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a saved card is not marked as a completed payment', (
    tester,
  ) async {
    await _openCheckout(tester);
    final paymentStep = find.byKey(const ValueKey('checkout-step-3'));
    expect(
      find.descendant(of: paymentStep, matching: find.text('3')),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: paymentStep,
        matching: find.byIcon(Icons.check_rounded),
      ),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('checkout-price-breakdown')),
      findsNothing,
    );
    expect(find.text('checkout_summary_title'.tr), findsNothing);
    expect(find.text('180 ₸'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('checkout-sticky-action')),
        matching: find.byKey(const ValueKey('checkout-payment-selector')),
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
    await _capture(tester, 'checkout-430');
  });

  testWidgets(
    'payment sheet selects personal account and saved cards with no helper copy',
    (tester) async {
      await _openCheckout(tester);
      await _openMethods(tester);
      expect(find.text('checkout_payment_title'.tr), findsOneWidget);
      expect(find.text('2500.00 ₸'), findsOneWidget);
      expect(find.text('checkout_add_new_card'.tr), findsOneWidget);
      expect(find.text('payment_methods_verification_hint'.tr), findsNothing);
      expect(find.text('Apple Pay'), findsNothing);
      expect(find.text('Kaspi'), findsNothing);
      await _capture(tester, 'payment-methods-430');
      await tester.tap(find.byKey(const ValueKey('checkout-personal-account')));
      await tester.pumpAndSettle();
      expect(find.text('Личный счёт'), findsOneWidget);
      await _openMethods(tester);
      await tester.tap(
        find.byKey(const ValueKey('checkout-saved-card-card-two')),
      );
      await tester.pumpAndSettle();
      expect(find.text('•••• 2046'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('checkout-close-card-picker')),
        findsNothing,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('a blocked personal account cannot become the selected payment', (
    tester,
  ) async {
    final api = await _openCheckout(tester);
    api.accountBlocked = true;
    api.events.add({'type': 'personal-account.updated'});
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    await _openMethods(tester);
    final accountRow = tester.widget<ListTile>(
      find.byKey(const ValueKey('checkout-personal-account')),
    );
    expect(accountRow.onTap, isNull);
    expect(find.text('•••• 1328'), findsNWidgets(2));
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'compact payment selector and sheet fit narrow screens with larger text',
    (tester) async {
      await _openCheckout(tester, width: 320, textScale: 1.3);
      expect(tester.takeException(), isNull);
      expect(
        tester
            .getRect(find.byKey(const ValueKey('checkout-payment-selector')))
            .right,
        lessThan(tester.getRect(find.text('180 ₸')).left),
      );
      await _openMethods(tester);
      expect(tester.takeException(), isNull);
      await _capture(tester, 'payment-methods-320-text-130');
    },
  );

  testWidgets('an open payment sheet updates after a slow card load', (
    tester,
  ) async {
    final api = _PaymentUiApi();
    final cards = api.pendingCards = Completer<List<Map<String, dynamic>>>();
    final account = api.pendingAccount = Completer<Map<String, dynamic>>();
    String? selectedId;
    bool personalAccountSelected = false;
    bool accountAvailable = false;
    late StateSetter update;
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: Scaffold(
          body: StatefulBuilder(
            builder: (context, setState) {
              update = setState;
              return buildCheckoutSavedCardsPanelForTest(
                api: api,
                compact: true,
                personalAccountSelected: personalAccountSelected,
                selectedMethodId: selectedId,
                onDefaultResolved: (id) => update(() => selectedId = id),
                onSelect: (id) => update(() => selectedId = id),
                onPersonalAccountAvailable: (available) =>
                    accountAvailable = available,
                onSelectPersonalAccount: () =>
                    update(() => personalAccountSelected = true),
              );
            },
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('checkout-choose-card')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byType(CircularProgressIndicator), findsWidgets);
    cards.complete(api.cards);
    account.complete(api.account);
    await tester.pumpAndSettle();
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(
      find.byKey(const ValueKey('checkout-saved-card-card-one')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('checkout-personal-account')),
      findsOneWidget,
    );
    expect(accountAvailable, isTrue);
    await tester.pumpWidget(const SizedBox.shrink());
    await api.events.close();
    api.dispose();
  });

  testWidgets(
    'adding a card starts the existing bank flow and preserves the selected card on failure',
    (tester) async {
      final api = await _openCheckout(tester);
      await _openMethods(tester);
      await tester.tap(find.byKey(const ValueKey('checkout-add-saved-card')));
      await tester.pumpAndSettle();
      expect(api.cardSetupCalls, 1);
      expect(find.text('payment_methods_add_unavailable'.tr), findsOneWidget);
      expect(find.text('•••• 1328'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'checkout waits for a requested card binding and recovers after a bank failure',
    (tester) async {
      final api = await _openCheckout(tester);
      final setup = api.pendingCardSetup = Completer<Map<String, dynamic>>();
      await _openMethods(tester);
      await tester.tap(find.byKey(const ValueKey('checkout-add-saved-card')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(api.cardSetupCalls, 1);
      expect(
        tester
            .widget<GradientButton>(
              find.byKey(const ValueKey('checkout-submit')),
            )
            .onPressed,
        isNull,
      );
      setup.completeError(
        ApiException(
          'Bank unavailable',
          code: 'FORTE_WIDGET_CHECKOUT_DISABLED',
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('•••• 1328'), findsOneWidget);
      expect(
        tester
            .widget<GradientButton>(
              find.byKey(const ValueKey('checkout-submit')),
            )
            .onPressed,
        isNotNull,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'availability changes safely update an already open payment sheet',
    (tester) async {
      final api = _PaymentUiApi();
      String? selectedId;
      bool? available = true;
      late StateSetter update;
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: Scaffold(
            body: StatefulBuilder(
              builder: (context, setState) {
                update = setState;
                return buildCheckoutSavedCardsPanelForTest(
                  api: api,
                  compact: true,
                  available: available,
                  selectedMethodId: selectedId,
                  onDefaultResolved: (id) => update(() => selectedId = id),
                  onSelect: (id) => update(() => selectedId = id),
                );
              },
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await _openMethods(tester);
      update(() => available = false);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('checkout-saved-card-card-one')),
        findsNothing,
      );
      expect(find.text('checkout_forte_unavailable'.tr), findsOneWidget);
      expect(selectedId, isNull);
      update(() => available = true);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('checkout-saved-card-card-one')),
        findsOneWidget,
      );
      expect(selectedId, 'card-one');
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await api.events.close();
      api.dispose();
    },
  );
}

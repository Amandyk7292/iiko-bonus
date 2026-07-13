import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:bulka_bonus/core/cart_provider.dart';

void main() {
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({});
  });

  test('all translations contain ru, kk and en values', () {
    expect(translationValidationErrors(), isEmpty);
  });

  test('delivery payload preserves exact address coordinates and details', () {
    const address = DeliveryAddress(
      id: 'address-1',
      title: 'Дом',
      location: DeliveryLocation(
        city: 'Актау',
        address: '17-й микрорайон',
        latitude: 43.66944,
        longitude: 51.136929,
      ),
      house: '1',
      entrance: '2',
      floor: '4',
      apartment: '18',
      courierComment: 'Позвонить заранее',
    );

    expect(address.hasValidCoordinates, isTrue);
    expect(address.toOrderPayload(), {
      'label': 'Дом',
      'address': '17-й микрорайон, 1',
      'city': 'Актау',
      'latitude': 43.66944,
      'longitude': 51.136929,
      'entrance': '2',
      'floor': '4',
      'apartment': '18',
      'comment': 'Позвонить заранее',
    });
  });

  test('fulfillment location reads delivery rules from the API', () {
    final location = BakeryLocation.fromJson({
      'id': '48f71218-aa08-51bf-a6d9-2497c4a1e55b',
      'name': 'ЖК Дукат',
      'address': '17-й микрорайон, 1',
      'city': 'Актау',
      'latitude': 43.66944,
      'longitude': 51.136929,
      'hours': {
        'daily': {'open': '08:00', 'close': '24:00'},
      },
      'deliveryEnabled': true,
      'deliveryRadiusKm': 5.5,
      'deliveryFee': 800,
      'deliveryMinOrder': 5000,
    });

    expect(location.supports('delivery'), isTrue);
    expect(location.deliveryRadiusKm, 5.5);
    expect(location.deliveryFee, 800);
    expect(location.deliveryMinOrder, 5000);
  });

  test('cart immediately reconciles menu price, image and stop-list state', () {
    final cart = CartProvider();
    cart.addItem(
      productId: 'product-1',
      name: 'Старое название',
      price: 1000,
      imageUrl: 'old.jpg',
    );

    cart.reconcileMenu(const [
      CartProductSnapshot(
        id: 'product-1',
        name: 'Новое название',
        price: 1250,
        imageUrl: 'new.jpg',
        isStopListed: true,
      ),
    ]);

    final item = cart.items['product-1']!;
    expect(item.name, 'Новое название');
    expect(item.price, 1250);
    expect(item.imageUrl, 'new.jpg');
    expect(item.isStopListed, isTrue);
    expect(item.quantity, 1);

    cart.setQuantity('product-1', 2);
    expect(cart.getQuantity('product-1'), 1);
    cart.setQuantity('product-1', 0);
    expect(cart.items, isEmpty);
  });

  testWidgets('address header fits a narrow screen with larger text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.3)),
          child: child!,
        ),
        home: const AddressSelectionScreen(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Выберите адрес'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('checkout remains usable at 320px with larger text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final cart = CartProvider()
      ..addItem(
        productId: 'product-1',
        name: 'Вишнёво-яблочный пирог четвертинка',
        price: 2500,
        imageUrl: '',
      );

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.3)),
          child: child!,
        ),
        home: ChangeNotifierProvider.value(
          value: cart,
          child: MainShell(
            api: _FakeBulkaApiClient(),
            customer: _testCustomer,
            transactions: _testTransactions,
            initialTab: 2,
            onLogout: () async {},
            onRefreshProfile: () async {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Оформить заказ'));
    await tester.pumpAndSettle();

    expect(find.text('Оформление заказа'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('all main tabs fit 320px with larger text', (tester) async {
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.3)),
          child: child!,
        ),
        home: ChangeNotifierProvider(
          create: (_) => CartProvider(),
          child: MainShell(
            api: _FakeBulkaApiClient(),
            customer: _testCustomer,
            transactions: _testTransactions,
            onLogout: () async {},
            onRefreshProfile: () async {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    for (final tab in [1, 3, 4]) {
      await tester.tap(find.byKey(ValueKey('nav-$tab')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'tab $tab overflowed');
    }
  });

  testWidgets('shows login screen', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: LoginScreen(
          onRequestOtp: (_, _) async => const OtpRequestResult(),
          onVerifyOtp: (_, _) async => null,
        ),
      ),
    );

    expect(
      find.image(const AssetImage('assets/brand/bulka_logo.png')),
      findsOneWidget,
    );
    expect(find.text('Получить код'), findsOneWidget);
  });

  testWidgets('keeps the branded splash during minimum boot time', (
    tester,
  ) async {
    await tester.pumpWidget(const BulkaBonusApp());
    await tester.pump();

    expect(find.byType(SplashScreen), findsOneWidget);
    expect(
      find.image(const AssetImage('assets/brand/bulka_logo.png')),
      findsOneWidget,
    );

    await tester.pump(const Duration(milliseconds: 699));
    expect(find.byType(SplashScreen), findsOneWidget);

    await tester.pump(const Duration(milliseconds: 1));
    await tester.pump();
    expect(find.byType(LoginScreen), findsOneWidget);
  });

  testWidgets('motion primitives honor the system reduced-motion setting', (
    tester,
  ) async {
    var second = false;
    late StateSetter update;

    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(disableAnimations: true),
          child: child!,
        ),
        home: StatefulBuilder(
          builder: (context, setState) {
            update = setState;
            return Scaffold(
              body: Column(
                children: [
                  BulkaMotionSwitcher(
                    key: const ValueKey('motion-switcher'),
                    child: SizedBox(
                      key: ValueKey(second ? 'second' : 'first'),
                      width: 40,
                      height: 40,
                    ),
                  ),
                  const BulkaPressScale(
                    key: ValueKey('press-scale'),
                    child: SizedBox(width: 40, height: 40),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );

    final switcher = find.descendant(
      of: find.byKey(const ValueKey('motion-switcher')),
      matching: find.byType(AnimatedSwitcher),
    );
    final pressScale = find.descendant(
      of: find.byKey(const ValueKey('press-scale')),
      matching: find.byType(AnimatedScale),
    );
    expect(tester.widget<AnimatedSwitcher>(switcher).duration, Duration.zero);
    expect(tester.widget<AnimatedScale>(pressScale).duration, Duration.zero);

    update(() => second = true);
    await tester.pump();
    expect(find.byKey(const ValueKey('first')), findsNothing);
    expect(find.byKey(const ValueKey('second')), findsOneWidget);
  });

  testWidgets('reduced motion pauses automatic story progress', (tester) async {
    const stories = [
      PromoStory(
        id: 1,
        title: 'FIRST',
        imageUrl: '',
        contentUrl: '',
        groupId: 'test',
        groupTitle: 'Test',
        groupCoverUrl: '',
        duration: 1,
      ),
      PromoStory(
        id: 2,
        title: 'SECOND',
        imageUrl: '',
        contentUrl: '',
        groupId: 'test',
        groupTitle: 'Test',
        groupCoverUrl: '',
        duration: 1,
      ),
    ];

    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(disableAnimations: true),
          child: child!,
        ),
        home: const StoryViewer(
          stories: stories,
          initialIndex: 0,
          heroTag: 'reduced-motion-story',
        ),
      ),
    );

    await tester.pump(const Duration(seconds: 3));
    expect(find.byType(StoryViewer), findsOneWidget);
    expect(find.text('FIRST'), findsWidgets);
    expect(find.text('SECOND'), findsNothing);
  });

  testWidgets('profile back returns to populated home', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: ChangeNotifierProvider(
          create: (_) => CartProvider(),
          child: MainShell(
            api: _FakeBulkaApiClient(),
            customer: _testCustomer,
            transactions: _testTransactions,
            onLogout: () async {},
            onRefreshProfile: () async {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(Image), findsWidgets);
    expect(
      find.image(const AssetImage('assets/brand/bulka_logo.png')),
      findsOneWidget,
    );
    expect(find.text('Тут много интересного'), findsOneWidget);
    expect(find.text('НОВИНКА'), findsWidgets);
    expect(find.text('Выберите тип заказа'), findsOneWidget);
    expect(find.text('Накопительная'), findsOneWidget);
    expect(find.text('Статус: Бронза (5%)'), findsWidgets);
    expect(find.byType(Hero), findsAtLeastNWidgets(2));

    final promoTapTarget = find.byKey(const ValueKey('promo-card-new'));
    expect(promoTapTarget, findsOneWidget);
    await tester.tap(promoTapTarget);
    await tester.pump();
    expect(
      tester.state<NavigatorState>(find.byType(Navigator)).canPop(),
      isTrue,
    );
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byType(StoryViewer), findsOneWidget);

    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();

    final qrButton = find.byKey(const ValueKey('qr-preview-button'));
    await tester.ensureVisible(qrButton);
    await tester.tap(qrButton);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byType(QrDialog), findsOneWidget);
    final modalBarriers = tester.widgetList<ModalBarrier>(
      find.byType(ModalBarrier),
    );
    expect(
      modalBarriers.any((barrier) => (barrier.color?.a ?? 1) < 0.25),
      isTrue,
    );
    await tester.tap(find.byIcon(Icons.close_rounded));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byTooltip('Свернуть'));
    await tester.tap(find.byTooltip('Свернуть'));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.byTooltip('Развернуть'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('nav-4')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('nav-0')));
    await tester.pumpAndSettle();
    expect(find.byTooltip('Развернуть'), findsOneWidget);

    await tester.ensureVisible(find.byTooltip('Развернуть'));
    await tester.tap(find.byTooltip('Развернуть'));
    await tester.pump(const Duration(milliseconds: 300));
    final historyButton = find.byKey(const ValueKey('balance-history-button'));
    await tester.drag(
      find.byKey(const PageStorageKey('home-scroll')),
      const Offset(0, -520),
    );
    await tester.pump(const Duration(milliseconds: 300));
    await tester.ensureVisible(historyButton);
    await tester.tap(historyButton);
    await tester.pumpAndSettle();
    expect(find.byType(BalanceHistoryScreen), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('nav-4')));
    await tester.pumpAndSettle();
    expect(find.text('Профиль'), findsWidgets);
    expect(find.byType(ProfileScreen).hitTestable(), findsOneWidget);
    expect(
      tester
          .widget<Offstage>(find.byKey(const ValueKey('tab-slot-4')))
          .offstage,
      isFalse,
    );

    await tester.tap(find.byKey(const ValueKey('nav-0')));
    await tester.pumpAndSettle();

    expect(
      tester
          .widget<Offstage>(find.byKey(const ValueKey('tab-slot-0')))
          .offstage,
      isFalse,
    );
    expect(
      tester
          .widget<Offstage>(find.byKey(const ValueKey('tab-slot-4')))
          .offstage,
      isTrue,
    );
    expect(find.byType(ProfileScreen).hitTestable(), findsNothing);
    expect(find.byType(HomeScreen).hitTestable(), findsOneWidget);
    expect(
      find.image(const AssetImage('assets/brand/bulka_logo.png')),
      findsOneWidget,
    );
    expect(find.text('Накопительная'), findsOneWidget);
  });

  testWidgets('tablet uses promo grid and honors reduced motion', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(1024, 1366);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(disableAnimations: true),
          child: child!,
        ),
        home: ChangeNotifierProvider(
          create: (_) => CartProvider(),
          child: MainShell(
            api: _FakeBulkaApiClient(),
            customer: _testCustomer,
            transactions: _testTransactions,
            onLogout: () async {},
            onRefreshProfile: () async {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final grid = tester.widget<GridView>(find.byType(GridView));
    final delegate =
        grid.gridDelegate as SliverGridDelegateWithFixedCrossAxisCount;
    expect(delegate.crossAxisCount, 2);
    expect(BulkaMotion.reduced(tester.element(find.byType(MainShell))), isTrue);

    await tester.tap(find.byKey(const ValueKey('nav-4')));
    await tester.pump();
    expect(
      tester
          .widget<Offstage>(find.byKey(const ValueKey('tab-slot-0')))
          .offstage,
      isTrue,
    );
    expect(
      tester
          .widget<Offstage>(find.byKey(const ValueKey('tab-slot-4')))
          .offstage,
      isFalse,
    );
  });

  testWidgets('delivery address flow saves selected address', (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(430, 932);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: ChangeNotifierProvider(
          create: (_) => CartProvider(),
          child: MainShell(
            api: _FakeBulkaApiClient(),
            customer: _testCustomer,
            transactions: _testTransactions,
            onLogout: () async {},
            onRefreshProfile: () async {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Доставка'));
    await tester.pumpAndSettle();
    expect(find.text('Выберите адрес'), findsOneWidget);
    expect(find.text('Адреса пока не добавлены'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.add_rounded));
    await tester.pumpAndSettle();
    expect(find.text('Локации'), findsOneWidget);

    await tester.tap(find.text('Подтвердить'));
    await tester.pumpAndSettle();
    expect(find.text('Название адреса'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextFormField, 'Введите').first,
      'тест',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Введите').at(1),
      '9',
    );
    tester.testTextInput.hide();
    await tester.pumpAndSettle();
    final detailsList = find.ancestor(
      of: find.text('Продолжить'),
      matching: find.byType(ListView),
    );
    expect(detailsList, findsOneWidget);
    await tester.drag(detailsList, const Offset(0, -700));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Продолжить'));
    await tester.pumpAndSettle();

    expect(find.text('Выберите адрес'), findsOneWidget);
    expect(find.text('тест'), findsOneWidget);
    expect(find.byIcon(Icons.check_rounded), findsWidgets);
  });
}

class _FakeBulkaApiClient extends BulkaApiClient {
  final List<DeliveryAddress> _addresses = [];

  @override
  Future<List<PromoStory>> getStories() async => const [
    PromoStory(
      id: 1,
      title: 'НОВИНКА',
      imageUrl: '',
      contentUrl: '',
      groupId: 'new',
      groupTitle: 'НОВИНКА',
      groupCoverUrl: '',
    ),
  ];

  @override
  Future<List<NewsItem>> getNews() async => const [];

  @override
  Future<String> getQrToken(String phone) async => 'test-live-token';

  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => const [
    BakeryLocation(
      id: 'aktau-1',
      name: 'Bulka',
      address: 'Актау',
      city: 'Актау',
      latitude: 43.6532,
      longitude: 51.1975,
      deliveryEnabled: true,
    ),
  ];

  @override
  Future<List<DeliveryAddress>> getCustomerAddresses() async =>
      List.unmodifiable(_addresses);

  @override
  Future<Map<String, dynamic>> reverseDeliveryAddress({
    required double latitude,
    required double longitude,
  }) async => {
    'displayName': 'Актау, 9 микрорайон',
    'address': '9 микрорайон',
    'city': 'Актау',
    'latitude': latitude,
    'longitude': longitude,
  };

  @override
  Future<DeliveryAddress> createCustomerAddress(DeliveryAddress address) async {
    _addresses.insert(0, address);
    return address;
  }

  @override
  Future<void> setDefaultCustomerAddress(String id) async {}

  @override
  Future<void> deleteCustomerAddress(String id) async {
    _addresses.removeWhere((address) => address.id == id);
  }
}

final _testTransactions = [
  BonusTransaction(
    id: 'tx1',
    customerId: '1',
    type: 'deposit',
    amount: 50,
    orderTotal: 1000,
    timestamp: DateTime.now()
        .subtract(const Duration(days: 2))
        .toIso8601String(),
  ),
  BonusTransaction(
    id: 'tx2',
    customerId: '1',
    type: 'deposit',
    amount: 75,
    orderTotal: 1500,
    timestamp: DateTime.now()
        .subtract(const Duration(days: 8))
        .toIso8601String(),
  ),
];

const _testCustomer = Customer(
  id: '1',
  name: 'Алия',
  phone: '77000000000',
  balance: 1200,
  totalSpent: 24000,
  createdAt: '2026-01-01T00:00:00Z',
  isVip: false,
  cashbackPercent: 5,
  vipThreshold: 300000,
  tier: Tier(name: 'Бронза', percent: 5, remaining: 10000, progress: 0.2),
);

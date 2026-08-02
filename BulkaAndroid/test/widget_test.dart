import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:bulka_bonus/core/cart_provider.dart';

void main() {
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
  });

  test('all translations contain ru, kk and en values', () {
    expect(translationValidationErrors(), isEmpty);
    expect('order_preorder'.tr, 'Предзаказ');
    expect('cart_empty_title'.tr, 'Корзина пуста');
    expect(
      'cart_empty_sub'.tr,
      'Добавьте товары из каталога, чтобы оформить заказ.',
    );
  });

  test('fulfillment slots use branch time instead of the device timezone', () {
    final slot = FulfillmentSlot.fromJson(
      {
        'startsAt': '2026-07-27T16:00:00.000Z',
        'endsAt': '2026-07-27T17:00:00.000Z',
        'capacity': 20,
        'remaining': 19,
      },
      timezoneOffsetMinutes: 300,
      serverTime: DateTime.parse('2026-07-27T15:22:00.000Z'),
    );

    expect(slot.startsAt.isUtc, isTrue);
    expect(slot.branchStartsAt.hour, 21);
    expect(slot.branchEndsAt.hour, 22);
    expect(slot.branchServerTime.hour, 20);
  });

  test('Forte checkout sends the selected language to its WebView', () {
    expect(forteCheckoutAcceptLanguage('ru'), startsWith('ru-RU'));
    expect(forteCheckoutAcceptLanguage('kk'), startsWith('kk-KZ'));
    expect(forteCheckoutAcceptLanguage('en'), startsWith('en-US'));
    expect(forteCheckoutAcceptLanguage('unknown'), startsWith('ru-RU'));
  });

  test('Forte checkout accepts only the legacy bank page or Bulka widget', () {
    expect(
      isAllowedForteCheckoutUri(
        Uri.parse(
          'https://ecom.fortebank.com/flex/?id=1000001918261&password=test123',
        ),
      ),
      isTrue,
    );
    expect(
      isAllowedForteCheckoutUri(
        Uri.parse(
          'https://bulka.com.kz/payments/forte-widget#token=abc1234567890123&order=117615f9-b35f-4eb4-9f6d-777f2236bb25',
        ),
      ),
      isTrue,
    );
    expect(
      isAllowedForteCheckoutUri(
        Uri.parse(
          'https://bulka.com.kz.attacker.example/payments/forte-widget#token=abc1234567890123',
        ),
      ),
      isFalse,
    );
    expect(
      isAllowedForteCheckoutUri(
        Uri.parse(
          'https://bulka.com.kz/payments/forte-widget?token=logged-secret',
        ),
      ),
      isFalse,
    );
  });

  test('Forte WebView recognizes both order and card-setup returns', () {
    expect(
      forteCheckoutReturnFromUri(
        Uri.parse(
          'https://bulka.com.kz/orders?payment=forte&order=117615f9-b35f-4eb4-9f6d-777f2236bb25&status=successful',
        ),
      ),
      ForteCheckoutReturn.completed,
    );
    expect(
      forteCheckoutReturnFromUri(
        Uri.parse(
          'https://bulka.com.kz/profile?payment=forte&setup=117615f9-b35f-4eb4-9f6d-777f2236bb25&status=cancelled',
        ),
      ),
      ForteCheckoutReturn.cancelled,
    );
  });

  test('product storage conditions parse and localize duration units', () {
    final conditions = productStorageConditionsFromJson([
      {'temperature': '-18 °C', 'durationValue': 90, 'durationUnit': 'days'},
      {'temperature': '4±2 °C', 'durationValue': 72, 'durationUnit': 'hours'},
    ]);
    expect(conditions, hasLength(2));

    appLanguageNotifier.value = 'ru';
    expect(productStorageDurationLabel(conditions[0]), '90 дней');
    expect(productStorageDurationLabel(conditions[1]), '72 часа');
    appLanguageNotifier.value = 'kk';
    expect(productStorageDurationLabel(conditions[0]), '90 күн');
    expect(productStorageDurationLabel(conditions[1]), '72 сағат');
    appLanguageNotifier.value = 'en';
    expect(productStorageDurationLabel(conditions[0]), '90 days');
    expect(productStorageDurationLabel(conditions[1]), '72 hours');
  });

  test('every localization key used by the client exists', () {
    final missing = <String>{};
    final keyPattern = RegExp(r"'([a-z][a-z0-9_]*)'\.tr(?:Args)?");
    for (final entity in Directory('lib').listSync(recursive: true)) {
      if (entity is! File || !entity.path.endsWith('.dart')) continue;
      final source = entity.readAsStringSync();
      for (final match in keyPattern.allMatches(source)) {
        final key = match.group(1)!;
        if (!hasAppTranslationKey(key)) missing.add(key);
      }
    }
    expect(missing, isEmpty);
  });

  test(
    'web loader stays visible until Flutter renders or retry is offered',
    () {
      final source = File('web/index.html').readAsStringSync();
      expect(source, contains('flutter-first-frame'));
      expect(source, contains('app-loading-error'));
      expect(source, contains('app-loading-retry'));
      expect(source, isNot(contains('setTimeout(hideLoading')));
    },
  );

  test('client UI has no hardcoded Cyrillic labels', () {
    final violations = <String>[];
    final uiRoots = ['lib/screens', 'lib/widgets', 'lib/app', 'lib/shell'];
    final cyrillic = r'А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі';
    final patterns = [
      RegExp(
        "(?:Text|_BulkaPageTitle)\\(\\s*(?:const\\s+)?['\"][^'\"]*[$cyrillic]",
        multiLine: true,
      ),
      RegExp(
        "(?:hintText|helperText|labelText|tooltip|semanticLabel|description|title)\\s*:\\s*['\"][^'\"]*[$cyrillic]",
        multiLine: true,
      ),
    ];
    for (final root in uiRoots) {
      for (final entity in Directory(root).listSync(recursive: true)) {
        if (entity is! File || !entity.path.endsWith('.dart')) continue;
        final source = entity.readAsStringSync();
        for (final pattern in patterns) {
          if (pattern.hasMatch(source)) violations.add(entity.path);
        }
      }
    }
    expect(violations.toSet(), isEmpty);
  });

  test('all product mark transparent PNG assets are bundled', () {
    for (final name in [
      'gluten',
      'milk',
      'egg',
      'nuts',
      'peanut',
      'sesame',
      'soy',
      'halal',
      'eac',
      'iso',
      'traces-nuts-sesame',
      'under-3',
      'vegetarian',
      'vegan',
      'sugar-free',
      'lactose-free',
    ]) {
      expect(File('assets/product_marks/$name.png').existsSync(), isTrue);
    }
  });

  test('only Golos Text and Montserrat typography assets are bundled', () {
    const familyWeights = {
      'GolosText': [
        'Regular',
        'Medium',
        'SemiBold',
        'Bold',
        'ExtraBold',
        'Black',
      ],
      'Montserrat': [
        'Light',
        'Regular',
        'Medium',
        'SemiBold',
        'Bold',
        'ExtraBold',
        'Black',
      ],
    };
    for (final MapEntry(key: family, value: weights) in familyWeights.entries) {
      for (final weight in weights) {
        expect(File('assets/fonts/$family-$weight.ttf').existsSync(), isTrue);
      }
      expect(File('assets/fonts/$family-OFL.txt').existsSync(), isTrue);
    }

    final pubspec = File('pubspec.yaml').readAsStringSync();
    final declaredFamilies = RegExp(
      r'^\s*-\s+family:\s*([^\s]+)',
      multiLine: true,
    ).allMatches(pubspec).map((match) => match.group(1)).toSet();
    expect(declaredFamilies, {'GolosText', 'Montserrat'});
  });

  test('customer UI uses only the two semantic font roles', () {
    final violations = <String>[];
    final familyPattern = RegExp(r'fontFamily\s*:\s*([^,\r\n)]+)');
    for (final entity in Directory('lib').listSync(recursive: true)) {
      if (entity is! File || !entity.path.endsWith('.dart')) continue;
      final source = entity.readAsStringSync();
      for (final match in familyPattern.allMatches(source)) {
        final role = match.group(1)!.trim();
        if (role != '_headingFont' && role != '_descriptionFont') {
          violations.add('${entity.path}: $role');
        }
      }
    }
    expect(violations, isEmpty);

    final theme = buildBulkaTheme();
    expect(theme.textTheme.headlineMedium?.fontFamily, 'GolosText');
    expect(theme.textTheme.bodyMedium?.fontFamily, 'Montserrat');
    for (final style in [
      theme.filledButtonTheme.style,
      theme.elevatedButtonTheme.style,
      theme.outlinedButtonTheme.style,
      theme.textButtonTheme.style,
    ]) {
      expect(style?.textStyle?.resolve({})?.fontFamily, 'GolosText');
    }
  });

  test('the global app and text field surfaces are white', () {
    final theme = buildBulkaTheme();
    expect(theme.scaffoldBackgroundColor, Colors.white);
    expect(theme.colorScheme.surface, Colors.white);
    expect(theme.inputDecorationTheme.fillColor, Colors.white);
  });

  test('helper and success colors remain readable on white surfaces', () {
    final theme = buildBulkaTheme();
    final colors = theme.extension<BulkaThemeColors>()!;

    expect(theme.inputDecorationTheme.helperStyle?.color, colors.mutedText);
    expect(colors.mutedText, const Color(0xFF7A6C65));
    expect(colors.success, const Color(0xFF2B7A4B));
  });

  test('wallet URL follows the device platform in web and native builds', () {
    final urls = {
      'url': '/wallet/choice',
      'appleUrl': '/api/wallet/download/apple',
      'googleUrl': '/api/wallet/google/download/google',
    };

    expect(
      preferredWalletPath(urls, TargetPlatform.iOS),
      '/api/wallet/download/apple',
    );
    expect(
      preferredWalletPath(urls, TargetPlatform.android),
      '/api/wallet/google/download/google',
    );
    expect(preferredWalletPath(urls, TargetPlatform.windows), '/wallet/choice');
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

  test(
    'delivery location resolves tariff rings and rejects outside points',
    () {
      const location = BakeryLocation(
        id: 'aktau-1',
        name: 'Bulka',
        address: 'Актау',
        city: 'Актау',
        deliveryEnabled: true,
        deliveryZones: [
          DeliveryZone(
            id: 'far',
            radiusKm: 10,
            fee: 1000,
            minOrder: 3000,
            color: '#EC407A',
          ),
          DeliveryZone(
            id: 'near',
            radiusKm: 2.5,
            fee: 400,
            minOrder: 3000,
            color: '#66BB6A',
          ),
        ],
      );

      expect(location.deliveryOuterRadiusKm, 10);
      expect(location.deliveryZoneForDistance(2)?.id, 'near');
      expect(location.deliveryZoneForDistance(7)?.id, 'far');
      expect(location.deliveryZoneForDistance(10.01), isNull);
    },
  );

  test('coordinate distance uses real haversine kilometers', () {
    final distance = distanceBetweenCoordinatesKm(
      firstLatitude: 43.6532,
      firstLongitude: 51.1975,
      secondLatitude: 43.6632,
      secondLongitude: 51.1975,
    );

    expect(distance, closeTo(1.112, 0.01));
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
    final api = _FakeBulkaApiClient()
      ..setSession(accessToken: 'test-access', refreshToken: 'test-refresh');

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
            api: api,
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
    expect(find.text('Самовывоз'), findsOneWidget);
    expect(
      find.text('Ассортимент выбран для этого типа заказа'),
      findsOneWidget,
    );

    final savedCard = find.byKey(
      const ValueKey('checkout-saved-card-test-card'),
    );
    await tester.scrollUntilVisible(
      savedCard,
      420,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.pumpAndSettle();

    final kaspiCard = find.byKey(const ValueKey('checkout-payment-kaspi'));
    expect(kaspiCard, findsOneWidget);
    expect(savedCard, findsOneWidget);
    expect(find.text('VISA •••• 1328'), findsOneWidget);
    expect(
      tester.getTopLeft(savedCard).dy,
      greaterThan(tester.getBottomLeft(kaspiCard).dy),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('rapid time taps request slots and open the picker only once', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({
      'selected_order_type': 'pickup',
      'selected_bakery_location': 'Bulka, Астана',
      'selected_bakery_location_id': 'astana-1',
    });
    final cart = CartProvider()
      ..addItem(
        productId: 'time-product',
        name: 'Товар для проверки времени',
        price: 1500,
        imageUrl: '',
      );
    final api = _DelayedSlotsApiClient()
      ..setSession(accessToken: 'test-access', refreshToken: 'test-refresh');

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: ChangeNotifierProvider.value(
          value: cart,
          child: MainShell(
            api: api,
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
    await tester.tap(find.text('Оформить заказ'));
    await tester.pumpAndSettle();

    final selectTime = find.text('Выберите время');
    await tester.scrollUntilVisible(
      selectTime,
      420,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.tap(selectTime);
    await tester.tap(selectTime);
    await tester.pump();

    expect(api.slotRequests, 1);
    expect(
      find.byKey(const ValueKey('checkout-field-loading')),
      findsOneWidget,
    );

    api.releaseSlots();
    await tester.pump(const Duration(milliseconds: 500));
    expect(api.slotRequests, 1);
    expect(find.byType(BottomSheet), findsOneWidget);
    Navigator.of(tester.element(find.byType(BottomSheet))).pop();
    await tester.pumpAndSettle();
  });

  testWidgets('clear cart confirmation is compact and action-first', (
    tester,
  ) async {
    final cart = CartProvider()
      ..addItem(
        productId: 'clear-product',
        name: 'Плюшка Московская',
        price: 500,
        imageUrl: '',
      );
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
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
    await tester.tap(find.byIcon(Icons.delete_outline_rounded).first);
    await tester.pumpAndSettle();

    expect(find.text('Очистить корзину?'), findsOneWidget);
    expect(find.text('Все добавленные товары будут удалены.'), findsNothing);
    expect(find.text('Очистить'), findsWidgets);
    expect(find.text('Подтвердить'), findsNothing);
    expect(find.text('Отмена'), findsOneWidget);
  });

  testWidgets(
    'checkout keeps the catalog order type when delivery is unavailable',
    (tester) async {
      SharedPreferences.setMockInitialValues({
        'selected_order_type': 'delivery',
      });
      final cart = CartProvider()
        ..addItem(
          productId: 'delivery-product',
          name: 'Товар для доставки',
          price: 1500,
          imageUrl: '',
        );
      final api = _NoDeliveryLocationsApiClient()
        ..setSession(accessToken: 'test-access', refreshToken: 'test-refresh');

      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: ChangeNotifierProvider.value(
            value: cart,
            child: MainShell(
              api: api,
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
      await tester.tap(find.text('Оформить заказ'));
      await tester.pumpAndSettle();

      expect(find.text('Доставка'), findsOneWidget);
      expect(
        find.text('Ассортимент выбран для этого типа заказа'),
        findsOneWidget,
      );
      expect(find.textContaining('Доставка пока недоступна'), findsOneWidget);
    },
  );

  testWidgets('preorder checkout offers delivery and pickup', (tester) async {
    SharedPreferences.setMockInitialValues({
      'selected_order_type': 'preorder',
      'selected_bakery_location': 'Bulka, Астана',
      'selected_bakery_location_id': 'astana-1',
    });
    final cart = CartProvider()
      ..addItem(
        productId: 'preorder-product',
        name: 'Товар для предзаказа',
        price: 2500,
        imageUrl: '',
      );
    final api = _FakeBulkaApiClient()
      ..setSession(accessToken: 'test-access', refreshToken: 'test-refresh');

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: ChangeNotifierProvider.value(
          value: cart,
          child: MainShell(
            api: api,
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
    await tester.tap(find.text('Оформить заказ'));
    await tester.pumpAndSettle();

    expect(find.text('Предзаказ'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('preorder-fulfillment-delivery')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('preorder-fulfillment-pickup')),
      findsOneWidget,
    );

    var redRequiredStar = false;
    for (final richText in tester.widgetList<RichText>(find.byType(RichText))) {
      richText.text.visitChildren((span) {
        if (span.toPlainText().trim() == '*' &&
            span.style?.color == const Color(0xFFD14343)) {
          redRequiredStar = true;
        }
        return true;
      });
    }
    expect(redRequiredStar, isTrue);

    await tester.tap(
      find.byKey(const ValueKey('preorder-fulfillment-delivery')),
    );
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Адрес доставки', findRichText: true),
      findsWidgets,
    );
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
    expect(find.byType(BulkaNavIcon), findsNWidgets(5));
    expect(find.byIcon(Icons.bakery_dining_outlined), findsOneWidget);

    for (final tab in [1, 3, 4]) {
      await tester.tap(find.byKey(ValueKey('nav-$tab')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'tab $tab overflowed');
      if (tab == 1) {
        expect(find.byIcon(Icons.bakery_dining), findsOneWidget);
      }
    }
  });

  testWidgets('shows login screen', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: LoginScreen(
          onLogin: (_, _) async => null,
          onStartRegistration: (_, _, _) async => const OtpRequestResult(),
          onVerifyRegistration: (_, _) async => null,
          onStartPasswordReset: (_, _) async => const OtpRequestResult(),
          onResetPassword: (_, _, _) async => null,
        ),
      ),
    );

    expect(
      find.image(const AssetImage('assets/brand/bulka_logo.png')),
      findsOneWidget,
    );
    expect(find.text('Войти'), findsOneWidget);
    expect(find.text('Создать аккаунт'), findsOneWidget);
  });

  testWidgets(
    'password login sends phone and password without requesting OTP',
    (tester) async {
      String? submittedPhone;
      String? submittedPassword;
      var otpRequests = 0;
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: LoginScreen(
            onLogin: (phone, password) async {
              submittedPhone = phone;
              submittedPassword = password;
              return null;
            },
            onStartRegistration: (_, _, _) async {
              otpRequests++;
              return const OtpRequestResult();
            },
            onVerifyRegistration: (_, _) async => null,
            onStartPasswordReset: (_, _) async {
              otpRequests++;
              return const OtpRequestResult();
            },
            onResetPassword: (_, _, _) async => null,
          ),
        ),
      );

      await tester.enterText(
        find.byKey(const ValueKey('auth-phone-field')),
        '7001234567',
      );
      await tester.enterText(
        find.byKey(const ValueKey('auth-password-field')),
        'Secure2026',
      );
      await tester.ensureVisible(find.text('Войти'));
      await tester.tap(find.text('Войти'));
      await tester.pump();

      expect(submittedPhone, '+77001234567');
      expect(submittedPassword, 'Secure2026');
      expect(otpRequests, 0);
    },
  );

  testWidgets(
    'registration confirms WhatsApp before opening the profile form',
    (tester) async {
      String? startedPhone;
      String? startedPassword;
      String? verifiedCode;
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: LoginScreen(
            onLogin: (_, _) async => null,
            onStartRegistration: (phone, password, token) async {
              startedPhone = phone;
              startedPassword = password;
              expect(token, hasLength(16));
              return const OtpRequestResult();
            },
            onVerifyRegistration: (_, code) async {
              verifiedCode = code;
              return null;
            },
            onStartPasswordReset: (_, _) async => const OtpRequestResult(),
            onResetPassword: (_, _, _) async => null,
            onRegister:
                ({
                  required phone,
                  required name,
                  surname,
                  gender,
                  birthdate,
                  email,
                }) async => null,
          ),
        ),
      );

      await tester.ensureVisible(
        find.byKey(const ValueKey('create-account-button')),
      );
      await tester.tap(find.byKey(const ValueKey('create-account-button')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('auth-phone-field')),
        '7012345678',
      );
      await tester.enterText(
        find.byKey(const ValueKey('auth-password-field')),
        'Register2026',
      );
      await tester.enterText(
        find.byKey(const ValueKey('auth-confirm-password-field')),
        'Register2026',
      );
      expect(
        find.text('Принимаю публичную оферту и политику конфиденциальности'),
        findsOneWidget,
      );
      expect(find.text('Публичная оферта'), findsOneWidget);
      expect(find.text('Политика конфиденциальности'), findsOneWidget);
      await tester.ensureVisible(find.text('Подтвердить номер'));
      await tester.tap(find.text('Подтвердить номер'));
      await tester.pump();

      expect(startedPhone, isNull);
      expect(
        find.text('Примите публичную оферту и политику конфиденциальности'),
        findsOneWidget,
      );

      await tester.ensureVisible(
        find.byKey(const ValueKey('registration-terms-checkbox')),
      );
      await tester.tap(
        find.byKey(const ValueKey('registration-terms-checkbox')),
      );
      await tester.ensureVisible(find.text('Подтвердить номер'));
      await tester.tap(find.text('Подтвердить номер'));
      await tester.pumpAndSettle();

      expect(startedPhone, '+77012345678');
      expect(startedPassword, 'Register2026');
      expect(find.text('Введите код из WhatsApp'), findsOneWidget);

      await tester.enterText(
        find.byKey(const ValueKey('auth-otp-field')),
        '1234',
      );
      await tester.pumpAndSettle();
      expect(verifiedCode, '1234');
      expect(find.text('Завершение регистрации'), findsOneWidget);
    },
  );

  testWidgets('guest can check delivery before authentication', (tester) async {
    var authRequests = 0;
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: HomeScreen(
          api: _FakeBulkaApiClient(),
          customer: null,
          transactions: const [],
          onHistoryTap: () {},
          onProfileTap: () {},
          onRequireAuth: () async {
            authRequests++;
            return false;
          },
          onOpenCatalog: (_) async {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('order-card-delivery')));
    await tester.pumpAndSettle();

    expect(authRequests, 0);
    expect(find.text('Выберите адрес'), findsOneWidget);
    expect(find.text('Мои адреса'), findsOneWidget);
    expect(find.text('Добавить адрес'), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });

  testWidgets('selected city is preserved when order type changes', (
    tester,
  ) async {
    final api = _MultiCityLocationsApiClient();
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: LocationsScreen(orderType: 'pickup', api: api),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Все локации'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Актау'));
    await tester.pumpAndSettle();

    expect(find.text('ЖК Дукат'), findsOneWidget);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('selected_bakery_city'), 'Актау');

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: LocationsScreen(orderType: 'preorder', api: api),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('ЖК Дукат'), findsOneWidget);
    expect(find.text('Bulka Астана'), findsNothing);
  });

  testWidgets(
    'legacy account recovery verifies WhatsApp and sets a new password',
    (tester) async {
      String? resetPhone;
      String? resetCode;
      String? resetPassword;
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: LoginScreen(
            onLogin: (_, _) async => null,
            onStartRegistration: (_, _, _) async => const OtpRequestResult(),
            onVerifyRegistration: (_, _) async => null,
            onStartPasswordReset: (_, _) async => const OtpRequestResult(),
            onResetPassword: (phone, code, password) async {
              resetPhone = phone;
              resetCode = code;
              resetPassword = password;
              return null;
            },
          ),
        ),
      );

      await tester.enterText(
        find.byKey(const ValueKey('auth-phone-field')),
        '7077654321',
      );
      await tester.ensureVisible(
        find.byKey(const ValueKey('forgot-password-button')),
      );
      await tester.tap(find.byKey(const ValueKey('forgot-password-button')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Получить код'));
      await tester.tap(find.text('Получить код'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('auth-otp-field')),
        '4321',
      );
      await tester.enterText(
        find.byKey(const ValueKey('auth-password-field')),
        'Renewed2026',
      );
      await tester.enterText(
        find.byKey(const ValueKey('auth-confirm-password-field')),
        'Renewed2026',
      );
      await tester.ensureVisible(find.text('Сохранить новый пароль'));
      await tester.tap(find.text('Сохранить новый пароль'));
      await tester.pump();

      expect(resetPhone, '+77077654321');
      expect(resetCode, '4321');
      expect(resetPassword, 'Renewed2026');
    },
  );

  testWidgets('keeps the branded splash during minimum boot time', (
    tester,
  ) async {
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => CartProvider(),
        child: const BulkaBonusApp(),
      ),
    );
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
    expect(find.byType(MainShell), findsOneWidget);
    expect(find.byType(LoginScreen), findsNothing);
  });

  testWidgets('guest keeps catalog and cart open until checkout', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    var authRequests = 0;
    final cart = CartProvider()
      ..addItem(
        productId: 'guest-product',
        name: 'Круассан',
        price: 1200,
        imageUrl: '',
      );

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: ChangeNotifierProvider.value(
          value: cart,
          child: MainShell(
            api: _FakeBulkaApiClient(),
            customer: null,
            transactions: const [],
            initialTab: 2,
            onLogout: () async {},
            onRefreshProfile: () async {},
            onRequireAuth: () async {
              authRequests++;
              return false;
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Круассан'), findsOneWidget);
    expect(find.bySemanticsLabel('Корзина'), findsWidgets);
    await tester.tap(find.text('Оформить заказ'));
    await tester.pumpAndSettle();

    expect(authRequests, 1);
    expect(find.text('Оформление заказа'), findsNothing);
    expect(cart.itemCount, 1);
    semantics.dispose();
  });

  testWidgets('guest profile stays light with dark system preference', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    tester.binding.platformDispatcher.platformBrightnessTestValue =
        Brightness.dark;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(
      tester.binding.platformDispatcher.clearPlatformBrightnessTestValue,
    );

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        themeMode: ThemeMode.light,
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
            customer: null,
            transactions: const [],
            initialTab: 4,
            onLogout: () async {},
            onRefreshProfile: () async {},
            onRequireAuth: () async => false,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final context = tester.element(find.byType(MainShell));
    expect(Theme.of(context).brightness, Brightness.light);
    final profileTitle = tester.widget<Text>(
      find.byKey(const ValueKey('guest-profile-title')),
    );
    expect(profileTitle.style?.fontSize, BulkaTypeScale.pageTitle);
    expect(profileTitle.style?.fontWeight, FontWeight.w400);
    expect(find.text('Войдите в Bulka'), findsOneWidget);
    expect(find.text('Оформление'), findsNothing);
    expect(find.bySemanticsLabel('Войти по номеру телефона'), findsWidgets);
    expect(tester.takeException(), isNull);
    semantics.dispose();
  });

  testWidgets('ready pickup order announces and submits customer arrival', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    final api = _ArrivalApiClient();

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: ChangeNotifierProvider(
          create: (_) => CartProvider(),
          child: CustomerOrdersScreen(api: api),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is Semantics && widget.properties.label == 'Я приехал',
      ),
      findsOneWidget,
    );
    await tester.tap(find.text('Я приехал'));
    await tester.pumpAndSettle();
    expect(find.text('Вы уже у пекарни?'), findsOneWidget);
    await tester.tap(find.text('Сообщить'));
    await tester.pumpAndSettle();

    expect(api.arrivalCalls, 1);
    expect(find.text('Сотрудники уже знают, что вы приехали'), findsWidgets);
    semantics.dispose();
  });

  testWidgets('ETA range remains readable and announced at 200 percent text', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final now = DateTime.now();
    final order = CustomerOrder(
      id: 'eta-order',
      number: 1010,
      paymentStatus: 'paid',
      orderStatus: 'preparing',
      amount: 4200,
      subtotal: 4200,
      discount: 0,
      branch: 'Bulka, Актау',
      items: const [
        {'id': 'pie', 'name': 'Пирог', 'quantity': 1, 'price': 4200},
      ],
      earnedBonus: 210,
      createdAt: now.subtract(const Duration(minutes: 5)),
      fulfillmentType: 'delivery',
      deliveryStatus: 'assigned',
      etaMinAt: now.add(const Duration(minutes: 25)),
      etaMaxAt: now.add(const Duration(minutes: 35)),
      etaConfidence: 'high',
    );

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: const TextScaler.linear(2),
            disableAnimations: true,
          ),
          child: child!,
        ),
        home: OrderDetailsScreen(
          api: _FakeBulkaApiClient(),
          initialOrder: order,
          onRepeat: (_) async {},
          onReview: (_) async {},
          onOrderChanged: (_) {},
        ),
      ),
    );
    await tester.pump();

    expect(find.textContaining('Примерно'), findsOneWidget);
    expect(
      find.bySemanticsLabel(RegExp('Высокая точность прогноза')),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
    semantics.dispose();
  });

  testWidgets('product facts remain usable at 200 percent text', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final liveProducts = ValueNotifier<Map<String, CatalogProduct>>(const {});
    addTearDown(liveProducts.dispose);
    const product = CatalogProduct(
      id: 'facts-product',
      title: 'Вишнёво-яблочный семейный пирог',
      price: 4500,
      category: 'Пироги',
      imageUrl: '',
      inStockCount: 5,
      preparationMinutes: 25,
      description: 'Песочное тесто и фруктовая начинка',
      ingredients: 'Пшеничная мука, сливочное масло, яблоко, вишня',
      allergens: ['Глютен', 'Молоко'],
      dietaryTags: ['Без яиц', 'Вегетарианское'],
      weightGrams: 850,
      caloriesKcal: 1000.3,
      proteinGrams: 4.2,
      fatGrams: 10.5,
      carbsGrams: 36.8,
      storageConditions: [
        ProductStorageCondition(
          temperature: '-18 °C',
          durationValue: 90,
          durationUnit: 'days',
        ),
        ProductStorageCondition(
          temperature: '4±2 °C',
          durationValue: 72,
          durationUnit: 'hours',
        ),
      ],
    );

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: const TextScaler.linear(2),
            disableAnimations: true,
          ),
          child: child!,
        ),
        home: ChangeNotifierProvider(
          create: (_) => CartProvider(),
          child: ProductDetailsScreen(
            api: _FakeBulkaApiClient(),
            product: product,
            liveProducts: liveProducts,
            initialQuantity: 0,
            onQuantityChanged: (_, _) {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.favorite_border_rounded), findsOneWidget);
    expect(find.textContaining('Готовим'), findsNothing);
    expect(find.text('Выбрать дату готовности'), findsNothing);
    final ingredientsButton = find.byKey(
      const ValueKey('product-show-ingredients'),
    );
    await tester.scrollUntilVisible(
      ingredientsButton,
      500,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(ingredientsButton);
    await tester.pumpAndSettle();
    expect(find.text('Состав'), findsOneWidget);
    expect(
      find.text('Пшеничная мука, сливочное масло, яблоко, вишня'),
      findsOneWidget,
    );
    expect(find.text('Глютен'), findsOneWidget);
    expect(find.text('Молоко'), findsOneWidget);
    expect(find.text('Срок и условия хранения'), findsOneWidget);
    expect(find.text('-18 °C'), findsOneWidget);
    expect(find.text('90 дней'), findsOneWidget);
    expect(find.text('4±2 °C'), findsOneWidget);
    expect(find.text('72 часа'), findsOneWidget);
    expect(find.text('1000.3 ккал'), findsOneWidget);
    expect(tester.takeException(), isNull);
    semantics.dispose();
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
      matching: find.byType(Transform),
    );
    expect(tester.widget<AnimatedSwitcher>(switcher).duration, Duration.zero);
    expect(
      tester.widget<Transform>(pressScale).transform.storage[0],
      closeTo(1, 0.0001),
    );

    final gesture = await tester.startGesture(tester.getCenter(pressScale));
    await tester.pump(const Duration(milliseconds: 120));
    expect(
      tester.widget<Transform>(pressScale).transform.storage[0],
      closeTo(1, 0.0001),
    );
    await gesture.up();

    update(() => second = true);
    await tester.pump();
    expect(find.byKey(const ValueKey('first')), findsNothing);
    expect(find.byKey(const ValueKey('second')), findsOneWidget);
  });

  testWidgets('press feedback is immediate, interruptible, and spring-based', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: Center(
            child: BulkaPressScale(
              key: ValueKey('spring-press'),
              pressedScale: 0.94,
              child: SizedBox(width: 120, height: 56),
            ),
          ),
        ),
      ),
    );

    final target = find.byKey(const ValueKey('spring-press'));
    final transform = find.descendant(
      of: target,
      matching: find.byType(Transform),
    );
    final gesture = await tester.startGesture(tester.getCenter(target));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 60));
    final pressedScale = tester
        .widget<Transform>(transform)
        .transform
        .storage[0];
    expect(pressedScale, lessThan(0.99));
    expect(pressedScale, greaterThanOrEqualTo(0.94));

    await gesture.moveTo(const Offset(1, 1));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 160));
    final cancelledScale = tester
        .widget<Transform>(transform)
        .transform
        .storage[0];
    expect(cancelledScale, greaterThan(pressedScale));

    await gesture.up();
    await tester.pumpAndSettle();
    expect(
      tester.widget<Transform>(transform).transform.storage[0],
      closeTo(1, 0.001),
    );
  });

  test('Bulka theme uses quiet iOS-style button feedback', () {
    final theme = buildBulkaTheme();
    expect(theme.splashFactory, NoSplash.splashFactory);

    final filledStyle = theme.filledButtonTheme.style!;
    expect(
      filledStyle.minimumSize!.resolve({}),
      const Size(0, BulkaTouch.primaryButton),
    );
    expect(filledStyle.overlayColor!.resolve({WidgetState.pressed}), isNotNull);
    final filledShape =
        filledStyle.shape!.resolve({})! as RoundedRectangleBorder;
    expect(filledShape.borderRadius, BorderRadius.circular(BulkaRadii.control));

    final iconStyle = theme.iconButtonTheme.style!;
    expect(
      iconStyle.minimumSize!.resolve({}),
      const Size.square(BulkaTouch.minimum),
    );
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

  testWidgets('story navigation is labelled and keyboard accessible', (
    tester,
  ) async {
    const stories = [
      PromoStory(
        id: 1,
        title: 'FIRST',
        imageUrl: '',
        contentUrl: '',
        groupId: 'test',
        groupTitle: 'Test',
        groupCoverUrl: '',
        duration: 5,
      ),
      PromoStory(
        id: 2,
        title: 'SECOND',
        imageUrl: '',
        contentUrl: '',
        groupId: 'test',
        groupTitle: 'Test',
        groupCoverUrl: '',
        duration: 5,
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
          heroTag: 'accessible-story',
        ),
      ),
    );
    await tester.pump();

    expect(find.bySemanticsLabel('Предыдущая история'), findsOneWidget);
    expect(find.bySemanticsLabel('Следующая история'), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pump();
    expect(find.text('SECOND'), findsWidgets);
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
    await tester.pump();
    expect(find.text('FIRST'), findsWidgets);
  });

  testWidgets('home uses one compact 16dp mobile grid', (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(390, 844);
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

    final headerRect = tester.getRect(
      find.byKey(const ValueKey('home-header')),
    );
    final promoRect = tester.getRect(
      find.byKey(const ValueKey('promo-card-new')),
    );
    final pickupRect = tester.getRect(
      find.byKey(const ValueKey('order-card-pickup')),
    );
    final preorderRect = tester.getRect(
      find.byKey(const ValueKey('order-card-preorder')),
    );
    final deliveryRect = tester.getRect(
      find.byKey(const ValueKey('order-card-delivery')),
    );
    final deliveryArtworkRect = tester.getRect(
      find.byKey(const ValueKey('order-illustration-delivery')),
    );
    final loyaltyHeadingRect = tester.getRect(find.text('Накопительная'));

    expect(find.text('Тут много интересного'), findsNothing);
    expect(promoRect.top - headerRect.bottom, lessThanOrEqualTo(4));
    expect(promoRect.left, closeTo(16, 0.01));
    expect(promoRect.width, closeTo(358, 0.01));
    expect(promoRect.width / promoRect.height, closeTo(1080 / 480, 0.001));
    expect(pickupRect.left, closeTo(16, 0.01));
    expect(deliveryRect.right, closeTo(374, 0.01));
    expect(deliveryRect.left - pickupRect.right, closeTo(12, 0.01));
    expect(pickupRect.height, closeTo(82, 0.01));
    expect(preorderRect.height, closeTo(82, 0.01));
    expect(deliveryRect.height, closeTo(174, 0.01));
    expect(preorderRect.top - pickupRect.bottom, closeTo(10, 0.01));
    expect(pickupRect.top, closeTo(deliveryRect.top, 0.01));
    expect(preorderRect.bottom, closeTo(deliveryRect.bottom, 0.01));
    expect(loyaltyHeadingRect.left, closeTo(16, 0.01));
    expect(loyaltyHeadingRect.top, greaterThan(deliveryRect.bottom));
    for (final name in const ['pickup', 'preorder', 'delivery']) {
      final ink = tester.widget<Ink>(
        find.byKey(ValueKey('order-card-background-$name')),
      );
      final decoration = ink.decoration! as BoxDecoration;
      final background = decoration.image!;
      expect(
        (background.image as AssetImage).assetName,
        'assets/order/berliner_oreo_cluster.webp',
      );
      expect(background.opacity, closeTo(0.34, 0.001));
    }
    expect(find.byKey(const ValueKey('order-splash-pickup')), findsNothing);
    expect(deliveryArtworkRect.width, closeTo(192, 0.01));
    expect(deliveryArtworkRect.right, closeTo(deliveryRect.right + 46, 0.01));
    expect(deliveryArtworkRect.bottom, closeTo(deliveryRect.bottom + 18, 0.01));
    expect(
      find.descendant(
        of: find.byType(FloatingNavBar),
        matching: find.byType(BackdropFilter),
      ),
      findsOneWidget,
    );

    final preorderClip = tester.widget<Material>(
      find.byKey(const ValueKey('order-card-clip-preorder')),
    );
    expect(preorderClip.borderRadius, BorderRadius.circular(BulkaRadii.card));
    expect(preorderClip.clipBehavior, Clip.antiAlias);
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
    expect(find.text('Тут много интересного'), findsNothing);
    expect(find.text('НОВИНКА'), findsWidgets);
    expect(find.text('Выберите тип заказа'), findsOneWidget);
    expect(find.text('Накопительная'), findsOneWidget);
    expect(find.text('Статус: Бронза (5%)'), findsWidgets);
    expect(find.byType(Hero), findsAtLeastNWidgets(2));
    expect(find.byKey(const ValueKey('add-wallet-button')), findsNothing);
    expect(find.text('Добавить в Apple Wallet'), findsNothing);
    expect(find.text('Добавить в Google Wallet'), findsNothing);

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

    await tester.tap(
      find.descendant(
        of: find.byKey(const ValueKey('story-controls')),
        matching: find.byIcon(Icons.close_rounded),
      ),
    );
    await tester.pumpAndSettle();

    final qrButton = find.byKey(const ValueKey('qr-preview-button'));
    await tester.ensureVisible(qrButton);
    await tester.tap(qrButton);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byType(QrDialog), findsOneWidget);
    expect(
      find.text('Добавить в Apple Wallet').evaluate().length +
          find.text('Добавить в Google Wallet').evaluate().length,
      1,
    );
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
    expect(find.byType(NavigationRail), findsOneWidget);

    await tester.tap(
      find.descendant(
        of: find.byType(NavigationRail),
        matching: find.text('Профиль'),
      ),
    );
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
    expect(find.text('Адрес доставки'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('yandex-map-fallback')));
    await tester.pumpAndSettle();
    expect(find.text('Название адреса'), findsOneWidget);

    await tester.enterText(find.byType(TextFormField).first, 'тест');
    await tester.enterText(find.byType(TextFormField).at(1), '9');
    tester.testTextInput.hide();
    await tester.pumpAndSettle();
    final detailsList = find.byKey(const ValueKey('delivery-address-form'));
    expect(detailsList, findsOneWidget);
    expect(
      find.descendant(
        of: detailsList,
        matching: find.byType(SingleChildScrollView),
      ),
      findsNothing,
    );
    final saveButton = find.text('Сохранить адрес');
    await tester.tap(saveButton);
    await tester.pumpAndSettle();

    expect(find.text('Выберите адрес'), findsOneWidget);
    expect(find.text('тест'), findsOneWidget);
    expect(find.byIcon(Icons.check_rounded), findsWidgets);
  });

  testWidgets('delivery map blocks a selected point outside every zone', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(430, 932);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: AddressMapScreen(api: _OutsideDeliveryApiClient()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Название адреса'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('yandex-map-fallback')));
    await tester.pumpAndSettle();

    expect(find.text('Сюда пока не доставляем'), findsNothing);
    await tester.tap(find.text('Сохранить адрес'));
    await tester.pumpAndSettle();
    expect(find.text('Сюда пока не доставляем'), findsOneWidget);
  });

  testWidgets('delivery map hides the internal branch and tariff', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(430, 932);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: AddressMapScreen(api: _FakeBulkaApiClient()),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('yandex-map-fallback')));
    await tester.pumpAndSettle();

    expect(find.text('Доставка из «Bulka» доступна'), findsNothing);
    expect(find.textContaining('Стоимость'), findsNothing);
    expect(find.textContaining('расстояние'), findsNothing);
    expect(find.text('Название адреса'), findsOneWidget);
    expect(find.text('Дом'), findsWidgets);
    expect(find.text('Подъезд'), findsOneWidget);
    expect(find.text('Этаж'), findsOneWidget);
    expect(find.text('Квартира'), findsOneWidget);
  });

  testWidgets('multiline page titles stay centered on the viewport', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    appLanguageNotifier.value = 'kk';

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: Builder(
          builder: (context) => TextButton(
            key: const ValueKey('open-rewards'),
            onPressed: () => Navigator.of(context).push<void>(
              MaterialPageRoute(
                builder: (_) => RewardsScreen(api: _FakeBulkaApiClient()),
              ),
            ),
            child: const Text('Open'),
          ),
        ),
      ),
    );
    await tester.tap(find.byKey(const ValueKey('open-rewards')));
    await tester.pumpAndSettle();

    final title = find.text('Сыйлықтар мен шақырулар');
    expect(title, findsOneWidget);
    final paragraph = tester.renderObject<RenderParagraph>(title);
    final boxes = paragraph.getBoxesForSelection(
      const TextSelection(baseOffset: 0, extentOffset: 23),
    );
    final titleOrigin = tester.getTopLeft(title);
    final paintedLeft = boxes.map((box) => box.left).reduce(min);
    final paintedRight = boxes.map((box) => box.right).reduce(max);
    final paintedCenter = titleOrigin.dx + (paintedLeft + paintedRight) / 2;
    expect(paintedCenter, closeTo(tester.view.physicalSize.width / 2, 1));
    expect(tester.takeException(), isNull);
  });
}

class _FakeBulkaApiClient extends BulkaApiClient {
  final List<DeliveryAddress> _addresses = [];

  @override
  Future<bool> isFortePaymentAvailable() async => true;

  @override
  Future<List<Map<String, dynamic>>> getFortePaymentMethods() async => const [
    {
      'id': 'test-card',
      'brand': 'visa',
      'lastFour': '1328',
      'expMonth': 12,
      'expYear': 2029,
      'isDefault': true,
    },
  ];

  @override
  Future<Map<String, dynamic>> getReferral() async => const {
    'code': 'BULKA-TEST',
  };

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
  Future<Map<String, dynamic>> getProductOptions(String productId) async =>
      const {};

  @override
  Future<String> getQrToken(String phone) async => 'test-live-token';

  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => const [
    BakeryLocation(
      id: 'astana-1',
      name: 'Bulka',
      address: 'Астана',
      city: 'Астана',
      latitude: 51.1282,
      longitude: 71.4304,
      deliveryEnabled: true,
      deliveryZones: [
        DeliveryZone(
          id: 'test-zone',
          radiusKm: 100,
          fee: 0,
          minOrder: 0,
          color: '#66BB6A',
        ),
      ],
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
    'displayName': 'Астана, проспект Кабанбай батыра',
    'address': 'проспект Кабанбай батыра',
    'city': 'Астана',
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

class _MultiCityLocationsApiClient extends _FakeBulkaApiClient {
  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => const [
    BakeryLocation(
      id: 'astana-1',
      name: 'Bulka Астана',
      address: 'Кабанбай батыра, 46а',
      city: 'Астана',
    ),
    BakeryLocation(
      id: 'aktau-1',
      name: 'ЖК Дукат',
      address: '17-й микрорайон, 1',
      city: 'Актау',
    ),
  ];
}

class _OutsideDeliveryApiClient extends _FakeBulkaApiClient {
  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => const [
    BakeryLocation(
      id: 'far-away',
      name: 'Far Bulka',
      address: 'Вне Астаны',
      city: 'Астана',
      latitude: 50.0,
      longitude: 70.0,
      deliveryEnabled: true,
      deliveryZones: [
        DeliveryZone(
          id: 'small-zone',
          radiusKm: 1,
          fee: 1000,
          minOrder: 3000,
          color: '#EC407A',
        ),
      ],
    ),
  ];
}

class _NoDeliveryLocationsApiClient extends _FakeBulkaApiClient {
  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => const [];
}

class _DelayedSlotsApiClient extends _FakeBulkaApiClient {
  final Completer<void> _slotsReady = Completer<void>();
  int slotRequests = 0;

  void releaseSlots() {
    if (!_slotsReady.isCompleted) _slotsReady.complete();
  }

  @override
  Future<List<FulfillmentSlot>> getFulfillmentSlots({
    required String branchId,
    required String orderType,
    int days = 7,
  }) async {
    slotRequests++;
    await _slotsReady.future;
    final start = DateTime.now().add(const Duration(hours: 2));
    return [
      FulfillmentSlot(
        startsAt: start,
        endsAt: start.add(const Duration(hours: 1)),
        capacity: 10,
        remaining: 9,
      ),
    ];
  }
}

class _ArrivalApiClient extends _FakeBulkaApiClient {
  int arrivalCalls = 0;
  CustomerOrder order = _readyPickupOrder;

  @override
  Future<List<CustomerOrder>> getCustomerOrders({
    bool completed = false,
  }) async {
    return completed ? const [] : [order];
  }

  @override
  Future<CustomerOrder> markCustomerArrived(String orderId) async {
    arrivalCalls++;
    order = CustomerOrder(
      id: order.id,
      number: order.number,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      amount: order.amount,
      subtotal: order.subtotal,
      discount: order.discount,
      branch: order.branch,
      items: order.items,
      earnedBonus: order.earnedBonus,
      createdAt: order.createdAt,
      fulfillmentType: order.fulfillmentType,
      deliveryStatus: order.deliveryStatus,
      customerArrivedAt: DateTime.utc(2026, 7, 16, 12),
    );
    return order;
  }
}

final _readyPickupOrder = CustomerOrder(
  id: 'ready-order',
  number: 100124,
  paymentStatus: 'paid',
  orderStatus: 'ready',
  amount: 2400,
  subtotal: 2400,
  discount: 0,
  branch: 'Bulka, 17-й микрорайон',
  items: const [
    {'id': 'croissant', 'name': 'Круассан', 'quantity': 2, 'price': 1200},
  ],
  earnedBonus: 120,
  createdAt: DateTime.utc(2026, 7, 16, 10),
  fulfillmentType: 'pickup',
  deliveryStatus: 'unassigned',
);

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

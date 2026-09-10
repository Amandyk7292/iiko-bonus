import 'dart:async';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class StockApi extends StaffApiClient {
  StockApi({
    this.largeCatalog = false,
    this.frontConnected = false,
    this.showCounters = false,
  });
  final bool largeCatalog;
  final bool frontConnected;
  final bool showCounters;
  bool manual = true;
  final changes = <Map<String, dynamic>>[];
  final eventsFeed = StreamController<Map<String, dynamic>>.broadcast();
  int quantity = 5, revision = 1;
  bool stopped = false;
  @override
  Stream<Map<String, dynamic>> events({String? lastEventId}) =>
      eventsFeed.stream;
  @override
  Future<dynamic> request(
    String endpoint, {
    String method = 'GET',
    Object? body,
    bool authenticated = true,
    Map<String, String> headers = const {},
    Map<String, String> query = const {},
  }) async {
    if (endpoint == '/scope') {
      return {
        'locations': [
          {'id': 'branch', 'name': '19а ЖК Жасыл дала'},
        ],
        'selectedBranchId': 'branch',
      };
    }
    if (method == 'PATCH') {
      final change = Map<String, dynamic>.from(body as Map);
      changes.add(change);
      if (change['expectedRevision'] != revision) {
        throw const StaffApiException(409, 'conflict', 'Остаток уже изменился');
      }
      if (change.containsKey('sourceQuantity')) {
        quantity = change['sourceQuantity'] as int;
      }
      if (change.containsKey('manualStop')) {
        stopped = change['manualStop'] as bool;
      }
      if (change['useIiko'] == true) {
        quantity = 3;
        manual = false;
      }
      revision++;
      return {'success': true};
    }
    if (endpoint == '/staff/catalog') {
      return {
        'frontSync': {
          'configured': frontConnected,
          'connected': frontConnected,
        },
        'products': [
          {
            'id': 'bun',
            'name': 'Плюшка Московская',
            'category': 'Выпечка',
            'imageUrl': '',
            'sourceQuantity': quantity,
            'availableQuantity': quantity - 1,
            'reserved': 1,
            'manualStop': stopped,
            'revision': revision,
            if (frontConnected) ...{
              'stockSource': manual ? 'manual' : 'iiko',
              'isIikoProduct': true,
              'frontQuantity': 3,
            },
          },
          {
            'id': 'dessert',
            'name': 'Десерт Молочная девочка',
            'category': 'Десерты',
            'imageUrl': '',
            'sourceQuantity': 0,
            'availableQuantity': 0,
            'reserved': 0,
            'manualStop': true,
            'revision': 1,
          },
          if (largeCatalog)
            for (var i = 0; i < 118; i++)
              {
                'id': 'product-$i',
                'name': i < 8
                    ? [
                        'Баурсак вес',
                        'Блины — 17',
                        'Булочка с корицей',
                        'Булочка с маком',
                        'Ватрушка с творогом',
                        'Десерт Медовик',
                        'Круассан классический',
                        'Смесь для блинов',
                      ][i]
                    : 'Выпечка ${i.toString().padLeft(3, '0')}',
                'category': i < 2 ? 'Блины и бауырсак' : 'Выпечка',
                'imageUrl': '',
                'sourceQuantity': i == 5 ? 0 : 8 + i,
                'availableQuantity': i == 5 ? 0 : 8 + i,
                'reserved': 0,
                'manualStop': i == 5,
                'revision': 1,
              },
        ],
      };
    }
    return {
      'orders': [],
      'total': 0,
      if (showCounters)
        'counters': {'newOrders': 7, 'preparing': 3, 'preorders': 2},
    };
  }
}

void main() {
  setUpAll(() async {
    final regular = FontLoader('Montserrat')
      ..addFont(rootBundle.load('assets/fonts/Montserrat-Regular-subset.ttf'));
    await regular.load();
    await (FontLoader(
      'MaterialIcons',
    )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
  });
  setUp(() {
    SharedPreferences.setMockInitialValues({'staffKitchenSound': false});
    appLanguageNotifier.value = 'ru';
  });
  testWidgets('cashier badges remain legible above the full stock list', (
    tester,
  ) async {
    final api = StockApi(largeCatalog: true, showCounters: true);
    addTearDown(api.eventsFeed.close);
    addTearDown(api.close);
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        theme: staffTheme().copyWith(
          textTheme: ThemeData(fontFamily: 'Montserrat').textTheme,
        ),
        home: RepaintBoundary(
          key: const ValueKey('badge-preview'),
          child: CashierWorkspace(
            api: api,
            user: const {'role': 'cashier'},
            onLogout: () async {},
            nativePushEnabled: false,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Стоп-лист').last);
    await tester.pumpAndSettle();
    await expectLater(
      find.byKey(const ValueKey('badge-preview')),
      matchesGoldenFile('goldens/cashier-order-badges.png'),
    );
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('cashier stock saves quantity, streams changes and stays white', (
    tester,
  ) async {
    final api = StockApi();
    addTearDown(() {
      api.eventsFeed.close();
      api.close();
    });
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        theme: staffTheme().copyWith(
          textTheme: ThemeData(fontFamily: 'Montserrat').textTheme,
        ),
        home: RepaintBoundary(
          key: const ValueKey('screen'),
          child: CashierWorkspace(
            api: api,
            user: const {'role': 'cashier', 'username': 'cashier'},
            onLogout: () async {},
            nativePushEnabled: false,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await expectLater(
      find.byKey(const ValueKey('screen')),
      matchesGoldenFile('goldens/cashier-orders.png'),
    );
    await tester.tap(find.text('Кухня').last);
    await tester.pumpAndSettle();
    await expectLater(
      find.byKey(const ValueKey('screen')),
      matchesGoldenFile('goldens/cashier-kitchen.png'),
    );
    await tester.tap(find.text('Стоп-лист').last);
    await tester.pumpAndSettle();
    expect(find.text('Плюшка Московская'), findsOneWidget);
    await expectLater(
      find.byKey(const ValueKey('screen')),
      matchesGoldenFile('goldens/cashier-stock.png'),
    );
    await tester.tap(find.widgetWithText(OutlinedButton, '5'));
    await tester.pumpAndSettle();
    final input = find.byType(TextField).last;
    await tester.enterText(input, '7');
    await tester.tap(find.text('Сохранить'));
    await tester.pumpAndSettle();
    expect(find.text('Сохранить изменения?'), findsOneWidget);
    expect(api.changes, isEmpty);
    await tester.tap(find.widgetWithText(TextButton, 'Отмена'));
    await tester.pumpAndSettle();
    expect(api.changes, isEmpty);
    expect(
      tester.widget<TextField>(find.byType(TextField).last).controller!.text,
      '7',
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Сохранить'));
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(
        of: find.byType(AlertDialog),
        matching: find.widgetWithText(FilledButton, 'Сохранить'),
      ),
    );
    await tester.pumpAndSettle();
    expect(api.changes.single, {'expectedRevision': 1, 'sourceQuantity': 7});
    expect(find.widgetWithText(OutlinedButton, '7'), findsOneWidget);
    api.quantity = 3;
    api.revision++;
    api.eventsFeed.add({
      'type': 'inventory.updated',
      'data': {'branchId': 'branch'},
    });
    await tester.pump(const Duration(milliseconds: 150));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(OutlinedButton, '3'), findsOneWidget);
    final navigation = tester.widget<NavigationBar>(find.byType(NavigationBar));
    expect(
      Theme.of(
        tester.element(find.byType(NavigationBar)),
      ).navigationBarTheme.backgroundColor,
      Colors.white,
    );
    expect(navigation.selectedIndex, 2);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets(
    'returning to Front confirms and restores the register quantity',
    (tester) async {
      final api = StockApi(frontConnected: true);
      addTearDown(() {
        api.eventsFeed.close();
        api.close();
      });
      await tester.pumpWidget(
        MaterialApp(
          theme: staffTheme(),
          home: Scaffold(body: CashierCatalog(api: api)),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('iikoFront подключён'), findsOneWidget);
      await tester.tap(find.widgetWithText(OutlinedButton, '5'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Использовать остаток iikoFront'));
      await tester.pumpAndSettle();
      expect(api.changes, isEmpty);
      await tester.tap(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.widgetWithText(FilledButton, 'Сохранить'),
        ),
      );
      await tester.pumpAndSettle();
      expect(api.changes.single, {'expectedRevision': 1, 'useIiko': true});
      expect(find.widgetWithText(OutlinedButton, '3'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
  testWidgets(
    '120 products use a lazy list with pinned search and category selection',
    (tester) async {
      final api = StockApi(largeCatalog: true);
      addTearDown(() {
        api.eventsFeed.close();
        api.close();
      });
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          theme: staffTheme(),
          home: RepaintBoundary(
            key: const ValueKey('large-screen'),
            child: CashierWorkspace(
              api: api,
              user: const {'role': 'cashier', 'username': 'cashier'},
              onLogout: () async {},
              nativePushEnabled: false,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Стоп-лист').last);
      await tester.pumpAndSettle();
      expect(find.text('Найдено: 120'), findsOneWidget);
      await expectLater(
        find.byKey(const ValueKey('large-screen')),
        matchesGoldenFile('goldens/cashier-stock-120.png'),
      );
      final search = find.byType(TextField).hitTestable().first;
      final before = tester.getTopLeft(search);
      final list = find.descendant(
        of: find.byType(CashierCatalog),
        matching: find.byType(ListView),
      );
      await tester.drag(list, const Offset(0, -1000));
      await tester.pumpAndSettle();
      expect(tester.getTopLeft(search), before);
      await tester.enterText(search, 'Плюшка Московская');
      await tester.pumpAndSettle();
      expect(find.text('Найдено: 1'), findsOneWidget);
      expect(find.byKey(const ValueKey('stock-bun')), findsOneWidget);
      await tester.tap(find.byTooltip('Очистить поиск'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Все категории'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Блины и бауырсак'));
      await tester.pumpAndSettle();
      expect(find.text('Найдено: 2'), findsOneWidget);
      expect(find.text('Блины — 17'), findsOneWidget);
      expect(find.text('Плюшка Московская'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
  for (final lang in ['ru', 'kk', 'en']) {
    testWidgets('cashier catalog fits a narrow screen in $lang', (
      tester,
    ) async {
      appLanguageNotifier.value = lang;
      final api = StockApi();
      addTearDown(() {
        api.eventsFeed.close();
        api.close();
      });
      tester.view.physicalSize = const Size(320, 740);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          theme: staffTheme(),
          home: Scaffold(body: CashierCatalog(api: api)),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }
}

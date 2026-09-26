import 'dart:convert';
import 'dart:async';
import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'helpers/selected_bakery_locations.dart';

class _NavigationApi extends BulkaApiClient {
  _NavigationApi(http.Client client) : super(client: client);
  @override
  Stream<Map<String, dynamic>> get customerEvents => const Stream.empty();
}

Future<void> openCart(
  WidgetTester tester, {
  bool reduced = false,
  Completer<void>? catalogGate,
}) async {
  SharedPreferences.setMockInitialValues({
    'selected_order_type': 'pickup',
    'selected_bakery_location_id_pickup': 'branch-one',
    'selected_bakery_location_pickup': 'Филиал',
  });
  appLanguageNotifier.value = 'ru';
  clientRouteNotifier.value = Uri(path: '/cart');
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  var menuReads = 0;
  final client = MockClient((request) async {
    if (request.url.path == '/api/guest/menu' &&
        ++menuReads > 1 &&
        catalogGate != null) {
      await catalogGate.future;
    }
    if (request.url.path == '/api/guest/locations') {
      return selectedBakeryLocationsResponse();
    }
    return http.Response(
      jsonEncode(
        request.url.path == '/api/guest/menu'
            ? {
                'success': true,
                'categories': [
                  {'id': 'buns', 'name': 'Булочки'},
                ],
                'products': [
                  {
                    'id': 'bun-1',
                    'name': 'Плюшка московская',
                    'categoryId': 'buns',
                    'price': 180,
                    'description': List.filled(
                      70,
                      'Описание продукта.',
                    ).join(' '),
                    'imageUrl': '',
                    'ingredients': List.filled(
                      60,
                      'Мука, масло, сахар.',
                    ).join(' '),
                    'onlineOrderable': false,
                    'inStopList': true,
                  },
                ],
              }
            : {'success': true},
      ),
      200,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );
  });
  final api = _NavigationApi(client);
  final cart = CartProvider();
  await cart.restored;
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
    cart.dispose();
    clientRouteNotifier.value = Uri(path: '/');
  });
  await tester.pumpWidget(
    ChangeNotifierProvider.value(
      value: cart,
      child: MaterialApp(
        theme: buildBulkaTheme().copyWith(platform: TargetPlatform.iOS),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(disableAnimations: reduced),
          child: child!,
        ),
        home: MainShell(
          api: api,
          customer: null,
          transactions: const [],
          initialTab: 2,
          onLogout: () async {},
          onRefreshProfile: () async {},
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> tapPopular(WidgetTester tester) async {
  final card = find.byKey(const ValueKey('cart-popular-product-bun-1'));
  await tester.ensureVisible(card);
  await tester.tap(card);
  await tester.pumpAndSettle();
}

void main() {
  for (final warm in [false, true]) {
    for (final reduced in [false, true]) {
      testWidgets(
        'native popular link opens product: warm=$warm reduced=$reduced',
        (tester) async {
          await openCart(tester, reduced: reduced);
          if (warm) {
            await tester.tap(find.byKey(const ValueKey('nav-1')));
            await tester.pumpAndSettle();
            await tester.tap(find.byKey(const ValueKey('nav-2')));
            await tester.pumpAndSettle();
          }
          await tapPopular(tester);
          expect(find.byType(ProductDetailsScreen), findsOneWidget);
          expect(
            tester
                .widget<ProductDetailsScreen>(find.byType(ProductDetailsScreen))
                .product
                .id,
            'bun-1',
          );
          final button = tester.widget<FilledButton>(
            find.byKey(const ValueKey('catalog-image-add')).hitTestable(),
          );
          expect(button.onPressed, isNull);
          expect(
            button.style!.backgroundColor!.resolve({WidgetState.disabled}),
            const Color(0xFFE4E1DD),
          );
          expect(tester.takeException(), isNull);
        },
      );
    }
  }

  testWidgets('leaving the catalog cancels a product link awaiting its menu', (
    tester,
  ) async {
    final gate = Completer<void>();
    await openCart(tester, catalogGate: gate);
    final card = find.byKey(const ValueKey('cart-popular-product-bun-1'));
    await tester.ensureVisible(card);
    await tester.tap(card);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tap(find.byKey(const ValueKey('nav-4')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    gate.complete();
    await tester.pumpAndSettle();
    expect(find.byType(ProductDetailsScreen), findsNothing);
    expect(
      tester
          .widget<Offstage>(find.byKey(const ValueKey('tab-slot-4')))
          .offstage,
      isFalse,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'short pull stays open, long pull closes and refresh does not reopen product',
    (tester) async {
      await openCart(tester);
      await tapPopular(tester);
      final scroll = find.byKey(const ValueKey('product-content-scroll'));
      await tester.drag(scroll, const Offset(0, 45));
      await tester.pumpAndSettle();
      expect(find.byType(ProductDetailsScreen), findsOneWidget);
      await tester.drag(scroll, const Offset(0, 240));
      await tester.pumpAndSettle();
      expect(find.byType(ProductDetailsScreen), findsNothing);
      await tester.pump(const Duration(seconds: 61));
      await tester.pumpAndSettle();
      expect(find.byType(ProductDetailsScreen), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'scrolling description does not close product and unavailable badge is centered',
    (tester) async {
      await openCart(tester);
      await tapPopular(tester);
      final scroll = find.byKey(const ValueKey('product-content-scroll'));
      await tester.drag(scroll, const Offset(0, -320));
      await tester.pumpAndSettle();
      final position = tester
          .state<ScrollableState>(
            find
                .descendant(of: scroll, matching: find.byType(Scrollable))
                .first,
          )
          .position;
      expect(position.pixels, greaterThan(0));
      await tester.drag(scroll, const Offset(0, 120));
      await tester.pumpAndSettle();
      expect(find.byType(ProductDetailsScreen), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('product-close')));
      await tester.pumpAndSettle();
      final label = find.text('Нет в наличии').first;
      final box = find
          .ancestor(of: label, matching: find.byType(Container))
          .first;
      expect(
        tester.getRect(label).center.dy,
        closeTo(tester.getRect(box).center.dy, 0.1),
      );
      expect(tester.takeException(), isNull);
    },
  );
}

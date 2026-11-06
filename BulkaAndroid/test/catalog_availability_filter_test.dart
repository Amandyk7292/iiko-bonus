import 'dart:convert';
import 'dart:io' as io;
import 'dart:ui' as ui;

import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

const capture = bool.fromEnvironment('BULKA_UI_REVIEW_CAPTURE');

Future<void> screenshot(
  WidgetTester tester,
  GlobalKey boundary,
  String name,
) async {
  if (!capture) return;
  await tester.runAsync(() async {
    final image =
        await (boundary.currentContext!.findRenderObject()!
                as RenderRepaintBoundary)
            .toImage(pixelRatio: 2);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await io.Directory('outputs/ui-review').create(recursive: true);
    await io.File(
      'outputs/ui-review/$name.png',
    ).writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}

void main() {
  for (final scale in [1.0, 1.8]) {
    testWidgets(
      'availability filters orderable branch products and resets, text $scale',
      (tester) async {
        appLanguageNotifier.value = 'ru';
        tester.view.physicalSize = Size(scale == 1 ? 390 : 320, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        SharedPreferences.setMockInitialValues({
          'selected_bakery_location_id_pickup': 'branch-one',
          'selected_bakery_location_pickup': 'Филиал',
        });
        if (capture) {
          await tester.runAsync(() async {
            for (final entry in {
              'Montserrat': 'assets/fonts/Montserrat-Regular-subset.ttf',
              'MontserratBold': 'assets/fonts/Montserrat-Bold-subset.ttf',
              'MaterialIcons': 'assets/fonts/BulkaIcons.ttf',
            }.entries) {
              await (FontLoader(
                entry.key,
              )..addFont(rootBundle.load(entry.value))).load();
            }
          });
        }
        final api = BulkaApiClient(
          client: MockClient((request) async {
            final payload = request.url.path.endsWith('/locations')
                ? {
                    'success': true,
                    'locations': [
                      {
                        'id': 'branch-one',
                        'name': 'Филиал',
                        'city': 'Актау',
                        'address': '19а',
                      },
                    ],
                  }
                : request.url.path.endsWith('/menu')
                ? {
                    'success': true,
                    'categories': [
                      {'id': 'buns', 'name': 'Булочки'},
                    ],
                    'products': [
                      {
                        'id': 'available',
                        'name': 'Плюшка',
                        'categoryId': 'buns',
                        'price': 180,
                        'onlineOrderable': true,
                        'availableQuantity': 5,
                      },
                      {
                        'id': 'sold-out',
                        'name': 'Слойка',
                        'categoryId': 'buns',
                        'price': 200,
                        'onlineOrderable': true,
                        'availableQuantity': 0,
                      },
                      {
                        'id': 'disabled',
                        'name': 'Круассан',
                        'categoryId': 'buns',
                        'price': 300,
                        'onlineOrderable': false,
                        'availableQuantity': 8,
                      },
                    ],
                  }
                : {'success': true};
            return http.Response(
              jsonEncode(payload),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            );
          }),
        );
        addTearDown(api.dispose);
        final cart = CartProvider();
        addTearDown(cart.dispose);
        final boundary = GlobalKey();
        await tester.pumpWidget(
          ChangeNotifierProvider.value(
            value: cart,
            child: RepaintBoundary(
              key: boundary,
              child: MaterialApp(
                debugShowCheckedModeBanner: false,
                theme: buildBulkaTheme(),
                builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(
                    context,
                  ).copyWith(textScaler: TextScaler.linear(scale)),
                  child: child!,
                ),
                home: CatalogScreen(api: api, hasSelectedOrderType: true),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('catalog-results-filter')));
        await tester.pumpAndSettle();
        await screenshot(tester, boundary, 'filter-$scale');
        expect(tester.takeException(), isNull);
        final apply = find.byKey(const ValueKey('catalog-filter-apply'));
        final reset = find.byKey(const ValueKey('catalog-filter-reset'));
        expect(tester.widget(apply), isA<FilledButton>());
        expect(tester.widget(reset), isA<OutlinedButton>());
        await tester.tap(find.byKey(const ValueKey('catalog-only-in-stock')));
        await tester.tap(apply);
        await tester.pumpAndSettle();
        expect(
          find.byKey(const ValueKey('catalog-product-image-available')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('catalog-product-image-sold-out')),
          findsNothing,
        );
        expect(
          find.byKey(const ValueKey('catalog-product-image-disabled')),
          findsNothing,
        );
        await tester.tap(find.byKey(const ValueKey('catalog-results-filter')));
        await tester.pumpAndSettle();
        expect(
          tester
              .widget<SwitchListTile>(
                find.byKey(const ValueKey('catalog-only-in-stock')),
              )
              .value,
          isTrue,
        );
        await tester.tap(reset);
        await tester.tap(apply);
        await tester.pumpAndSettle();
        // Search proves the excluded product returns even when its row was lazy.
        await tester.enterText(
          find.byKey(const ValueKey('catalog-sticky-search')),
          'Слойка',
        );
        await tester.pumpAndSettle();
        expect(
          find.byKey(const ValueKey('catalog-product-image-sold-out')),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      },
    );
  }
}

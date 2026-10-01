import 'dart:convert';

import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'helpers/selected_bakery_locations.dart';

void main() {
  for (final scenario in [
    (size: const Size(320, 720), scale: 1.0, photo: true),
    (size: const Size(375, 812), scale: 2.0, photo: true),
    (size: const Size(320, 720), scale: 2.0, photo: false),
  ]) {
    testWidgets(
      'sticker clears product controls and title at ${scenario.size}, scale ${scenario.scale}, photo ${scenario.photo}',
      (tester) async {
        await _pumpFeed(
          tester,
          richProducts: true,
          productsPerCategory: 4,
          size: scenario.size,
          textScale: scenario.scale,
          productImages: scenario.photo,
        );
        await tester.ensureVisible(_image(0, 0));
        await tester.pump();
        expect(find.byType(ProductPhotoSticker), findsWidgets);
        expect(_image(0, 0), findsOneWidget);
        final sticker = find
            .byKey(const ValueKey('product-sticker-portrait'))
            .first;
        final favorite = find.byKey(const ValueKey('catalog-favorite-p-0-0'));
        expect(
          tester.getRect(sticker).overlaps(tester.getRect(favorite)),
          isFalse,
        );
        expect(
          tester.getSize(sticker).width / tester.getSize(_image(0, 0)).width,
          lessThan(0.4),
          reason:
              'endorsement leaves the product image visible in a two-column feed',
        );
        await tester.tap(_image(0, 0));
        // Image loading can keep its progress indicator ticking. Measure the
        // completed route layout without waiting for a real network download.
        await tester.pump();
        await tester.pump(const Duration(seconds: 1));
        final photo = find.byKey(const ValueKey('product-photo-area'));
        expect(
          find.descendant(
            of: photo,
            matching: find.byType(ProductPhotoSticker),
          ),
          findsOneWidget,
        );
        final detailSticker = find.descendant(
          of: photo,
          matching: find.byKey(const ValueKey('product-sticker-portrait')),
        );
        final title = find.byKey(const ValueKey('product-photo-title'));
        final stickerRect = tester.getRect(detailSticker);
        final photoRect = tester.getRect(photo);
        expect(stickerRect.width / photoRect.width, lessThan(0.25));
        expect(stickerRect.left, greaterThanOrEqualTo(photoRect.left));
        expect(stickerRect.right, lessThanOrEqualTo(photoRect.right));
        expect(stickerRect.top, greaterThanOrEqualTo(photoRect.top + 88));
        expect(
          stickerRect.bottom,
          lessThanOrEqualTo(tester.getRect(title).top - 12),
        );
        for (final control in [
          'product-share',
          'product-favorite',
          'product-close',
        ]) {
          final controlRect = tester.getRect(find.byKey(ValueKey(control)));
          expect(stickerRect.overlaps(controlRect), isFalse);
          expect(stickerRect.top, greaterThanOrEqualTo(controlRect.bottom));
        }
        expect(tester.takeException(), isNull);
      },
    );
  }
  testWidgets(
    'a far category jumps into the lazy feed and all returns to top',
    (tester) async {
      await _pumpFeed(tester);
      expect(_image(0, 0), findsOneWidget);
      expect(
        tester.getTopLeft(_image(0, 0)).dy,
        closeTo(tester.getTopLeft(_image(0, 1)).dy, 0.1),
      );
      expect(_image(9, 0), findsNothing);
      final headerY = tester.getTopLeft(_strip).dy;
      await _tapCategory(tester, 9);
      expect(_image(9, 0), findsOneWidget);
      expect(_selected(tester, 9), isTrue);
      expect(tester.getTopLeft(_strip).dy, closeTo(headerY, 0.1));
      expect(
        tester.getTopLeft(_image(9, 0)).dy,
        greaterThan(tester.getBottomLeft(_strip).dy),
      );
      expect(
        find.byKey(const ValueKey('catalog-category-page-Категория 09')),
        findsNothing,
      );
      final all = find.byKey(
        const ValueKey('catalog-category-chip-__all_categories__'),
      );
      await tester.dragUntilVisible(all, _strip, const Offset(250, 0));
      await tester.tap(all);
      await tester.pumpAndSettle();
      expect(_position(tester).pixels, closeTo(0, 0.1));
      expect(_image(0, 0), findsOneWidget);
      expect(_image(9, 0), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'vertical scrolling updates the selected category without rebuilding cards',
    (tester) async {
      await _pumpFeed(tester, productsPerCategory: 2);
      await _tapCategory(tester, 0);
      final imageWidget = tester.widget(_image(0, 0));
      final section = find.byKey(
        const ValueKey('catalog-section-Категория 01'),
      );
      final delta =
          tester.getTopLeft(section).dy - tester.getBottomLeft(_strip).dy;
      _position(tester).jumpTo(_position(tester).pixels + delta);
      await tester.pumpAndSettle();
      expect(_selected(tester, 1), isTrue);
      expect(tester.widget(_image(0, 0)), same(imageWidget));
      final chip = find.byKey(
        const ValueKey('catalog-category-chip-Категория 01'),
      );
      expect(tester.getRect(chip).overlaps(tester.getRect(_strip)), isTrue);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a category deep link opens the requested section on the catalog page',
    (tester) async {
      await _pumpFeed(
        tester,
        initialUri: Uri(
          pathSegments: ['', 'catalog', 'category', 'Категория 08'],
        ),
      );
      expect(_image(8, 0), findsOneWidget);
      expect(_selected(tester, 8), isTrue);
      expect(
        find.byKey(const ValueKey('catalog-sticky-search')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('catalog-category-back')), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('search retains keyboard focus after debounced results arrive', (
    tester,
  ) async {
    await _pumpFeed(tester);
    final field = find.byKey(const ValueKey('catalog-sticky-search'));
    await tester.enterText(field, 'Товар 09-00');
    await tester.pump(const Duration(milliseconds: 250));
    await tester.pumpAndSettle();
    expect(_image(9, 0), findsOneWidget);
    final editable = tester.widget<EditableText>(
      find.descendant(of: field, matching: find.byType(EditableText)),
    );
    expect(editable.focusNode.hasFocus, isTrue);
    expect(tester.testTextInput.isVisible, isTrue);
    expect(tester.takeException(), isNull);
  });

  for (final scenario in [
    (size: const Size(320, 720), scale: 1.0),
    (size: const Size(375, 812), scale: 1.0),
    (size: const Size(812, 375), scale: 1.0),
    (size: const Size(375, 812), scale: 2.0),
  ]) {
    testWidgets(
      'feed adapts to ${scenario.size} with text scale ${scenario.scale}',
      (tester) async {
        final cart = await _pumpFeed(
          tester,
          size: scenario.size,
          textScale: scenario.scale,
          richProducts: true,
          productsPerCategory: 4,
        );
        cart.addItem(
          productId: 'p-0-0',
          name: 'Товар 00-00',
          price: 500,
          imageUrl: '',
          quantity: 0.75,
          unit: 'кг',
          quantityStep: 0.25,
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final favorite = find.byKey(const ValueKey('catalog-favorite-p-0-0'));
        expect(tester.getSize(favorite).shortestSide, greaterThanOrEqualTo(44));
        expect(tester.getSize(_image(0, 0)).width, greaterThan(100));
        if (scenario.size.width <= 375 && scenario.scale == 1) {
          expect(
            tester.getTopLeft(_image(0, 0)).dy,
            closeTo(tester.getTopLeft(_image(0, 1)).dy, 0.1),
          );
        }
        await tester.drag(_list, const Offset(0, -450));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final last = find.byKey(
          const ValueKey('catalog-category-chip-Категория 09'),
        );
        await tester.dragUntilVisible(last, _strip, const Offset(-250, 0));
        await tester.tap(last);
        await tester.pumpAndSettle();
        expect(_image(9, 0), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }
}

final _strip = find.byKey(const ValueKey('catalog-category-strip'));
final _list = find.byKey(const ValueKey('catalog-products-list'));
Finder _image(int category, int index) =>
    find.byKey(ValueKey('catalog-product-image-p-$category-$index'));
String _category(int index) => 'Категория ${index.toString().padLeft(2, '0')}';
ScrollPosition _position(WidgetTester tester) =>
    tester.widget<CustomScrollView>(_list).controller!.position;
bool _selected(WidgetTester tester, int category) =>
    tester
        .widget<Semantics>(
          find
              .descendant(
                of: find.byKey(
                  ValueKey('catalog-category-chip-${_category(category)}'),
                ),
                matching: find.byType(Semantics),
              )
              .first,
        )
        .properties
        .selected ==
    true;

Future<void> _tapCategory(WidgetTester tester, int category) async {
  final chip = find.byKey(
    ValueKey('catalog-category-chip-${_category(category)}'),
  );
  await tester.dragUntilVisible(chip, _strip, const Offset(-250, 0));
  await tester.tap(chip);
  await tester.pumpAndSettle();
}

Future<CartProvider> _pumpFeed(
  WidgetTester tester, {
  Size size = const Size(390, 844),
  double textScale = 1,
  int productsPerCategory = 24,
  bool richProducts = false,
  bool productImages = false,
  Uri? initialUri,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  appLanguageNotifier.value = 'ru';
  SharedPreferences.setMockInitialValues({
    'selected_bakery_location_id_pickup': 'branch-one',
    'selected_bakery_location_pickup': 'Bulka, Актау',
  });
  final client = MockClient((request) async {
    if (request.url.path == '/api/guest/locations') {
      return selectedBakeryLocationsResponse();
    }
    return http.Response(
      jsonEncode(
        request.url.path == '/api/guest/menu'
            ? {
                'success': true,
                'categories': [
                  for (var c = 0; c < 10; c++)
                    {'id': 'c-$c', 'name': _category(c)},
                ],
                'products': [
                  for (var c = 0; c < 10; c++)
                    for (var p = 0; p < productsPerCategory; p++)
                      {
                        'id': 'p-$c-$p',
                        'categoryId': 'c-$c',
                        'name':
                            'Товар ${c.toString().padLeft(2, '0')}-${p.toString().padLeft(2, '0')}'
                            '${richProducts ? ' со сливочным маслом и начинкой из ягод' : ''}',
                        'price': 500 + p,
                        'imageUrl': productImages
                            ? 'https://example.com/product.png'
                            : '',
                        'onlineOrderable': true,
                        if (richProducts) ...{
                          'unit': p.isEven ? 'кг' : 'шт.',
                          'quantityStep': p.isEven ? 0.25 : 1,
                          'inStockCount': 10,
                          'weightGrams': 200 + p,
                          'badges': [
                            {
                              'id': 'portrait',
                              'label': 'Менің таңдауым',
                              'imageUrl': 'https://example.com/sticker.png',
                            },
                            {'id': 'hit', 'label': 'Хит'},
                            {'id': 'new', 'label': 'Новинка'},
                            {'id': 'fresh', 'label': 'Свежая выпечка'},
                          ],
                        },
                      },
                ],
              }
            : {'success': true},
      ),
      200,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );
  });
  final api = BulkaApiClient(client: client);
  final cart = CartProvider();
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
    cart.dispose();
    client.close();
  });
  await tester.pumpWidget(
    MaterialApp(
      theme: buildBulkaTheme(),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(textScale),
          disableAnimations: true,
        ),
        child: child!,
      ),
      home: ChangeNotifierProvider.value(
        value: cart,
        child: CatalogScreen(
          api: api,
          hasSelectedOrderType: true,
          initialClientUri: initialUri,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return cart;
}

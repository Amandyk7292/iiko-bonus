import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bulka_bonus/main.dart';
import 'package:cached_network_image/cached_network_image.dart';

void main() {
  testWidgets('a stored PNG sticker uses lossless delivery', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: ProductPhotoSticker(
            badges: [
              {
                'id': 'lossless',
                'label': 'Наклейка',
                'imageUrl':
                    'https://owofrgapcxsmzkdsefai.supabase.co/storage/v1/object/public/menu_images/sticker.png',
              },
            ],
          ),
        ),
      ),
    );
    final image = tester.widget<CachedNetworkImage>(
      find.byType(CachedNetworkImage),
    );
    final uri = Uri.parse(image.imageUrl);
    expect(uri.path, '/api/public/image');
    expect(uri.queryParameters['path'], 'menu_images/sticker.png');
    expect(uri.queryParameters.containsKey('mode'), isFalse);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
    'photo sticker is not rendered as a text chip and preserves three text badges',
    (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ProductBadgeChips(
              badges: [
                {
                  'id': 'portrait',
                  'label': 'Шамрадтың таңдауы',
                  'imageUrl': 'https://example.com/sticker.png',
                },
                {'label': 'Хит'},
                {'label': 'Новинка'},
                {'label': 'Без сахара'},
              ],
            ),
          ),
        ),
      );
      expect(find.text('Шамрадтың таңдауы'), findsNothing);
      expect(find.text('Хит'), findsOneWidget);
      expect(find.text('Новинка'), findsOneWidget);
      expect(find.text('Без сахара'), findsOneWidget);
    },
  );

  testWidgets(
    'portrait sticker fits a narrow photo and has an accessible label',
    (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 40,
              child: ProductPhotoSticker(
                badges: [
                  {
                    'id': 'portrait',
                    'label': 'Шамрадтың таңдауы',
                    'imageUrl': 'https://example.com/sticker.png',
                  },
                ],
              ),
            ),
          ),
        ),
      );
      expect(
        tester.getSize(find.byKey(const ValueKey('product-sticker-portrait'))),
        const Size(40, 40),
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'missing or unsafe sticker leaves the product photo unobstructed',
    (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ProductPhotoSticker(
              badges: [
                {
                  'id': 'unsafe',
                  'label': 'Invalid',
                  'imageUrl': 'javascript:alert(1)',
                },
              ],
            ),
          ),
        ),
      );
      expect(
        find.byKey(const ValueKey('product-sticker-unsafe')),
        findsNothing,
      );
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('product badges display configured text and colors', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: ProductBadgeChips(
            badges: [
              {
                'label': 'Хит',
                'background': '#ff0000',
                'foreground': '#ffffff',
              },
            ],
          ),
        ),
      ),
    );
    expect(find.text('Хит'), findsOneWidget);
    final text = tester.widget<Text>(find.text('Хит'));
    expect(text.style?.color, Colors.white);
    final container = tester.widget<Container>(
      find
          .ancestor(of: find.text('Хит'), matching: find.byType(Container))
          .first,
    );
    expect(
      (container.decoration as BoxDecoration).color,
      const Color(0xffff0000),
    );
  });
}

import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void _expectCompleteLabel(WidgetTester tester, Finder label, Finder bounds) {
  final paragraph = tester.renderObject<RenderParagraph>(label);
  expect(paragraph.didExceedMaxLines, isFalse);
  final text = tester.getRect(label);
  final container = tester.getRect(bounds);
  expect(text.left, greaterThanOrEqualTo(container.left));
  expect(text.right, lessThanOrEqualTo(container.right));
  expect(text.top, greaterThanOrEqualTo(container.top));
  expect(text.bottom, lessThanOrEqualTo(container.bottom));
  final painter = TextPainter(
    text: paragraph.text,
    textDirection: paragraph.textDirection,
    textScaler: paragraph.textScaler,
  )..layout(maxWidth: paragraph.size.width);
  expect(painter.height, lessThanOrEqualTo(paragraph.size.height + 0.1));
  painter.dispose();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (_) async => null);
  });
  setUpAll(() async {
    await (FontLoader('Montserrat')..addFont(
          rootBundle.load('assets/fonts/Montserrat-Regular-subset.ttf'),
        ))
        .load();
    await (FontLoader('MontserratBold')
          ..addFont(rootBundle.load('assets/fonts/Montserrat-Bold-subset.ttf')))
        .load();
  });
  tearDown(() {
    appLanguageNotifier.value = 'ru';
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null);
  });

  for (final language in ['ru', 'kk', 'en']) {
    for (final width in [320.0, 375.0, 430.0]) {
      for (final scale in [1.0, 1.3, 2.0]) {
        testWidgets(
          '$language support topics fit $width px at $scale and remain selectable',
          (tester) async {
            tester.view.physicalSize = Size(width, 900);
            tester.view.devicePixelRatio = 1;
            addTearDown(tester.view.resetPhysicalSize);
            addTearDown(tester.view.resetDevicePixelRatio);
            appLanguageNotifier.value = language;
            final submitted = <Map<String, dynamic>>[];
            final api = BulkaApiClient(
              client: MockClient((request) async {
                expect(request.url.path, '/api/customer/support');
                if (request.method == 'POST') {
                  final payload =
                      jsonDecode(request.body) as Map<String, dynamic>;
                  submitted.add(payload);
                  return http.Response(
                    jsonEncode({
                      'success': true,
                      'request': {'id': 'layout-fixture', ...payload},
                    }),
                    200,
                    headers: {'content-type': 'application/json'},
                  );
                }
                expect(request.method, 'GET');
                return http.Response(
                  jsonEncode({'success': true, 'requests': <Object>[]}),
                  200,
                  headers: {'content-type': 'application/json'},
                );
              }),
            );
            addTearDown(api.dispose);
            await tester.pumpWidget(
              MaterialApp(
                theme: buildBulkaTheme(),
                builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(
                    context,
                  ).copyWith(textScaler: TextScaler.linear(scale)),
                  child: child!,
                ),
                home: OrderSupportScreen(api: api),
              ),
            );
            await tester.pumpAndSettle();
            expect(tester.takeException(), isNull);
            final dropdown = find.byType(DropdownButtonFormField<String>);
            await tester.ensureVisible(dropdown);
            final dropdownRect = tester.getRect(dropdown);
            expect(dropdownRect.left, greaterThanOrEqualTo(0));
            expect(dropdownRect.right, lessThanOrEqualTo(width));
            _expectCompleteLabel(
              tester,
              find.text('support_category_other'.tr),
              dropdown,
            );

            for (final category in ['order_issue', 'product_quality']) {
              await tester.ensureVisible(dropdown);
              await tester.tap(dropdown);
              await tester.pumpAndSettle();
              expect(tester.takeException(), isNull);
              final topic = find.text('support_category_$category'.tr).last;
              await tester.ensureVisible(topic);
              final menuItem = find.ancestor(
                of: topic,
                matching: find.byType(DropdownMenuItem<String>),
              );
              expect(menuItem, findsOneWidget);
              _expectCompleteLabel(tester, topic, menuItem);
              await tester.tap(topic);
              await tester.pumpAndSettle();
              expect(
                tester
                    .widget<DropdownButton<String>>(
                      find.byType(DropdownButton<String>),
                    )
                    .value,
                category,
              );
              _expectCompleteLabel(
                tester,
                find.text('support_category_$category'.tr),
                dropdown,
              );
              expect(tester.takeException(), isNull);
            }
            await tester.enterText(
              find.byType(TextField),
              'Layout test message',
            );
            FocusManager.instance.primaryFocus?.unfocus();
            await tester.pumpAndSettle();
            final send = find.text('support_send'.tr);
            await tester.ensureVisible(send);
            await tester.pumpAndSettle();
            await tester.tap(send);
            await tester.pumpAndSettle();
            expect(submitted, hasLength(1));
            expect(submitted.single['category'], 'product_quality');
            expect(submitted.single['message'], 'Layout test message');
            expect(tester.takeException(), isNull);

            await tester.pumpWidget(const SizedBox());
            await tester.pumpAndSettle();
            api.dispose();
          },
        );
      }
    }
  }
}

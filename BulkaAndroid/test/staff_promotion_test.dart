import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class PromotionFixtureApi extends StaffApiClient {
  Map<String, dynamic>? saved;
  @override
  Stream<Map<String, dynamic>> events({String? lastEventId}) =>
      const Stream.empty();
  @override
  Future<dynamic> request(
    String endpoint, {
    String method = 'GET',
    Object? body,
    bool authenticated = true,
    Map<String, String> headers = const {},
    Map<String, String> query = const {},
  }) async {
    if (method == 'POST') saved = Map<String, dynamic>.from(body as Map);
    return {'promotions': [], 'giftCards': [], 'automations': []};
  }
}

void main() {
  testWidgets(
    'native promotion form hides irrelevant discounts and saves free delivery',
    (tester) async {
      tester.view.physicalSize = const Size(430, 932);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final api = PromotionFixtureApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          theme: staffTheme(),
          home: Scaffold(body: StaffMarketing(api: api)),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Добавить'));
      await tester.pumpAndSettle();
      expect(find.text('Дополнительные условия'), findsOneWidget);
      expect(
        find.widgetWithText(TextFormField, 'ID клиентов через запятую'),
        findsNothing,
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Код'),
        'DELIVERY',
      );
      await tester.tap(find.text('Тип скидки'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Бесплатная доставка').last);
      await tester.pumpAndSettle();
      expect(find.widgetWithText(TextFormField, 'Скидка'), findsNothing);
      await tester.tap(find.text('Сохранить'));
      await tester.pumpAndSettle();
      expect(api.saved?['discountType'], 'free_delivery');
      expect(api.saved?['discountValue'], 0);
      expect(api.saved?['maxDiscount'], isNull);
      expect(api.saved?['code'], 'DELIVERY');
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}

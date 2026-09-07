import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class TrackingApi extends BulkaApiClient {
  @override
  Stream<Map<String, dynamic>> get customerEvents => const Stream.empty();
}

void main() {
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({});
  });
  for (final scenario in ['waiting', 'assigned', 'cancelled']) {
    final assigned = scenario != 'waiting';
    final cancelled = scenario == 'cancelled';
    testWidgets('courier tracking remains clear without GPS: $scenario', (
      tester,
    ) async {
      final order = CustomerOrder.fromJson({
        'id': 'test',
        'number': 1,
        'paymentStatus': 'paid',
        'orderStatus': 'preparing',
        'fulfillmentType': 'delivery',
        'deliveryStatus': assigned ? 'assigned' : 'unassigned',
        if (cancelled) 'providerDeliveryStatus': 'cancelled',
        'createdAt': DateTime.now().toIso8601String(),
        'items': <Object>[],
        if (assigned)
          'courier': {
            'id': 'courier',
            'name': 'Тестовый курьер',
            'phone': '+77000000000',
          },
      });
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: OrderDetailsScreen(
            api: TrackingApi(),
            initialOrder: order,
            onRepeat: (_) async {},
            onReview: (_) async {},
            onOrderChanged: (_) {},
          ),
        ),
      );
      await tester.pump();
      await tester.scrollUntilVisible(find.text('Курьер на карте'), 200);
      expect(
        find.text(
          cancelled
              ? 'Отслеживание этой доставки остановлено. Уточните дальнейшую доставку через «Помощь по заказу».'
              : assigned
              ? 'Курьер назначен. Ожидаем координаты для карты. Контакты появятся ниже, когда служба доставки их передаст.'
              : 'Данные курьера появятся после назначения. Статус обновляется автоматически.',
        ),
        findsOneWidget,
      );
      if (cancelled) expect(find.text('Тестовый курьер'), findsNothing);
      if (assigned && !cancelled) {
        await tester.scrollUntilVisible(find.text('Позвонить'), 100);
        final call = tester.widget<FilledButton>(
          find.ancestor(
            of: find.text('Позвонить'),
            matching: find.byWidgetPredicate(
              (widget) => widget is FilledButton,
            ),
          ),
        );
        expect(call.onPressed, isNotNull);
      }
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    });
  }
}

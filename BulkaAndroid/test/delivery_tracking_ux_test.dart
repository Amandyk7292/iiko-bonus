import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fixtures/tracking_preview.dart';

class TrackingApi extends BulkaApiClient {
  @override
  Stream<Map<String, dynamic>> get customerEvents => const Stream.empty();
}

void main() {
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('tracking opens the map even without a provider link', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: OrderDetailsScreen(
          api: TrackingApi(),
          initialOrder: trackingPreviewOrder(),
          refreshOnOpen: false,
          onRepeat: (_) async {},
          onReview: (_) async {},
          onOrderChanged: (_) {},
        ),
      ),
    );
    final trackButton = find.text('Отследить курьера');
    await tester.scrollUntilVisible(trackButton, 100);
    await Scrollable.ensureVisible(tester.element(trackButton), alignment: .75);
    await tester.pump();
    expect(trackButton.hitTestable(), findsOneWidget);
    await tester.tap(trackButton);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    final map = find.byType(OrderTrackingMap);
    expect(map.hitTestable(), findsOneWidget);
    expect(tester.getTopLeft(map).dy, lessThan(160));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
    'ready orders send separate delivery and pickup activity states',
    (tester) async {
      const channel = MethodChannel('com.bulka.bonus/order_status');
      final messenger = tester.binding.defaultBinaryMessenger;
      final updates = <Map<Object?, Object?>>[];
      messenger.setMockMethodCallHandler(channel, (call) async {
        if (call.method == 'updateOrderStatus') {
          updates.add(call.arguments as Map<Object?, Object?>);
        }
        return true;
      });
      addTearDown(() => messenger.setMockMethodCallHandler(channel, null));

      for (final (type, deliveryStatus) in [
        ('delivery', 'unassigned'),
        ('delivery', 'assigned'),
        ('delivery', 'picked_up'),
        ('pickup', 'unassigned'),
      ]) {
        await OrderLiveStatus.sync(
          CustomerOrder.fromJson({
            'id': 'activity-test',
            'number': 1,
            'paymentStatus': 'paid',
            'orderStatus': 'ready',
            'fulfillmentType': type,
            'deliveryStatus': deliveryStatus,
          }),
        );
      }
      expect(updates.map((item) => item['status']), [
        'Заказ готов, ждём курьера',
        'Курьер едет за вашим заказом',
        'Курьер везёт ваш заказ',
        'Готов',
      ]);
      expect(updates.map((item) => item['orderStatus']), [
        'delivery_ready',
        'courier_collecting',
        'delivery_ready',
        'ready',
      ]);
      await OrderLiveStatus.clear();
    },
  );

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

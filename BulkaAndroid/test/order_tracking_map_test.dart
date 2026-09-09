import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/widgets/yandex_map/yandex_map.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'fixtures/tracking_preview.dart';

void main() {
  tearDown(() => appLanguageNotifier.value = 'ru');
  test(
    'order cache preserves exact sender and complete recipient coordinates',
    () {
      final original = trackingPreviewOrder();
      final cached = CustomerOrder.fromJson(original.toJson());
      final points = orderTrackingPoints(cached);
      expect(points.map((p) => p.kind), ['pickup', 'recipient', 'courier']);
      expect(points[0].point.latitude, 43.677412);
      expect(points[0].point.longitude, 51.13768);
      expect(points[1].point.latitude, 43.6881759);
      expect(points[1].point.longitude, 51.1614135);
      for (final text in ['Дом 14', 'Подъезд 3', 'Этаж 4', 'Квартира 37']) {
        expect(points[1].address, contains(text));
      }
      expect(
        orderTrackingPoints(cached, includeCourier: false).map((p) => p.kind),
        ['pickup', 'recipient'],
      );
      final missing = CustomerOrder.fromJson({
        'id': 'no-coordinates',
        'courier': {'name': 'Pending', 'latitude': 0, 'longitude': 0},
      });
      expect(orderTrackingPoints(missing), isEmpty);
    },
  );

  testWidgets(
    'tracking legend shows distinct icons and translated full addresses',
    (tester) async {
      tester.view.physicalSize = const Size(430, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final controller = YandexMapController();
      addTearDown(controller.dispose);
      for (final lang in ['ru', 'kk', 'en']) {
        appLanguageNotifier.value = lang;
        final points = orderTrackingPoints(trackingPreviewOrder());
        await tester.pumpWidget(
          MaterialApp(
            theme: buildBulkaTheme(),
            home: Scaffold(
              body: SingleChildScrollView(
                child: OrderTrackingMap(points: points, controller: controller),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        for (final point in points) {
          expect(find.text(point.label), findsOneWidget);
          expect(find.text(point.address), findsOneWidget);
        }
        for (final icon in [
          Icons.storefront_rounded,
          Icons.home_rounded,
          Icons.directions_car_rounded,
        ]) {
          expect(find.byIcon(icon), findsOneWidget);
        }
        await tester.tap(find.byIcon(Icons.center_focus_strong_rounded));
        expect(controller.command?.type, 'fit-tracking');
        expect(tester.takeException(), isNull);
      }
    },
  );
}

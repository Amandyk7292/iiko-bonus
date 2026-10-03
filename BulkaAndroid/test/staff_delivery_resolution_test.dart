import 'dart:async';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _ResolutionApi extends StaffApiClient {
  final eventsBus = StreamController<Map<String, dynamic>>.broadcast();
  final decisions = <Map<String, dynamic>>[];
  Completer<dynamic>? review;
  final order = <String, dynamic>{
    'id': 'delivery-ready',
    'number': 100071,
    'amount': 4200,
    'subtotal': 3900,
    'deliveryFee': 300,
    'discount': 0,
    'branch': 'ЖК Дукат',
    'paymentStatus': 'paid',
    'orderStatus': 'ready',
    'kitchenStatus': 'ready',
    'fulfillmentType': 'delivery',
    'orderType': 'delivery',
    'createdAt': '2026-10-03T05:00:00Z',
    'acceptedBy': 'Айжан',
    'items': [
      {'name': 'Круассан', 'quantity': 2},
    ],
    'deliveryResolution': {
      'id': 'resolution-a',
      'status': 'pickup_pending_approval',
      'requestedAt': '2026-10-03T05:40:00Z',
      'pickupTime': '2026-10-03T12:00:00Z',
    },
  };
  @override
  Stream<Map<String, dynamic>> events({String? lastEventId}) =>
      eventsBus.stream;
  @override
  Future<dynamic> request(
    String endpoint, {
    String method = 'GET',
    Object? body,
    bool authenticated = true,
    Map<String, String> headers = const {},
    Map<String, String> query = const {},
  }) async {
    if (method == 'POST') {
      expect(endpoint, '/orders/delivery-ready/delivery-resolution');
      decisions.add(Map<String, dynamic>.from(body as Map));
      if (review != null) return review!.future;
      (order['deliveryResolution'] as Map)['status'] = 'pickup_rejected';
      order['orderStatus'] = 'cancelled';
      order['kitchenStatus'] = 'cancelled';
      order['refundStatus'] = 'processing';
      return {'order': Map<String, dynamic>.of(order)};
    }
    if (method != 'GET') {
      throw StateError('ordinary status change must not be sent');
    }
    return {
      'orders': [Map<String, dynamic>.of(order)],
      'total': 1,
    };
  }
}

void main() {
  test(
    'every unresolved phase blocks ordinary staff actions and matches cashier review roles',
    () {
      for (final status in [
        'pending',
        'pickup_cancelling',
        'cancel_cancelling',
        'pickup_pending_approval',
        'pickup_accepting',
        'pickup_rejecting',
        'cancel_refunding',
      ]) {
        final order = {
          'deliveryResolution': {'status': status},
        };
        expect(staffHasUnresolvedDelivery(order), isTrue);
        expect(
          staffNeedsPickupApproval(order),
          status == 'pickup_pending_approval',
        );
      }
      for (final role in ['owner', 'admin', 'branch_manager', 'cashier']) {
        expect(staffCanReviewDeliveryResolution(role), isTrue);
      }
      for (final role in ['viewer', 'operator', 'editor']) {
        expect(staffCanReviewDeliveryResolution(role), isFalse);
      }
    },
  );
  setUp(
    () => SharedPreferences.setMockInitialValues({'staffKitchenSound': false}),
  );
  Future<void> open(
    WidgetTester tester,
    _ResolutionApi api,
    bool kitchen, {
    String role = 'cashier',
  }) async {
    appLanguageNotifier.value = 'ru';
    tester.view.physicalSize = const Size(390, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: kitchen
            ? Scaffold(
                body: StaffKitchen(api: api, canEdit: true, canCancel: true),
              )
            : StaffOrderDetail(api: api, role: role, order: api.order),
      ),
    );
    await tester.pumpAndSettle();
  }

  for (final kitchen in [false, true]) {
    testWidgets(
      'staff ${kitchen ? 'kitchen' : 'detail'} waits for one cashier pickup decision',
      (tester) async {
        final api = _ResolutionApi()..review = Completer<dynamic>();
        await open(tester, api, kitchen);
        expect(find.text('Замена доставки'), findsOneWidget);
        expect(find.text('Самовывоз подтверждён'), findsNothing);
        expect(find.text('Передать курьеру'), findsNothing);
        expect(find.textContaining('Принял: Айжан'), findsNothing);
        final accept = find.widgetWithText(FilledButton, 'Принять самовывоз');
        await tester.ensureVisible(accept);
        await tester.tap(accept);
        await tester.pump();
        await tester.tap(accept);
        await tester.pump();
        expect(api.decisions, [
          {'action': 'accept', 'resolutionId': 'resolution-a'},
        ]);
        expect(find.text('Самовывоз подтверждён'), findsNothing);
        if (kitchen) {
          expect(find.textContaining('Ожидают принятия: 1'), findsOneWidget);
        }
        api.order['fulfillmentType'] = 'pickup';
        api.order['orderType'] = 'pickup';
        (api.order['deliveryResolution'] as Map)['status'] = 'pickup_accepted';
        api.review!.complete({'order': Map<String, dynamic>.of(api.order)});
        await tester.pumpAndSettle();
        if (kitchen) {
          await tester.tap(find.text('Готовы'));
          await tester.pumpAndSettle();
        }
        expect(find.text('Самовывоз подтверждён'), findsOneWidget);
        expect(find.text('Принять самовывоз'), findsNothing);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        await api.eventsBus.close();
        api.close();
      },
    );
  }
  testWidgets(
    'cashier confirms pickup rejection using the cancellation and refund endpoint',
    (tester) async {
      final api = _ResolutionApi();
      await open(tester, api, false);
      final reject = find.widgetWithText(TextButton, 'Отклонить самовывоз');
      await tester.ensureVisible(reject);
      await tester.tap(reject);
      await tester.pumpAndSettle();
      expect(
        find.text('Заказ будет отменён. Оплата будет возвращена.'),
        findsOneWidget,
      );
      expect(api.decisions, isEmpty);
      await tester.tap(find.widgetWithText(FilledButton, 'Подтвердить'));
      await tester.pumpAndSettle();
      expect(api.decisions, [
        {'action': 'reject', 'resolutionId': 'resolution-a'},
      ]);
      expect(find.text('Самовывоз отклонён'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      await api.eventsBus.close();
      api.close();
    },
  );
  testWidgets('viewer cannot approve a delivery replacement', (tester) async {
    final api = _ResolutionApi();
    await open(tester, api, false, role: 'viewer');
    expect(find.text('Замена доставки'), findsOneWidget);
    expect(find.text('Принять самовывоз'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    await api.eventsBus.close();
    api.close();
  });
  testWidgets(
    'fee verification remains visible in kitchen without a second decision or handoff',
    (tester) async {
      final api = _ResolutionApi();
      (api.order['deliveryResolution'] as Map)['status'] = 'pickup_accepting';
      await open(tester, api, true);
      expect(find.text('Проверяем возврат стоимости доставки'), findsOneWidget);
      expect(find.text('Принять самовывоз'), findsNothing);
      expect(find.text('Отклонить самовывоз'), findsNothing);
      expect(find.text('Передать курьеру'), findsNothing);
      expect(find.textContaining('Ожидают принятия:'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      await api.eventsBus.close();
      api.close();
    },
  );
}

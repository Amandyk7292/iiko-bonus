import 'dart:async';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _KitchenApi extends StaffApiClient {
  final updates = <Map<String, dynamic>>[];
  final eventBus = StreamController<Map<String, dynamic>>.broadcast();
  final Map<String, dynamic> order = {
    'id': 'order-a',
    'number': 100012,
    'branch': 'ЖК Гаухартас',
    'items': [
      {'name': 'Пирог с яблоками', 'quantity': 2},
    ],
    'kitchenStatus': 'queued',
    'fulfillmentType': 'pickup',
    'createdAt': '2026-09-08T08:00:00Z',
  };
  Completer<dynamic>? acceptance;
  @override
  Stream<Map<String, dynamic>> events({String? lastEventId}) => eventBus.stream;
  @override
  Future<dynamic> request(
    String endpoint, {
    String method = 'GET',
    Object? body,
    bool authenticated = true,
    Map<String, String> headers = const {},
    Map<String, String> query = const {},
  }) async {
    if (method == 'PATCH') {
      updates.add(Map<String, dynamic>.from(body as Map));
      if (acceptance != null) return acceptance!.future;
      order['kitchenStatus'] = updates.last['status'];
      return {'order': Map<String, dynamic>.from(order)};
    }
    return {
      'orders': [Map<String, dynamic>.from(order)],
    };
  }
}

void main() {
  setUp(
    () => SharedPreferences.setMockInitialValues({'staffKitchenSound': false}),
  );
  Future<void> open(
    WidgetTester tester,
    _KitchenApi api, {
    bool canEdit = true,
  }) async {
    appLanguageNotifier.value = 'ru';
    tester.view.physicalSize = const Size(390, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: Scaffold(
          body: StaffKitchen(api: api, canEdit: canEdit),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets(
    'native acceptance validates minutes, omits manual checkbox, waits for server',
    (tester) async {
      final api = _KitchenApi()..acceptance = Completer<dynamic>();
      await open(tester, api);
      final accept = find.widgetWithText(FilledButton, 'Принять заказ');
      await tester.ensureVisible(accept);
      await tester.tap(accept);
      await tester.pumpAndSettle();
      expect(find.byType(Checkbox), findsNothing);
      await tester.enterText(find.byType(TextFormField), '0');
      await tester.tap(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.byType(FilledButton),
        ),
      );
      await tester.pump();
      expect(api.updates, isEmpty);
      await tester.enterText(find.byType(TextFormField), '20');
      await tester.tap(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.byType(FilledButton),
        ),
      );
      await tester.pump(const Duration(milliseconds: 400));
      expect(api.updates.single, {
        'status': 'preparing',
        'preparationMinutes': 20,
      });
      expect(find.textContaining('Ожидают принятия: 1'), findsOneWidget);
      api.order['kitchenStatus'] = 'preparing';
      api.acceptance!.complete({'order': Map<String, dynamic>.from(api.order)});
      await tester.pumpAndSettle();
      expect(find.textContaining('Ожидают принятия:'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      await api.eventBus.close();
      api.close();
    },
  );
  testWidgets('read-only staff cannot mutate kitchen orders', (tester) async {
    final api = _KitchenApi();
    await open(tester, api, canEdit: false);
    expect(find.text('Пирог с яблоками'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Принять заказ'), findsNothing);
    expect(api.updates, isEmpty);
    await tester.pumpWidget(const SizedBox());
    await api.eventBus.close();
    api.close();
  });
}

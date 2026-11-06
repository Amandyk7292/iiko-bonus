import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class ToolsApi extends StaffApiClient {
  String? orderQuery;
  int deletes = 0;
  @override
  Future<dynamic> request(
    String endpoint, {
    String method = 'GET',
    Object? body,
    bool authenticated = true,
    Map<String, String> headers = const {},
    Map<String, String> query = const {},
  }) async {
    if (method == 'DELETE') {
      deletes++;
      return {'success': true};
    }
    if (endpoint.startsWith('/staff/pos/devices')) {
      return {
        'devices': deletes > 0
            ? []
            : [
                {'terminalId': 'one', 'name': 'Касса 1', 'online': true},
              ],
      };
    }
    if (endpoint.startsWith('/staff/order-sales-report')) {
      return {
        'report': {
          'revenue': 1500,
          'orders': 2,
          'channels': [
            {'kind': 'delivery', 'orders': 1, 'revenue': 1000},
            {'kind': 'pickup', 'orders': 1, 'revenue': 500},
          ],
        },
      };
    }
    if (endpoint.startsWith('/orders?')) {
      orderQuery = endpoint;
      return {'orders': [], 'total': 0};
    }
    return {};
  }
}

void main() {
  setUp(() => appLanguageNotifier.value = 'ru');
  testWidgets('cashier dates filter server query and open full-period report', (
    tester,
  ) async {
    final api = ToolsApi();
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        theme: staffTheme(),
        home: Scaffold(
          body: StaffOrders(api: api, role: 'cashier'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(Uri.parse(api.orderQuery!).queryParameters['dateFrom'], isNotEmpty);
    await tester.tap(find.text('Вчера'));
    await tester.pumpAndSettle();
    final date = DateTime.now()
        .toUtc()
        .add(const Duration(hours: 5))
        .subtract(const Duration(days: 1));
    expect(
      Uri.parse(api.orderQuery!).queryParameters['dateFrom'],
      date.toIso8601String().substring(0, 10),
    );
    await tester.tap(find.text('Отчёт'));
    await tester.pumpAndSettle();
    expect(find.text('Отчёт по заказам'), findsOneWidget);
    expect(find.text('Доставка'), findsOneWidget);
    expect(find.text('Самовывоз'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets('unlink requires confirmation and refreshes device list', (
    tester,
  ) async {
    final api = ToolsApi();
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        theme: staffTheme(),
        home: CashierPosDevicesScreen(api: api, branchName: 'Филиал'),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Отвязать'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Отмена'));
    await tester.pumpAndSettle();
    expect(api.deletes, 0);
    await tester.tap(find.text('Отвязать'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Отвязать').last);
    await tester.pumpAndSettle();
    expect(api.deletes, 1);
    expect(find.text('Касса 1'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}

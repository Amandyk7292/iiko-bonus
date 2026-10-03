import 'dart:async';
import 'dart:convert';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

Map<String, dynamic> pendingOrder() => {
  'id': 'saved-order',
  'number': 12,
  'paymentStatus': 'paid',
  'orderStatus': 'ready',
  'fulfillmentType': 'delivery',
  'deliveryStatus': 'unassigned',
  'branchId': 'origin',
  'deliveryResolution': {
    'id': 'resolution',
    'status': 'pending',
    'reason': 'courier_not_found',
    'requestedAt': '2026-10-03T04:00:00Z',
  },
};
http.Response response(Object value, [int status = 200]) => http.Response(
  jsonEncode(value),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);
Map<String, dynamic> options() => {
  'branch': {'id': 'origin', 'name': 'Bulka 16'},
  'timezoneOffsetMinutes': 300,
  'serverTime': '2026-10-03T04:00:00Z',
  'expiresAt': '2026-10-04T04:00:00Z',
  'slots': [
    {
      'startsAt': '2026-10-03T05:00:00Z',
      'endsAt': '2026-10-03T05:30:00Z',
      'remaining': 3,
    },
  ],
};

void main() {
  testWidgets('failed cancellation during initial load permits pickup retry', (
    tester,
  ) async {
    appLanguageNotifier.value = 'ru';
    final firstRead = Completer<http.Response>();
    var reads = 0;
    final api = BulkaApiClient(
      client: MockClient((request) async {
        if (request.method == 'POST') {
          return response({
            'success': false,
            'message': 'temporary failure',
          }, 503);
        }
        if (request.url.path.endsWith('/delivery-resolution')) {
          reads++;
          if (reads == 1) return firstRead.future;
          return response({
            'success': true,
            'order': pendingOrder(),
            'options': options(),
          });
        }
        return response({'success': true, 'order': pendingOrder()});
      }),
    );
    final liveOrder = ValueNotifier<CustomerOrder?>(
      CustomerOrder.fromJson(pendingOrder()),
    );
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: Scaffold(
          body: DeliveryResolutionDialog(api: api, order: liveOrder),
        ),
      ),
    );
    await tester.pump();
    expect(reads, 1);
    await tester.tap(find.byKey(const ValueKey('delivery-resolution-cancel')));
    await tester.pump();
    await tester.tap(
      find.byKey(const ValueKey('delivery-resolution-confirm-cancel')),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    firstRead.complete(
      response({
        'success': true,
        'order': pendingOrder(),
        'options': options(),
      }),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Назад'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('delivery-resolution-pickup')));
    await tester.pump(const Duration(milliseconds: 300));
    final spinnerStillVisible = find
        .byType(CircularProgressIndicator)
        .evaluate()
        .isNotEmpty;
    await tester.pumpWidget(const SizedBox.shrink());
    liveOrder.dispose();
    api.dispose();
    expect(
      reads,
      2,
      reason: 'Pickup must refresh its slots after failed cancellation',
    );
    expect(
      spinnerStillVisible,
      false,
      reason: 'An obsolete initial load must not lock recovery',
    );
  });
}

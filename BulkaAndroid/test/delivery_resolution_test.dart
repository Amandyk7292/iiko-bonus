import 'dart:async';
import 'dart:convert';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

Map<String, dynamic> orderJson([String status = 'pending']) => {
  'id': 'saved-order',
  'number': 12,
  'paymentStatus': 'paid',
  'orderStatus': status == 'cancelled' ? 'cancelled' : 'ready',
  'fulfillmentType': 'delivery',
  'deliveryStatus': 'unassigned',
  'branch': 'Bulka 16',
  'branchId': 'origin',
  'deliveryResolution': {
    'id': 'resolution',
    'status': status,
    'reason': 'courier_not_found',
    'requestedAt': '2026-10-03T04:00:00Z',
  },
};

Map<String, dynamic> optionsJson() => {
  'branch': {'id': 'origin', 'name': 'Bulka 16', 'address': '16 мкр, 12'},
  'timezoneOffsetMinutes': 300,
  'serverTime': '2026-10-03T04:00:00Z',
  'expiresAt': '2026-10-04T04:00:00Z',
  'slots': [
    {
      'startsAt': '2026-10-03T05:00:00Z',
      'endsAt': '2026-10-03T05:30:00Z',
      'capacity': 5,
      'remaining': 3,
    },
    {
      'startsAt': '2026-10-04T03:30:00Z',
      'endsAt': '2026-10-04T04:00:00Z',
      'capacity': 5,
      'remaining': 2,
    },
  ],
};

http.Response response(Object value, [int status = 200]) => http.Response(
  jsonEncode(value),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

Widget harness(
  DeliveryResolutionCoordinator coordinator, {
  String language = 'ru',
  double textScale = 1,
  Widget? home,
}) => MaterialApp(
  theme: buildBulkaTheme(),
  navigatorObservers: [coordinator],
  locale: Locale(language),
  supportedLocales: const [Locale('ru'), Locale('kk')],
  localizationsDelegates: const [
    GlobalMaterialLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
  ],
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(
      context,
    ).copyWith(textScaler: TextScaler.linear(textScale)),
    child: child!,
  ),
  home: home ?? const Scaffold(body: Text('Home')),
);

Future<void> tap(WidgetTester tester, String key) async {
  final finder = find.byKey(ValueKey(key));
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

class _SummaryApi extends BulkaApiClient {
  @override
  Stream<Map<String, dynamic>> get customerEvents => const Stream.empty();
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    appLanguageNotifier.value = 'ru';
  });

  test('cached decision is preserved; eligibility follows server status', () {
    final order = CustomerOrder.fromJson(orderJson());
    final cached = CustomerOrder.fromJson(order.toJson());
    expect(cached.needsDeliveryDecision, true);
    expect(cached.deliveryResolution?.id, 'resolution');
    expect(cached.canCancel, false);
    for (final status in [
      'pickup_cancelling',
      'cancel_cancelling',
      'pickup_pending_approval',
      'pickup_accepting',
      'pickup_rejecting',
      'cancel_refunding',
      'pickup_accepted',
      'pickup_rejected',
      'cancelled',
      'delivery_resumed',
    ]) {
      expect(
        CustomerOrder.fromJson(orderJson(status)).needsDeliveryDecision,
        false,
      );
    }
    expect(
      CustomerOrder.fromJson({
        ...orderJson(),
        'paymentStatus': 'refunded',
      }).needsDeliveryDecision,
      false,
    );
  });

  test(
    'slots stay in server window and use location timezone including midnight',
    () {
      final json = optionsJson();
      json['slots'] = [
        ...json['slots'] as List,
        ...<Map<String, Object>>[
          {
            'startsAt': '2026-10-03T03:59:00Z',
            'endsAt': '2026-10-03T04:30:00Z',
            'remaining': 1,
          },
          {
            'startsAt': '2026-10-04T04:01:00Z',
            'endsAt': '2026-10-04T04:30:00Z',
            'remaining': 1,
          },
          {
            'startsAt': '2026-10-03T05:30:00Z',
            'endsAt': '2026-10-03T06:00:00Z',
            'remaining': 0,
          },
        ],
      ];
      final options = DeliveryResolutionOptions.fromJson(json);
      expect(options.branchId, 'origin');
      expect(options.slots, hasLength(2));
      expect(options.slots.first.branchStartsAt.hour, 10);
      expect(options.slots.last.branchStartsAt.day, 4);
      expect(options.slots.last.branchStartsAt.hour, 8);
      final allDay = DeliveryResolutionOptions.fromJson({
        ...optionsJson(),
        'slots': [
          {
            'startsAt': '2026-10-03T19:30:00Z',
            'endsAt': '2026-10-03T20:00:00Z',
            'remaining': 1,
          },
        ],
      });
      expect(allDay.slots.single.branchStartsAt.day, 4);
      expect(allDay.slots.single.branchStartsAt.hour, 0);
    },
  );

  test(
    'API retains order and sends one UTC choice on original order endpoint',
    () async {
      final requests = <http.Request>[];
      final api = BulkaApiClient(
        client: MockClient((request) async {
          requests.add(request);
          return response({
            'success': true,
            'order': orderJson('pickup_pending_approval'),
            'options': optionsJson(),
          });
        }),
      );
      final options = await api.getDeliveryResolution('saved order');
      expect(options.options?.branchId, 'origin');
      final result = await api.resolveDelivery(
        'saved order',
        action: 'pickup',
        pickupTime: DateTime.parse('2026-10-03T10:00:00+05:00'),
      );
      expect(result.id, 'saved-order');
      expect(
        result.usesDelivery,
        true,
        reason: 'Only cashier approval changes fulfillment',
      );
      expect(
        requests.last.url.path,
        '/api/customer/orders/saved%20order/delivery-resolution',
      );
      expect(jsonDecode(requests.last.body), {
        'action': 'pickup',
        'pickupTime': '2026-10-03T05:00:00.000Z',
      });
      await api.resolveDelivery('saved order', action: 'cancel');
      expect(jsonDecode(requests.last.body), {'action': 'cancel'});
      api.dispose();
    },
  );

  test('push opens existing order and waits for customer authentication', () {
    final target = resolveNotificationPayload({
      'type': 'delivery_resolution',
      'orderId': 'saved-order',
      'deepLink': 'bulka://orders/saved-order',
    });
    expect(target.kind, NotificationTargetKind.order);
    expect(target.resourceId, 'saved-order');
    expect(notificationTargetRequiresCustomerAuth(target.kind), true);
  });

  testWidgets('auto dialog is unique and conversion awaits cashier approval', (
    tester,
  ) async {
    var posts = 0;
    final changed = <CustomerOrder>[];
    final api = BulkaApiClient(
      client: MockClient((request) async {
        if (request.method == 'POST') {
          posts++;
          expect(jsonDecode(request.body), {
            'action': 'pickup',
            'pickupTime': '2026-10-03T05:00:00.000Z',
          });
          return response({
            'success': true,
            'order': orderJson('pickup_pending_approval'),
          });
        }
        return response({
          'success': true,
          'order': orderJson(),
          'options': optionsJson(),
        });
      }),
    );
    final coordinator = DeliveryResolutionCoordinator(
      api: api,
      canPresent: () => true,
      onOrderChanged: changed.add,
    );
    await tester.pumpWidget(harness(coordinator));
    for (var i = 0; i < 3; i++) {
      coordinator.updateOrders([CustomerOrder.fromJson(orderJson())]);
    }
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('delivery-resolution-dialog')),
      findsOneWidget,
    );
    await tap(tester, 'delivery-resolution-pickup');
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is Semantics && widget.properties.label == 'Bulka 16',
      ),
      findsOneWidget,
    );
    expect(find.text('По времени точки · UTC+5:00'), findsOneWidget);
    final confirm = tester.widget<FilledButton>(
      find.byKey(const ValueKey('delivery-resolution-confirm-pickup')),
    );
    expect(confirm.onPressed, isNull);
    await tap(tester, 'delivery-slot-2026-10-03T05:00:00.000Z');
    await tap(tester, 'delivery-resolution-confirm-pickup');
    expect(posts, 1);
    expect(
      changed.single.deliveryResolution?.status,
      'pickup_pending_approval',
    );
    expect(
      customerOrderStatusLabel(changed.single),
      'Самовывоз ждёт подтверждения точки',
    );
    expect(
      find.byKey(const ValueKey('delivery-resolution-dialog')),
      findsNothing,
    );
    await tester.pumpWidget(const SizedBox.shrink());
    coordinator.dispose();
    api.dispose();
  });

  testWidgets(
    'cancel requires explicit confirmation and preserves refund response',
    (tester) async {
      var posts = 0;
      CustomerOrder? changed;
      final api = BulkaApiClient(
        client: MockClient((request) async {
          if (request.method == 'POST') {
            posts++;
            expect(jsonDecode(request.body), {'action': 'cancel'});
            return response({
              'success': true,
              'order': {...orderJson('cancelled'), 'refundStatus': 'pending'},
            });
          }
          return response({
            'success': true,
            'order': orderJson(),
            'options': optionsJson(),
          });
        }),
      );
      final coordinator = DeliveryResolutionCoordinator(
        api: api,
        canPresent: () => true,
        onOrderChanged: (value) => changed = value,
      );
      await tester.pumpWidget(harness(coordinator));
      coordinator.updateOrders([CustomerOrder.fromJson(orderJson())]);
      await tester.pumpAndSettle();
      await tap(tester, 'delivery-resolution-cancel');
      expect(posts, 0);
      await tap(tester, 'delivery-resolution-confirm-cancel');
      expect(posts, 1);
      expect(changed?.refundStatus, 'pending');
      expect(find.byType(DeliveryResolutionDialog), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      coordinator.dispose();
      api.dispose();
    },
  );

  testWidgets(
    'no second overlay over an existing dialog; opens after it closes',
    (tester) async {
      final navKey = GlobalKey<NavigatorState>();
      final api = BulkaApiClient(
        client: MockClient(
          (_) async => response({
            'success': true,
            'order': orderJson(),
            'options': optionsJson(),
          }),
        ),
      );
      final coordinator = DeliveryResolutionCoordinator(
        api: api,
        canPresent: () => true,
        onOrderChanged: (_) {},
      );
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: navKey,
          theme: buildBulkaTheme(),
          navigatorObservers: [coordinator],
          home: const Scaffold(body: Text('Home')),
        ),
      );
      unawaited(
        showDialog<void>(
          context: navKey.currentContext!,
          builder: (_) => const AlertDialog(content: Text('Other dialog')),
        ),
      );
      await tester.pumpAndSettle();
      coordinator.updateOrders([CustomerOrder.fromJson(orderJson())]);
      await tester.pumpAndSettle();
      expect(find.byType(DeliveryResolutionDialog), findsNothing);
      navKey.currentState!.pop();
      await tester.pumpAndSettle();
      expect(find.byType(DeliveryResolutionDialog), findsOneWidget);
      coordinator.clear();
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox.shrink());
      coordinator.dispose();
      api.dispose();
    },
  );

  testWidgets(
    'courier clears pending dialog and late options cannot reopen it',
    (tester) async {
      final gate = Completer<http.Response>();
      final api = BulkaApiClient(client: MockClient((_) => gate.future));
      final coordinator = DeliveryResolutionCoordinator(
        api: api,
        canPresent: () => true,
        onOrderChanged: (_) {},
      );
      await tester.pumpWidget(harness(coordinator));
      coordinator.updateOrders([CustomerOrder.fromJson(orderJson())]);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byType(DeliveryResolutionDialog), findsOneWidget);
      coordinator.updateOrders([
        CustomerOrder.fromJson({
          ...orderJson('delivery_resumed'),
          'deliveryStatus': 'assigned',
        }),
      ]);
      await tester.pumpAndSettle();
      gate.complete(
        response({
          'success': true,
          'order': orderJson(),
          'options': optionsJson(),
        }),
      );
      await tester.pumpAndSettle();
      expect(find.byType(DeliveryResolutionDialog), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      coordinator.dispose();
      api.dispose();
    },
  );

  testWidgets(
    'options error retries; submit conflict refreshes authoritative courier',
    (tester) async {
      var reads = 0;
      final api = BulkaApiClient(
        client: MockClient((request) async {
          if (request.method == 'POST') {
            return response({
              'success': false,
              'code': 'DELIVERY_RESOLUTION_CONFLICT',
            }, 409);
          }
          if (request.url.path.endsWith('/saved-order')) {
            return response({
              'success': true,
              'order': {
                ...orderJson('delivery_resumed'),
                'deliveryStatus': 'assigned',
              },
            });
          }
          if (++reads <= 2) return response({}, 503);
          return response({
            'success': true,
            'order': orderJson(),
            'options': optionsJson(),
          });
        }),
      );
      final coordinator = DeliveryResolutionCoordinator(
        api: api,
        canPresent: () => true,
        onOrderChanged: (_) {},
      );
      await tester.pumpWidget(harness(coordinator));
      coordinator.updateOrders([CustomerOrder.fromJson(orderJson())]);
      await tester.pumpAndSettle();
      await tap(tester, 'delivery-resolution-pickup');
      expect(
        find.byKey(const ValueKey('delivery-resolution-error')),
        findsOneWidget,
      );
      await tap(tester, 'delivery-resolution-retry');
      await tap(tester, 'delivery-slot-2026-10-03T05:00:00.000Z');
      await tap(tester, 'delivery-resolution-confirm-pickup');
      expect(find.byType(DeliveryResolutionDialog), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      coordinator.dispose();
      api.dispose();
    },
  );

  testWidgets(
    'unauthenticated/staff/paused app gating leaves pending on server',
    (tester) async {
      var enabled = false;
      var reads = 0;
      final api = BulkaApiClient(
        client: MockClient((_) async {
          reads++;
          return response({
            'success': true,
            'order': orderJson(),
            'options': optionsJson(),
          });
        }),
      );
      final coordinator = DeliveryResolutionCoordinator(
        api: api,
        canPresent: () => enabled,
        onOrderChanged: (_) {},
      );
      await tester.pumpWidget(harness(coordinator));
      coordinator.updateOrders([CustomerOrder.fromJson(orderJson())]);
      await tester.pumpAndSettle();
      expect(reads, 0);
      expect(find.byType(DeliveryResolutionDialog), findsNothing);
      enabled = true;
      coordinator.updateOrders([CustomerOrder.fromJson(orderJson())]);
      await tester.pumpAndSettle();
      expect(find.byType(DeliveryResolutionDialog), findsOneWidget);
      coordinator.clear();
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox.shrink());
      coordinator.dispose();
      api.dispose();
    },
  );

  testWidgets(
    'same pending refresh expires selected slot; courier close returns focus',
    (tester) async {
      var available = true;
      final focus = FocusNode();
      final api = BulkaApiClient(
        client: MockClient(
          (_) async => response({
            'success': true,
            'order': orderJson(),
            'options': {...optionsJson(), if (!available) 'slots': []},
          }),
        ),
      );
      final coordinator = DeliveryResolutionCoordinator(
        api: api,
        canPresent: () => true,
        onOrderChanged: (_) {},
      );
      await tester.pumpWidget(
        harness(
          coordinator,
          home: Scaffold(
            body: FilledButton(
              focusNode: focus,
              onPressed: () {},
              child: const Text('Orders'),
            ),
          ),
        ),
      );
      focus.requestFocus();
      await tester.pumpAndSettle();
      expect(focus.hasFocus, true);
      coordinator.updateOrders([CustomerOrder.fromJson(orderJson())]);
      await tester.pumpAndSettle();
      await tap(tester, 'delivery-resolution-pickup');
      await tap(tester, 'delivery-slot-2026-10-03T05:00:00.000Z');
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('delivery-resolution-confirm-pickup')),
            )
            .onPressed,
        isNotNull,
      );
      available = false;
      coordinator.updateOrders([CustomerOrder.fromJson(orderJson())]);
      await tester.pumpAndSettle();
      expect(find.byType(DeliveryResolutionDialog), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('delivery-resolution-confirm-pickup')),
            )
            .onPressed,
        isNull,
      );
      coordinator.updateOrders([
        CustomerOrder.fromJson(orderJson('delivery_resumed')),
      ]);
      await tester.pumpAndSettle();
      expect(find.byType(DeliveryResolutionDialog), findsNothing);
      expect(focus.hasFocus, true);
      await tester.pumpWidget(const SizedBox.shrink());
      coordinator.dispose();
      api.dispose();
      focus.dispose();
    },
  );

  testWidgets(
    'cashier rejection preserves reason and pending refund on saved summary',
    (tester) async {
      final api = _SummaryApi();
      appLanguageNotifier.value = 'kk';
      final order = CustomerOrder.fromJson({
        ...orderJson('pickup_rejecting'),
        'orderStatus': 'cancelled',
        'refundStatus': 'pending',
        'amount': 3000,
        'cancellationReason': 'Самовывоз взамен доставки отклонён точкой',
      });
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: OrderDetailsScreen(
            api: api,
            initialOrder: order,
            onRepeat: (_) async {},
            onOrderChanged: (_) {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.text('Орын жеткізудің орнына алып кетуден бас тартты.'),
        findsOneWidget,
      );
      expect(find.text('refund_stage_processing'.tr), findsOneWidget);
      expect(order.hasDeliveryResolutionInProgress, true);
      expect(order.needsDeliveryDecision, false);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      api.dispose();
    },
  );

  testWidgets(
    'keyboard activates choices; Escape cannot silently dismiss the decision',
    (tester) async {
      final api = BulkaApiClient(
        client: MockClient(
          (_) async => response({
            'success': true,
            'order': orderJson(),
            'options': optionsJson(),
          }),
        ),
      );
      final coordinator = DeliveryResolutionCoordinator(
        api: api,
        canPresent: () => true,
        onOrderChanged: (_) {},
      );
      await tester.pumpWidget(harness(coordinator));
      coordinator.updateOrders([CustomerOrder.fromJson(orderJson())]);
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.byType(DeliveryResolutionDialog), findsOneWidget);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('delivery-resolution-slots')),
        findsOneWidget,
      );
      coordinator.clear();
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox.shrink());
      coordinator.dispose();
      api.dispose();
    },
  );

  testWidgets(
    'loading disables pickup submit; empty slots preserve cancellation',
    (tester) async {
      final gate = Completer<http.Response>();
      final api = BulkaApiClient(client: MockClient((_) => gate.future));
      final coordinator = DeliveryResolutionCoordinator(
        api: api,
        canPresent: () => true,
        onOrderChanged: (_) {},
      );
      await tester.pumpWidget(harness(coordinator));
      coordinator.updateOrders([CustomerOrder.fromJson(orderJson())]);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(
        find.byKey(const ValueKey('delivery-resolution-pickup')),
      );
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('delivery-resolution-confirm-pickup')),
            )
            .onPressed,
        isNull,
      );
      gate.complete(
        response({
          'success': true,
          'order': orderJson(),
          'options': {...optionsJson(), 'slots': []},
        }),
      );
      await tester.pumpAndSettle();
      expect(find.text('Доступного времени получения нет.'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('delivery-resolution-confirm-pickup')),
            )
            .onPressed,
        isNull,
      );
      await tester.tap(find.text('Назад'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<OutlinedButton>(
              find.byKey(const ValueKey('delivery-resolution-cancel')),
            )
            .onPressed,
        isNotNull,
      );
      coordinator.clear();
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox.shrink());
      coordinator.dispose();
      api.dispose();
    },
  );

  testWidgets(
    'invalid slot keeps order pending and requires refreshed selection',
    (tester) async {
      var posts = 0;
      final api = BulkaApiClient(
        client: MockClient((request) async {
          if (request.method == 'POST') {
            posts++;
            return response({
              'success': false,
              'code': 'DELIVERY_RESOLUTION_INVALID_SLOT',
            }, 409);
          }
          return response({
            'success': true,
            'order': orderJson(),
            'options': optionsJson(),
          });
        }),
      );
      final coordinator = DeliveryResolutionCoordinator(
        api: api,
        canPresent: () => true,
        onOrderChanged: (_) =>
            fail('An unsuccessful choice must not change order'),
      );
      await tester.pumpWidget(harness(coordinator));
      coordinator.updateOrders([CustomerOrder.fromJson(orderJson())]);
      await tester.pumpAndSettle();
      await tap(tester, 'delivery-resolution-pickup');
      await tap(tester, 'delivery-slot-2026-10-03T05:00:00.000Z');
      await tap(tester, 'delivery-resolution-confirm-pickup');
      expect(posts, 1);
      expect(
        find.text('Время уже недоступно. Выберите другое.'),
        findsOneWidget,
      );
      expect(coordinator.hasPendingDecision, true);
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('delivery-resolution-confirm-pickup')),
            )
            .onPressed,
        isNull,
      );
      await tap(tester, 'delivery-resolution-retry');
      expect(
        find.byKey(const ValueKey('delivery-resolution-slots')),
        findsOneWidget,
      );
      coordinator.clear();
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox.shrink());
      coordinator.dispose();
      api.dispose();
    },
  );

  for (final language in ['ru', 'kk']) {
    testWidgets(
      '$language 320px double text keeps choices and schedule accessible',
      (tester) async {
        tester.view.physicalSize = const Size(320, 800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        appLanguageNotifier.value = language;
        final api = BulkaApiClient(
          client: MockClient(
            (_) async => response({
              'success': true,
              'order': orderJson(),
              'options': optionsJson(),
            }),
          ),
        );
        final coordinator = DeliveryResolutionCoordinator(
          api: api,
          canPresent: () => true,
          onOrderChanged: (_) {},
        );
        await tester.pumpWidget(
          harness(coordinator, language: language, textScale: 2),
        );
        coordinator.updateOrders([CustomerOrder.fromJson(orderJson())]);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final action = find.byKey(const ValueKey('delivery-resolution-pickup'));
        expect(tester.getSize(action).height, greaterThanOrEqualTo(48));
        await tap(tester, 'delivery-resolution-pickup');
        expect(tester.takeException(), isNull);
        await tap(tester, 'delivery-slot-2026-10-03T05:00:00.000Z');
        final confirm = find.byKey(
          const ValueKey('delivery-resolution-confirm-pickup'),
        );
        await tester.ensureVisible(confirm);
        expect(tester.getSize(confirm).height, greaterThanOrEqualTo(48));
        coordinator.clear();
        await tester.pumpAndSettle();
        await tester.pumpWidget(const SizedBox.shrink());
        coordinator.dispose();
        api.dispose();
      },
    );
  }
}

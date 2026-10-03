import 'dart:async';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

const _bunEvents = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];
const _cakeEvent = '33333333-3333-4333-8333-333333333333';
Map<String, dynamic> _production(
  String date, {
  num quantity = 25,
  bool enabled = true,
  String reasonCode = 'IIKO_PRODUCTION_PRODUCT_UNMAPPED',
  List<Map<String, dynamic>> acts = const [],
}) => {
  'date': date,
  'branch': {'id': 'assigned', 'name': 'Bulka 16', 'address': '16 мкр, 12'},
  'enabled': enabled,
  'unavailableReason': enabled ? null : 'iiko не настроен',
  'products': quantity == 0
      ? []
      : [
          {
            'productId': 'bun',
            'productName': 'Булочка',
            'unit': 'шт',
            'quantity': quantity,
            'eventIds': _bunEvents,
            'eligible': true,
          },
          {
            'productId': 'cake',
            'productName': 'Торт',
            'unit': 'кг',
            'quantity': 1.125,
            'eventIds': [_cakeEvent],
            'eligible': true,
          },
          {
            'productId': 'custom',
            'productName': 'Свой десерт',
            'unit': 'шт',
            'quantity': 3,
            'eventIds': ['44444444-4444-4444-8444-444444444444'],
            'eligible': false,
            'reason': 'Товар не связан с iiko',
            'reasonCode': reasonCode,
          },
        ],
  'acts': acts,
};

class ReportApi extends StaffApiClient {
  final requests = <String>[];
  final changes = StreamController<Map<String, dynamic>>.broadcast();
  Object? resetBody;
  final productionBodies = <Map<String, dynamic>>[];
  num productionQuantity = 25;
  bool productionEnabled = true, productionError = false, cleared = false;
  String actStatus = 'created';
  String productReasonCode = 'IIKO_PRODUCTION_PRODUCT_UNMAPPED';
  Object? sendError;
  Completer<Map<String, dynamic>>? sendGate;
  List<Map<String, dynamic>> acts = [];
  @override
  Stream<Map<String, dynamic>> events({String? lastEventId}) => changes.stream;
  @override
  void close() {
    unawaited(changes.close());
    super.close();
  }

  @override
  Future<dynamic> request(
    String endpoint, {
    String method = 'GET',
    Object? body,
    bool authenticated = true,
    Map<String, String> headers = const {},
    Map<String, String> query = const {},
  }) async {
    requests.add(endpoint);
    if (endpoint.startsWith('/staff/reports/production')) {
      if (method == 'POST') {
        final payload = Map<String, dynamic>.from(body as Map);
        productionBodies.add(payload);
        if (sendError != null) throw sendError!;
        if (sendGate != null) return sendGate!.future;
        final act = {
          'id': payload['requestId'],
          'status': actStatus,
          'date': payload['date'],
          'eventIds': payload['eventIds'],
          'documentNumber': actStatus == 'created' ? 'A-17' : null,
          'requestedDocumentNumber': 'BLK-${payload['requestId']}',
          'error': actStatus == 'failed' ? 'iiko отклонил документ' : null,
        };
        acts = [act];
        if (actStatus != 'failed') productionQuantity = 0;
        return {'act': act};
      }
      if (productionError) {
        throw const StaffApiException(503, 'UNAVAILABLE', 'Нет связи');
      }
      return _production(
        endpoint.split('date=').last,
        quantity: productionQuantity,
        enabled: productionEnabled,
        reasonCode: productReasonCode,
        acts: acts,
      );
    }
    if (endpoint == '/staff/reports/display-stock/reset') {
      resetBody = body;
      productionQuantity = 0;
      cleared = true;
      return {
        'products': <Object>[],
        'totals': <Object>[],
        'events': <Object>[],
        'eventCount': 0,
        'hasMore': false,
        'resetAt': '2026-09-12T18:00:00Z',
      };
    }
    if (cleared) {
      return {'products': [], 'totals': [], 'events': [], 'eventCount': 0};
    }
    return {
      'products': [
        {
          'product_id': 'bun',
          'product_name': 'Булочка',
          'unit': 'шт',
          'added': 25,
        },
        {
          'product_id': 'cake',
          'product_name': 'Торт',
          'unit': 'кг',
          'added': 1.125,
        },
      ],
      'totals': [
        {'unit': 'шт', 'added': 25},
        {'unit': 'кг', 'added': 1.125},
      ],
      'events': [],
      'hasMore': false,
      'trackingStartedAt': '2026-09-12T06:00:00Z',
    };
  }
}

class PagedReportApi extends StaffApiClient {
  final requests = <String>[];
  final changes = StreamController<Map<String, dynamic>>.broadcast();
  int eventCount = 200;
  @override
  Stream<Map<String, dynamic>> events({String? lastEventId}) => changes.stream;
  @override
  void close() {
    unawaited(changes.close());
    super.close();
  }

  @override
  Future<dynamic> request(
    String endpoint, {
    String method = 'GET',
    Object? body,
    bool authenticated = true,
    Map<String, String> headers = const {},
    Map<String, String> query = const {},
  }) async {
    requests.add(endpoint);
    if (endpoint.startsWith('/staff/reports/production')) {
      return _production(endpoint.split('date=').last, quantity: 10);
    }
    final offset = int.parse(
      RegExp(r'offset=(\d+)').firstMatch(endpoint)!.group(1)!,
    );
    final count = (eventCount - offset).clamp(0, 100);
    return {
      'products': [
        {
          'product_id': 'bun',
          'product_name': 'Булочка',
          'unit': 'шт',
          'added': 10,
          'correction_increase': 1,
          'correction_decrease': 0,
          'recount_increase': 0,
          'recount_decrease': 0,
          'initial_quantity': 0,
        },
      ],
      'totals': [
        {'unit': 'шт', 'added': 10},
      ],
      'events': List.generate(count, (index) {
        final number = offset + index;
        return {
          'id': 'event-$number',
          'product_id': 'bun',
          'product_name': 'Событие $number',
          'unit': 'шт',
          'before_quantity': number,
          'after_quantity': number + 1,
          'delta': 1,
          'source': 'cashier',
          'reason': number.isEven ? 'receipt' : 'correction',
          'created_at':
              '2026-09-12T08:${(number ~/ 60).toString().padLeft(2, '0')}:${(number % 60).toString().padLeft(2, '0')}Z',
        };
      }),
      'eventCount': eventCount,
      'hasMore': offset + count < eventCount,
      'trackingStartedAt': '2026-09-12T06:00:00Z',
    };
  }
}

class GatedProductionApi extends ReportApi {
  final first = Completer<Map<String, dynamic>>();
  bool waiting = true;
  @override
  Future<dynamic> request(
    String endpoint, {
    String method = 'GET',
    Object? body,
    bool authenticated = true,
    Map<String, String> headers = const {},
    Map<String, String> query = const {},
  }) async {
    if (method == 'GET' &&
        endpoint.startsWith('/staff/reports/production') &&
        waiting) {
      waiting = false;
      requests.add(endpoint);
      return first.future;
    }
    return super.request(
      endpoint,
      method: method,
      body: body,
      authenticated: authenticated,
      headers: headers,
      query: query,
    );
  }
}

Future<void> _mountReports(WidgetTester tester, ReportApi api) async {
  api.branchId = 'assigned';
  await tester.pumpWidget(
    MaterialApp(
      theme: buildBulkaTheme(),
      home: Scaffold(body: CashierReports(api: api)),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _send(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('production-send')));
  await tester.pumpAndSettle();
  await tester.ensureVisible(find.byKey(const ValueKey('production-confirm')));
  await tester.tap(find.byKey(const ValueKey('production-confirm')));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'keyboard review closes with Escape and returns focus without sending',
    (tester) async {
      appLanguageNotifier.value = 'ru';
      final api = ReportApi();
      addTearDown(api.close);
      await _mountReports(tester, api);
      await tester.tap(find.byKey(const ValueKey('production-select:bun:шт')));
      await tester.pump();
      final label = find.descendant(
        of: find.byKey(const ValueKey('production-send')),
        matching: find.byType(Text),
      );
      final focus = Focus.of(tester.element(label));
      focus.requestFocus();
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(find.text('Создать акт'), findsOneWidget);
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.text('Создать акт'), findsNothing);
      expect(focus.hasFocus, true);
      expect(api.productionBodies, isEmpty);
    },
  );

  testWidgets('late production response cannot replace a changed report date', (
    tester,
  ) async {
    appLanguageNotifier.value = 'ru';
    final api = GatedProductionApi()..branchId = 'assigned';
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: Scaffold(body: CashierReports(api: api)),
      ),
    );
    await tester.pump();
    await tester.tap(find.byIcon(Icons.calendar_month_outlined));
    await tester.pump(const Duration(milliseconds: 400));
    Navigator.of(
      tester.element(find.byType(DatePickerDialog)),
    ).pop(DateTime(2026, 10, 2));
    await tester.pumpAndSettle();
    api.first.complete(_production('2026-10-03', quantity: 999));
    await tester.pumpAndSettle();
    expect(find.text('02.10.2026'), findsOneWidget);
    expect(find.text('+25 шт'), findsOneWidget);
    expect(find.text('+999 шт'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  test(
    'production model preserves fractional units and rejects incomplete rows',
    () {
      final report = CashierProductionReport(_production('2026-10-03'));
      expect(report.products[1].quantity, 1.125);
      expect(report.products[1].unit, 'кг');
      expect(report.products[2].selectable, false);
      for (final quantity in [null, -1, 0, double.infinity, double.nan]) {
        expect(
          CashierProductionProduct({
            'productId': 'bun',
            'unit': 'шт',
            'quantity': quantity,
            'eligible': true,
            'eventIds': _bunEvents,
          }).selectable,
          false,
        );
      }
      expect(
        CashierProductionProduct({
          'productId': 'bun',
          'quantity': 5,
          'eligible': true,
          'eventIds': [],
        }).selectable,
        false,
      );
    },
  );

  testWidgets(
    'selected products review branch and date, submit only authoritative event IDs',
    (tester) async {
      appLanguageNotifier.value = 'ru';
      final api = ReportApi();
      addTearDown(api.close);
      await _mountReports(tester, api);
      expect(find.text('История изменений'), findsOneWidget);
      expect(
        find.textContaining('Только добавления формируют акт'),
        findsNothing,
      );
      final button = tester.widget<FilledButton>(
        find.byKey(const ValueKey('production-send')),
      );
      expect(button.onPressed, isNull);
      await tester.tap(find.byKey(const ValueKey('production-select-all')));
      await tester.pump();
      expect(find.textContaining('Выбрано: 2'), findsOneWidget);
      expect(find.text('Выбрано: 2 · 25 шт · 1.125 кг'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('production-send')));
      await tester.pumpAndSettle();
      expect(find.text('Создать акт'), findsOneWidget);
      expect(
        find.byWidgetPredicate(
          (widget) =>
              widget is Semantics && widget.properties.label == 'Bulka 16',
        ),
        findsOneWidget,
      );
      expect(api.productionBodies, isEmpty);
      await tester.tap(find.byKey(const ValueKey('production-confirm')));
      await tester.pumpAndSettle();
      expect(api.productionBodies, hasLength(1));
      final body = api.productionBodies.single;
      expect(body.keys.toSet(), {'requestId', 'date', 'eventIds'});
      expect(body['requestId'], matches(RegExp(r'^[a-f0-9-]{36}$')));
      expect(body['eventIds'], [..._bunEvents, _cakeEvent]);
      expect(find.text('Создан'), findsOneWidget);
      expect(find.text('№ A-17'), findsOneWidget);
      expect(find.textContaining('Выбрано:'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'uncertain act uses server allocation and never offers another send',
    (tester) async {
      appLanguageNotifier.value = 'ru';
      final api = ReportApi()..actStatus = 'unknown';
      addTearDown(api.close);
      await _mountReports(tester, api);
      await tester.tap(find.byKey(const ValueKey('production-select:bun:шт')));
      await tester.pump();
      await _send(tester);
      expect(find.text('Требует проверки'), findsOneWidget);
      expect(find.textContaining('№ BLK-'), findsOneWidget);
      expect(
        find.text('Проверьте акт в iiko и сообщите администратору.'),
        findsOneWidget,
      );
      expect(api.productionBodies, hasLength(1));
      expect(
        tester
            .widget<FilledButton>(find.byKey(const ValueKey('production-send')))
            .onPressed,
        isNull,
      );
      await tester.tap(find.byIcon(Icons.refresh).first);
      await tester.pumpAndSettle();
      expect(api.productionBodies, hasLength(1));
    },
  );

  testWidgets(
    'confirmation can go back and pending send cannot be duplicated',
    (tester) async {
      appLanguageNotifier.value = 'ru';
      final gate = Completer<Map<String, dynamic>>();
      final api = ReportApi()..sendGate = gate;
      addTearDown(api.close);
      await _mountReports(tester, api);
      await tester.tap(find.byKey(const ValueKey('production-select:bun:шт')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('production-send')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Назад'));
      await tester.pumpAndSettle();
      expect(api.productionBodies, isEmpty);
      await tester.tap(find.byKey(const ValueKey('production-send')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('production-confirm')));
      await tester.pump();
      expect(api.productionBodies, hasLength(1));
      expect(
        tester
            .widget<FilledButton>(find.byKey(const ValueKey('production-send')))
            .onPressed,
        isNull,
      );
      expect(
        tester
            .widget<CheckboxListTile>(
              find.byKey(const ValueKey('production-select:bun:шт')),
            )
            .onChanged,
        isNull,
      );
      final id = api.productionBodies.single['requestId'];
      api.acts = [
        {'id': id, 'status': 'sending'},
      ];
      api.productionQuantity = 0;
      gate.complete({'act': api.acts.single});
      await tester.pumpAndSettle();
      expect(find.text('Отправляется'), findsOneWidget);
      expect(api.productionBodies, hasLength(1));
    },
  );

  testWidgets(
    'reloaded pending act resumes exact frozen UUID and events once',
    (tester) async {
      appLanguageNotifier.value = 'ru';
      final local = DateTime.now().toUtc().add(const Duration(hours: 5));
      final date = local.toIso8601String().substring(0, 10);
      const id = '55555555-5555-4555-8555-555555555555';
      final gate = Completer<Map<String, dynamic>>();
      final api = ReportApi()
        ..productionQuantity = 0
        ..sendGate = gate
        ..acts = [
          {'id': id, 'date': date, 'status': 'pending', 'eventIds': _bunEvents},
        ];
      addTearDown(api.close);
      await _mountReports(tester, api);
      expect(
        find.byKey(const ValueKey('production-select:bun:шт')),
        findsNothing,
      );
      final resume = find.byKey(const ValueKey('production-resume:$id'));
      await tester.tap(resume);
      await tester.pump();
      expect(api.productionBodies.single, {
        'requestId': id,
        'date': date,
        'eventIds': _bunEvents,
      });
      expect(tester.widget<TextButton>(resume).onPressed, isNull);
      api.acts = [
        {
          'id': id,
          'date': date,
          'status': 'created',
          'documentNumber': 'A-18',
          'eventIds': _bunEvents,
        },
      ];
      gate.complete({'act': api.acts.single});
      await tester.pumpAndSettle();
      expect(api.productionBodies, hasLength(1));
      expect(find.text('№ A-18'), findsOneWidget);
      expect(resume, findsNothing);
    },
  );

  for (final status in ['sending', 'unknown']) {
    testWidgets('$status act never exposes resume despite frozen events', (
      tester,
    ) async {
      appLanguageNotifier.value = 'ru';
      final local = DateTime.now().toUtc().add(const Duration(hours: 5));
      final date = local.toIso8601String().substring(0, 10);
      final api = ReportApi()
        ..productionQuantity = 0
        ..acts = [
          {
            'id': 'held',
            'date': date,
            'status': status,
            'eventIds': _bunEvents,
          },
        ];
      addTearDown(api.close);
      await _mountReports(tester, api);
      expect(
        find.byKey(const ValueKey('production-resume:held')),
        findsNothing,
      );
      expect(api.productionBodies, isEmpty);
    });
  }

  testWidgets(
    'lost response preserves exact UUID and payload for explicit retry',
    (tester) async {
      appLanguageNotifier.value = 'ru';
      final api = ReportApi()
        ..sendError = const StaffApiException(0, 'NETWORK', 'Нет связи');
      addTearDown(api.close);
      await _mountReports(tester, api);
      await tester.tap(find.byKey(const ValueKey('production-select:bun:шт')));
      await tester.pump();
      await _send(tester);
      expect(
        find.byKey(const ValueKey('production-submit-error')),
        findsOneWidget,
      );
      expect(api.productionBodies, hasLength(1));
      api.sendError = null;
      await _send(tester);
      expect(api.productionBodies, hasLength(2));
      expect(api.productionBodies[1], api.productionBodies[0]);
      expect(find.text('№ A-17'), findsOneWidget);
    },
  );

  testWidgets(
    'definitively failed act allows fresh explicit selection and UUID',
    (tester) async {
      appLanguageNotifier.value = 'ru';
      final api = ReportApi()..actStatus = 'failed';
      addTearDown(api.close);
      await _mountReports(tester, api);
      await tester.tap(find.byKey(const ValueKey('production-select:bun:шт')));
      await tester.pump();
      await _send(tester);
      expect(find.text('Не создан'), findsOneWidget);
      expect(find.textContaining('Выбрано:'), findsNothing);
      api.actStatus = 'created';
      await tester.tap(find.byKey(const ValueKey('production-select:bun:шт')));
      await tester.pump();
      await _send(tester);
      expect(api.productionBodies, hasLength(2));
      expect(
        api.productionBodies[1]['requestId'],
        isNot(api.productionBodies[0]['requestId']),
      );
    },
  );

  testWidgets('live quantity changes invalidate selection before sending', (
    tester,
  ) async {
    appLanguageNotifier.value = 'ru';
    final api = ReportApi();
    addTearDown(api.close);
    await _mountReports(tester, api);
    await tester.tap(find.byKey(const ValueKey('production-select:bun:шт')));
    await tester.pump();
    api.productionQuantity = 26;
    api.changes.add({'type': 'inventory.updated'});
    await tester.pump(const Duration(milliseconds: 150));
    await tester.pumpAndSettle();
    expect(find.text('+26 шт'), findsOneWidget);
    expect(find.textContaining('Выбрано:'), findsNothing);
    expect(
      tester
          .widget<FilledButton>(find.byKey(const ValueKey('production-send')))
          .onPressed,
      isNull,
    );
    expect(api.productionBodies, isEmpty);
  });

  testWidgets(
    'report error retries and feature unavailable disables selection',
    (tester) async {
      appLanguageNotifier.value = 'ru';
      final api = ReportApi()..productionError = true;
      addTearDown(api.close);
      await _mountReports(tester, api);
      expect(
        find.byKey(const ValueKey('production-select:bun:шт')),
        findsNothing,
      );
      expect(
        tester
            .widget<FilledButton>(find.byKey(const ValueKey('production-send')))
            .onPressed,
        isNull,
      );
      api.productionError = false;
      api.productionEnabled = false;
      await tester.tap(find.byIcon(Icons.refresh).first);
      await tester.pumpAndSettle();
      expect(find.text('iiko не настроен'), findsOneWidget);
      expect(
        tester
            .widget<CheckboxListTile>(
              find.byKey(const ValueKey('production-select:bun:шт')),
            )
            .onChanged,
        isNull,
      );
    },
  );

  for (final language in ['ru', 'kk']) {
    testWidgets(
      'production selection and review fit320px with200% text $language',
      (tester) async {
        appLanguageNotifier.value = language;
        tester.view.physicalSize = const Size(320, 800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final api = ReportApi()..branchId = 'assigned';
        addTearDown(api.close);
        await tester.pumpWidget(
          MaterialApp(
            theme: buildBulkaTheme(),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: const TextScaler.linear(2)),
              child: child!,
            ),
            home: Scaffold(body: CashierReports(api: api)),
          ),
        );
        await tester.pumpAndSettle();
        await tester.scrollUntilVisible(
          find.byKey(const ValueKey('production-select:bun:шт')),
          180,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.tap(
          find.byKey(const ValueKey('production-select:bun:шт')),
        );
        await tester.pump();
        await tester.tap(find.byKey(const ValueKey('production-send')));
        await tester.pumpAndSettle();
        await tester.ensureVisible(
          find.byKey(const ValueKey('production-confirm')),
        );
        await tester.tap(find.byKey(const ValueKey('production-confirm')));
        await tester.pumpAndSettle();
        expect(api.productionBodies, hasLength(1));
        expect(tester.takeException(), isNull);
      },
    );
  }

  for (final language in ['kk', 'en']) {
    testWidgets('backend production reasons are localized in $language', (
      tester,
    ) async {
      appLanguageNotifier.value = language;
      final api = ReportApi();
      addTearDown(api.close);
      for (final entry in [
        (
          'IIKO_PRODUCTION_PRODUCT_UNMAPPED',
          'Тағам iiko-да табылмады',
          'Dish not found in iiko',
        ),
        (
          'IIKO_PRODUCTION_UNIT_MISMATCH',
          'Өлшем бірлігі iiko-дан өзгеше',
          'Unit differs from iiko',
        ),
        (
          'IIKO_PRODUCTION_QUANTITY_INVALID',
          'Санын тексеріңіз',
          'Check the quantity',
        ),
      ]) {
        api.productReasonCode = entry.$1;
        await tester.pumpWidget(const SizedBox.shrink());
        await _mountReports(tester, api);
        expect(
          find.text(language == 'kk' ? entry.$2 : entry.$3),
          findsOneWidget,
        );
      }
    });
  }

  testWidgets('cashier report preserves units and requests the selected date', (
    tester,
  ) async {
    appLanguageNotifier.value = 'ru';
    final api = ReportApi();
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: Scaffold(body: CashierReports(api: api)),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('+25 шт'), findsOneWidget);
    expect(find.text('+1.125 кг'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('production-select:bun:шт')));
    await tester.pump();
    await tester.tap(find.byIcon(Icons.calendar_month_outlined));
    await tester.pumpAndSettle();
    expect(find.byType(DatePickerDialog), findsOneWidget);
    Navigator.of(
      tester.element(find.byType(DatePickerDialog)),
    ).pop(DateTime(2026, 9, 11));
    await tester.pumpAndSettle();
    expect(
      api.requests,
      contains('/staff/reports/display-stock?date=2026-09-11&offset=0'),
    );
    expect(find.text('11.09.2026'), findsOneWidget);
    expect(find.textContaining('Выбрано:'), findsNothing);
    final before = api.requests.length;
    api.changes.add({'type': 'inventory.updated'});
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 150));
    await tester.pumpAndSettle();
    expect(api.requests.length, before + 2);
    expect(api.requests.last, '/staff/reports/production?date=2026-09-11');
    expect(tester.takeException(), isNull);
  });

  testWidgets('cashier can clear today with code and sees zero immediately', (
    tester,
  ) async {
    appLanguageNotifier.value = 'ru';
    final api = ReportApi();
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: Scaffold(body: CashierReports(api: api)),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('cashier-report-reset-button')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('cashier-report-reset-code')),
      '0000',
    );
    await tester.tap(
      find.byKey(const ValueKey('cashier-report-reset-confirm')),
    );
    await tester.pumpAndSettle();

    expect(api.requests, contains('/staff/reports/display-stock/reset'));
    expect(api.resetBody, {'code': '0000'});
    expect(find.text('0'), findsOneWidget);
    expect(find.text('+25 шт'), findsNothing);
    expect(
      find.text('Отчёт очищен. Сегодняшняя витрина начинается с 0.'),
      findsOneWidget,
    );
  });

  testWidgets('live refresh keeps loaded report pages and scroll position', (
    tester,
  ) async {
    appLanguageNotifier.value = 'ru';
    final api = PagedReportApi();
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: Scaffold(body: CashierReports(api: api)),
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(
      find.byKey(const ValueKey('cashier-report-history')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('cashier-report-history')));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('Показать ещё'),
      600,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Показать ещё'));
    await tester.pumpAndSettle();
    expect(api.requests.last, contains('offset=100'));
    final scrollable = tester.state<ScrollableState>(
      find.byType(Scrollable).first,
    );
    final before = scrollable.position.pixels;

    api.eventCount = 201;
    api.changes.add({'type': 'inventory.updated'});
    await tester.pump(const Duration(milliseconds: 150));
    await tester.pumpAndSettle();

    expect(api.requests, contains(contains('offset=200')));
    expect(scrollable.position.pixels, closeTo(before, 1));
    expect(tester.takeException(), isNull);
  });
}

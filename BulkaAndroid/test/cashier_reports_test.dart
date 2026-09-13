import 'dart:async';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class ReportApi extends StaffApiClient {
  final requests = <String>[];
  final changes = StreamController<Map<String, dynamic>>.broadcast();
  Object? resetBody;
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
    if (endpoint == '/staff/reports/display-stock/reset') {
      resetBody = body;
      return {
        'products': <Object>[],
        'totals': <Object>[],
        'events': <Object>[],
        'eventCount': 0,
        'hasMore': false,
        'resetAt': '2026-09-12T18:00:00Z',
      };
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

void main() {
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
    await tester.tap(find.byIcon(Icons.calendar_month_outlined));
    await tester.pumpAndSettle();
    expect(find.byType(DatePickerDialog), findsOneWidget);
    Navigator.of(
      tester.element(find.byType(DatePickerDialog)),
    ).pop(DateTime(2026, 9, 11));
    await tester.pumpAndSettle();
    expect(
      api.requests.last,
      '/staff/reports/display-stock?date=2026-09-11&offset=0',
    );
    expect(find.text('11.09.2026'), findsOneWidget);
    final before = api.requests.length;
    api.changes.add({'type': 'inventory.updated'});
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 150));
    await tester.pumpAndSettle();
    expect(api.requests.length, before + 1);
    expect(
      api.requests.last,
      '/staff/reports/display-stock?date=2026-09-11&offset=0',
    );
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

    expect(api.requests.last, '/staff/reports/display-stock/reset');
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
    await tester.scrollUntilVisible(
      find.text('Показать ещё'),
      600,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.tap(find.text('Показать ещё'));
    await tester.pumpAndSettle();
    expect(api.requests.last, contains('offset=100'));
    final scrollable = tester.state<ScrollableState>(
      find.byType(Scrollable).last,
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

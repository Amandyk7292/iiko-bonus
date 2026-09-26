import 'dart:async';
import 'dart:convert';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
// Test the storage failure contract through shared_preferences' platform boundary.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences_platform_interface/shared_preferences_platform_interface.dart';

class _FailingPreferences extends InMemorySharedPreferencesStore {
  _FailingPreferences() : super.empty();
  bool allowWrites = false;
  final attempts = <String>[];
  @override
  Future<bool> setValue(String valueType, String key, Object value) async {
    if (key.contains('staff_manual_bonus_v1_')) {
      attempts.add(value as String);
      if (!allowWrites) return false;
    }
    return super.setValue(valueType, key, value);
  }
}

class _BonusApi extends StaffApiClient {
  _BonusApi(this.outcomes) {
    branchId = 'branch-one';
  }
  final List<Object?> outcomes;
  final mutations = <Map<String, dynamic>>[];
  @override
  Stream<Map<String, dynamic>> events({String? lastEventId}) =>
      const Stream.empty();
  @override
  Future<dynamic> request(
    String endpoint, {
    String method = 'GET',
    Object? body,
    bool authenticated = true,
    Map<String, String> headers = const {},
    Map<String, String> query = const {},
  }) async {
    if (endpoint.startsWith('/customers?')) {
      return {
        'customers': [
          {
            'id': 'customer-one',
            'name': 'Клиент',
            'phone': '77000000000',
            'balance': 100,
          },
        ],
        'total': 1,
      };
    }
    expect(endpoint, '/customers/bonus');
    expect(method, 'POST');
    final payload = Map<String, dynamic>.from(body! as Map);
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs
        .getKeys()
        .where((key) => key.startsWith('staff_manual_bonus_v1_'))
        .single;
    expect(
      jsonDecode(prefs.getString(stored)!),
      payload,
      reason: 'The retry identity and payload must be durable before sending',
    );
    mutations.add(payload);
    final outcome = outcomes.removeAt(0);
    if (outcome is Completer<void>) {
      await outcome.future;
    } else if (outcome is Map) {
      return outcome;
    } else if (outcome != null) {
      throw outcome;
    }
    return {'success': true};
  }
}

final _amount = find.byKey(const ValueKey('staff-bonus-amount'));
final _reason = find.byKey(const ValueKey('staff-bonus-reason'));
final _save = find.byKey(const ValueKey('staff-customer-save'));

Future<void> _mount(WidgetTester tester, _BonusApi api) async {
  tester.view.physicalSize = const Size(600, 1100);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: staffTheme(),
      home: Scaffold(
        body: StaffCustomers(
          api: api,
          role: 'owner',
          actions: const {'customers:adjust-bonus'},
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _open(WidgetTester tester) async {
  await tester.tap(find.text('Изменить бонусы'));
  await tester.pumpAndSettle();
}

Future<void> _fill(WidgetTester tester, {String amount = '25'}) async {
  await tester.enterText(_amount, amount);
  await tester.enterText(_reason, 'Тестовое начисление');
}

Future<void> _submit(WidgetTester tester) async {
  await tester.tap(_save);
  await tester.pumpAndSettle();
}

Future<void> _dispose(WidgetTester tester, _BonusApi api) async {
  await tester.pumpWidget(const SizedBox.shrink());
  api.close();
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    appLanguageNotifier.value = 'ru';
  });
  testWidgets(
    'a rejected durable write prevents the mutation and retries the same draft',
    (tester) async {
      final store = _FailingPreferences();
      SharedPreferencesStorePlatform.instance = store;
      final api = _BonusApi([null]);
      await _mount(tester, api);
      await _open(tester);
      await _fill(tester);
      await _submit(tester);
      expect(api.mutations, isEmpty);
      expect(store.attempts, hasLength(1));
      store.allowWrites = true;
      await _submit(tester);
      expect(store.attempts, hasLength(2));
      expect(store.attempts[1], store.attempts[0]);
      expect(api.mutations.single, jsonDecode(store.attempts[0]));
      await _dispose(tester, api);
    },
  );
  testWidgets(
    'lost bonus response and reopened form reuse one durable UUID and payload',
    (tester) async {
      final api = _BonusApi([TimeoutException('lost response'), null]);
      await _mount(tester, api);
      await _open(tester);
      await _fill(tester);
      await _submit(tester);
      expect(
        api.mutations.single['operationId'],
        matches(
          RegExp(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          ),
        ),
      );
      expect(tester.widget<TextFormField>(_amount).enabled, false);
      await tester.tap(find.text('Отмена'));
      await tester.pumpAndSettle();
      await _open(tester);
      expect(tester.widget<TextFormField>(_amount).controller!.text, '25');
      expect(tester.widget<TextFormField>(_amount).enabled, false);
      await _submit(tester);
      expect(api.mutations, hasLength(2));
      expect(api.mutations[1], api.mutations[0]);
      final prefs = await SharedPreferences.getInstance();
      expect(
        prefs.getKeys().where(
          (key) => key.startsWith('staff_manual_bonus_v1_'),
        ),
        isEmpty,
      );
      await _dispose(tester, api);
    },
  );
  testWidgets(
    'a success HTTP response without explicit success retains the retry identity',
    (tester) async {
      final api = _BonusApi([<String, dynamic>{}, null]);
      await _mount(tester, api);
      await _open(tester);
      await _fill(tester);
      await _submit(tester);
      expect(tester.widget<TextFormField>(_amount).enabled, false);
      await _submit(tester);
      expect(api.mutations, hasLength(2));
      expect(api.mutations[1], api.mutations[0]);
      await _dispose(tester, api);
    },
  );
  testWidgets(
    'a 401 after an ambiguous adjustment retains its original retry identity',
    (tester) async {
      final api = _BonusApi([
        TimeoutException('lost'),
        const StaffApiException(401, 'UNAUTHORIZED', 'Войдите снова'),
        null,
      ]);
      await _mount(tester, api);
      await _open(tester);
      await _fill(tester);
      await _submit(tester);
      await _submit(tester);
      expect(tester.widget<TextFormField>(_amount).enabled, false);
      await _submit(tester);
      expect(api.mutations, hasLength(3));
      expect(
        api.mutations.map((body) => body['operationId']).toSet(),
        hasLength(1),
      );
      await _dispose(tester, api);
    },
  );
  for (final rejection in const [
    StaffApiException(400, 'VALIDATION_ERROR', 'Неверная сумма'),
    StaffApiException(
      409,
      'MANUAL_BONUS_BALANCE_RESERVED',
      'Бонусы зарезервированы',
    ),
  ]) {
    testWidgets(
      'first definite ${rejection.code} rejection permits corrected new adjustment',
      (tester) async {
        final api = _BonusApi([rejection, null]);
        await _mount(tester, api);
        await _open(tester);
        await _fill(tester);
        await _submit(tester);
        expect(tester.widget<TextFormField>(_amount).enabled, true);
        await _fill(tester, amount: '30');
        await _submit(tester);
        expect(
          api.mutations[1]['operationId'],
          isNot(api.mutations[0]['operationId']),
        );
        expect(api.mutations[1]['amount'], 30);
        await _dispose(tester, api);
      },
    );
  }
  testWidgets('a pending adjustment cannot be retried in a changed branch', (
    tester,
  ) async {
    final api = _BonusApi([TimeoutException('lost'), null]);
    await _mount(tester, api);
    await _open(tester);
    await _fill(tester);
    await _submit(tester);
    api.branchId = 'branch-two';
    await _submit(tester);
    expect(api.mutations, hasLength(1));
    api.branchId = 'branch-one';
    await _submit(tester);
    expect(api.mutations[1], api.mutations[0]);
    await _dispose(tester, api);
  });
  testWidgets(
    'rapid bonus save taps send one operation while awaiting its result',
    (tester) async {
      final result = Completer<void>();
      final api = _BonusApi([result]);
      await _mount(tester, api);
      await _open(tester);
      await _fill(tester);
      await tester.tap(_save);
      await tester.tap(_save);
      await tester.pump();
      expect(api.mutations, hasLength(1));
      result.complete();
      await tester.pumpAndSettle();
      await _dispose(tester, api);
    },
  );
}

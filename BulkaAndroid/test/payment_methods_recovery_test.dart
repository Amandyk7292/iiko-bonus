import 'dart:async';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _RecoveryApi extends BulkaApiClient {
  int creates = 0;
  int resumes = 0;
  int checks = 0;
  int methodLoads = 0;
  String status = 'pending';
  bool cardSaved = false;
  Object? statusError;
  Future<Map<String, dynamic>>? statusRequest;
  Future<List<Map<String, dynamic>>>? methodsRequest;
  Completer<void>? removal;
  List<Map<String, dynamic>> methods = [
    {
      'id': 'existing-card',
      'brand': 'visa',
      'lastFour': '3803',
      'isDefault': true,
    },
  ];

  @override
  Future<List<Map<String, dynamic>>> getFortePaymentMethods() async {
    methodLoads++;
    return methodsRequest ?? methods;
  }

  @override
  Future<bool> isFortePaymentAvailable() async => false;

  @override
  Future<void> removeFortePaymentMethod(String methodId) async {
    await removal?.future;
    methods = [
      for (final method in methods)
        if (method['id'] != methodId) method,
    ];
  }

  @override
  Future<Map<String, dynamic>> createForteCardSetup() async {
    creates++;
    return {
      'operationId': 'setup-one',
      'paymentStatus': 'pending',
      'redirectUrl': 'https://invalid.example/checkout',
    };
  }

  @override
  Future<Map<String, dynamic>> resumeForteCardSetup(String operationId) async {
    resumes++;
    return {
      'operationId': operationId,
      'paymentStatus': status,
      'redirectUrl': 'https://invalid.example/checkout',
    };
  }

  @override
  Future<Map<String, dynamic>> checkForteCardSetupStatus(
    String operationId,
  ) async {
    checks++;
    if (statusError case final error?) throw error;
    return statusRequest ??
        {
          'paymentStatus': status,
          'cardSaved': cardSaved,
          'refundStatus': 'succeeded',
        };
  }
}

Widget _host(BulkaApiClient api) => MaterialApp(
  theme: buildBulkaTheme(),
  home: PaymentMethodsScreen(api: api),
);

Future<void> _pumpReady(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 350));
  await tester.pump();
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    appLanguageNotifier.value = 'ru';
  });

  testWidgets(
    'closing card setup preserves one operation, reopens the list, and accepts a later verified card',
    (tester) async {
      final api = _RecoveryApi();
      final pendingResponse = Completer<Map<String, dynamic>>();
      api.statusRequest = pendingResponse.future;
      await tester.pumpWidget(_host(api));
      await _pumpReady(tester);
      expect(find.text('VISA •••• 3803'), findsOneWidget);

      await tester.tap(find.text('Добавить карту'));
      await _pumpReady(tester);
      await tester.tap(find.byTooltip('Закрыть'));
      await _pumpReady(tester);
      await tester.tap(find.widgetWithText(FilledButton, 'Закрыть'));
      await _pumpReady(tester);

      // Do not wait for the bank to answer merely to close its form.
      expect(find.text('VISA •••• 3803'), findsOneWidget);
      expect(find.text('Продолжить добавление карты'), findsOneWidget);
      expect(await PendingCardSetupStore.load(api), 'setup-one');
      expect(api.creates, 1);
      expect(api.resumes, 0);

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpWidget(_host(api));
      await _pumpReady(tester);
      // Relaunching does not replace existing cards with a verification modal.
      expect(find.text('VISA •••• 3803'), findsOneWidget);
      await tester.pump(const Duration(seconds: 9));
      await _pumpReady(tester);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(await PendingCardSetupStore.load(api), 'setup-one');
      expect(api.creates, 1);

      // A delayed bank result, rather than local cancellation, proves success.
      api.statusRequest = null;
      api.status = 'paid';
      api.cardSaved = true;
      api.methods = [
        ...api.methods,
        {
          'id': 'verified-new-card',
          'brand': 'mastercard',
          'lastFour': '1328',
          'isDefault': false,
        },
      ];
      await tester.tap(find.text('Проверить статус'));
      await _pumpReady(tester);
      expect(find.text('VISA •••• 3803'), findsOneWidget);
      expect(find.text('MASTERCARD •••• 1328'), findsOneWidget);
      expect(find.text('Добавить карту'), findsOneWidget);
      expect(await PendingCardSetupStore.load(api), isNull);
      expect(api.creates, 1);
      expect(api.resumes, 0);

      pendingResponse.complete({'paymentStatus': 'pending'});
      await _pumpReady(tester);
      expect(find.text('VISA •••• 3803'), findsOneWidget);
      expect(find.text('MASTERCARD •••• 1328'), findsOneWidget);
      expect(await PendingCardSetupStore.load(api), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      api.dispose();
    },
  );

  testWidgets('restored pending setup checks once without hiding saved cards', (
    tester,
  ) async {
    final api = _RecoveryApi();
    await PendingCardSetupStore.save(api, 'setup-one');
    await tester.pumpWidget(_host(api));
    await tester.pumpAndSettle();
    expect(api.checks, 1);
    expect(find.text('VISA •••• 3803'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(await PendingCardSetupStore.load(api), 'setup-one');

    await tester.tap(find.text('Продолжить добавление карты'));
    await _pumpReady(tester);
    expect(api.creates, 0);
    expect(api.resumes, 1);
    expect(await PendingCardSetupStore.load(api), 'setup-one');
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
  });

  testWidgets('unresponsive card list stops loading and can be refreshed', (
    tester,
  ) async {
    final api = _RecoveryApi();
    final response = Completer<List<Map<String, dynamic>>>();
    api.methodsRequest = response.future;
    await tester.pumpWidget(_host(api));
    await _pumpReady(tester);
    await tester.pump(const Duration(seconds: 9));
    await _pumpReady(tester);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('Добавить карту'), findsOneWidget);
    expect(
      find.text('Не удалось загрузить сохранённые карты.'),
      findsOneWidget,
    );

    api.methodsRequest = null;
    await tester
        .widget<RefreshIndicator>(find.byType(RefreshIndicator))
        .onRefresh();
    await _pumpReady(tester);
    expect(find.text('VISA •••• 3803'), findsOneWidget);
    response.complete([]);
    await _pumpReady(tester);
    expect(find.text('VISA •••• 3803'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
  });

  for (final error in [
    ApiException('offline'),
    ApiException('gateway', statusCode: 404, code: 'INVALID_API_RESPONSE'),
  ]) {
    testWidgets('unverified ${error.code} keeps pending setup and saved card', (
      tester,
    ) async {
      final api = _RecoveryApi()..statusError = error;
      await PendingCardSetupStore.save(api, 'setup-one');
      await tester.pumpWidget(_host(api));
      await tester.pumpAndSettle();
      expect(find.text('VISA •••• 3803'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(await PendingCardSetupStore.load(api), 'setup-one');
      expect(api.creates, 0);
      await tester.pumpWidget(const SizedBox.shrink());
      api.dispose();
    });
  }

  testWidgets('verified missing setup clears only its local reference', (
    tester,
  ) async {
    final api = _RecoveryApi()
      ..statusError = ApiException(
        'missing setup',
        statusCode: 404,
        code: 'FORTE_WIDGET_CARD_SETUP_NOT_FOUND',
      );
    await PendingCardSetupStore.save(api, 'setup-one');
    await tester.pumpWidget(_host(api));
    await tester.pumpAndSettle();
    expect(find.text('VISA •••• 3803'), findsOneWidget);
    expect(find.text('Добавить карту'), findsOneWidget);
    expect(await PendingCardSetupStore.load(api), isNull);
    expect(api.creates, 0);
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
  });

  testWidgets('bank-confirmed cancellation leaves existing cards untouched', (
    tester,
  ) async {
    final api = _RecoveryApi()..status = 'cancelled';
    await PendingCardSetupStore.save(api, 'setup-one');
    await tester.pumpWidget(_host(api));
    await tester.pumpAndSettle();
    expect(api.checks, 1);
    expect(api.creates, 0);
    expect(find.text('VISA •••• 3803'), findsOneWidget);
    expect(find.text('Добавить карту'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(await PendingCardSetupStore.load(api), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
  });

  testWidgets('bank refresh waits for an in-flight saved-card deletion', (
    tester,
  ) async {
    final verification = Completer<Map<String, dynamic>>();
    final deletion = Completer<void>();
    final api = _RecoveryApi()
      ..statusRequest = verification.future
      ..removal = deletion;
    await PendingCardSetupStore.save(api, 'setup-one');
    await tester.pumpWidget(_host(api));
    await _pumpReady(tester);
    await tester.tap(find.byType(PopupMenuButton<String>));
    await _pumpReady(tester);
    await tester.tap(find.text('Удалить карту'));
    await _pumpReady(tester);
    await tester.tap(find.widgetWithText(TextButton, 'Удалить'));
    await _pumpReady(tester);
    expect(find.text('VISA •••• 3803'), findsNothing);

    verification.complete({'paymentStatus': 'paid', 'cardSaved': true});
    await _pumpReady(tester);
    // A GET racing the DELETE would restore the old card from the bank list.
    expect(api.methodLoads, 1);
    expect(find.text('VISA •••• 3803'), findsNothing);
    deletion.complete();
    await _pumpReady(tester);
    expect(api.methodLoads, 2);
    expect(find.text('VISA •••• 3803'), findsNothing);
    expect(await PendingCardSetupStore.load(api), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
  });

  for (final dialogOpen in [false, true]) {
    testWidgets('native bank cancellation safely exits (dialog: $dialogOpen)', (
      tester,
    ) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      const operationId = '00000000-0000-4000-8000-000000000001';
      final api = _RecoveryApi();
      ValueChanged<Uri>? onReturn;
      FortePaymentResult? result;
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: Builder(
            builder: (context) => Scaffold(
              body: FilledButton(
                onPressed: () async {
                  result = await Navigator.of(context).push<FortePaymentResult>(
                    MaterialPageRoute(
                      builder: (_) => FortePaymentScreen(
                        api: api,
                        operationId: operationId,
                        redirectUrl:
                            'https://bulka.com.kz/payments/forte-widget#test-token',
                        cardSetup: true,
                        checkoutViewBuilder: (callback) {
                          onReturn = callback;
                          return const SizedBox.expand();
                        },
                      ),
                    ),
                  );
                },
                child: const Text('open-card-form'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open-card-form'));
      await _pumpReady(tester);
      expect(onReturn, isNotNull);
      if (dialogOpen) {
        await tester.tap(find.byTooltip('Закрыть'));
        await _pumpReady(tester);
        expect(find.widgetWithText(FilledButton, 'Закрыть'), findsOneWidget);
      }
      onReturn!(
        Uri.parse(
          'https://bulka.com.kz/profile?payment=forte&setup=$operationId&status=cancelled',
        ),
      );
      await _pumpReady(tester);
      if (dialogOpen) {
        expect(result, isNull);
        // The bool dialog must finish before the payment result is returned.
        await tester.tap(find.widgetWithText(TextButton, 'Отмена'));
        await _pumpReady(tester);
      }
      expect(tester.takeException(), isNull);
      expect(find.text('open-card-form'), findsOneWidget);
      expect(result?.outcome, FortePaymentOutcome.pending);
      expect(result?.operationId, operationId);
      await tester.pumpWidget(const SizedBox.shrink());
      debugDefaultTargetPlatformOverride = null;
      api.dispose();
    });
  }
}

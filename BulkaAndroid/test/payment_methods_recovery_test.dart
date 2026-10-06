import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:bulka_bonus/main.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _RecoveryApi extends BulkaApiClient {
  final events = StreamController<Map<String, dynamic>>.broadcast();
  @override
  Stream<Map<String, dynamic>> get customerEvents => events.stream;
  @override
  void dispose() {
    unawaited(events.close());
    super.dispose();
  }

  int creates = 0, resumes = 0, checks = 0, methodLoads = 0;
  final cancelledIds = <String>[];
  String status = 'pending';
  bool cardSaved = false;
  Object? cancelError;
  Future<Map<String, dynamic>>? cancelRequest, statusRequest;
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
  Future<void> removeFortePaymentMethod(String id) async {
    await removal?.future;
    methods = [
      for (final method in methods)
        if (method['id'] != id) method,
    ];
  }

  @override
  Future<Map<String, dynamic>> createForteCardSetup() async {
    creates++;
    return {
      'operationId': 'setup-$creates',
      'paymentStatus': 'pending',
      'redirectUrl': 'https://invalid.example/checkout',
    };
  }

  @override
  Future<Map<String, dynamic>> resumeForteCardSetup(String id) async {
    resumes++;
    throw StateError('Exited bank form must never be resumed');
  }

  Map<String, dynamic> ack(String id) => {
    'success': true,
    'operationId': id,
    'paymentStatus': status,
    'cardSaved': cardSaved,
    'cancelled': !(cardSaved || status == 'paid'),
    'canResume': false,
  };
  @override
  Future<Map<String, dynamic>> cancelForteCardSetup(String id) async {
    cancelledIds.add(id);
    if (cancelError case final error?) throw error;
    return cancelRequest ?? ack(id);
  }

  @override
  Future<Map<String, dynamic>> checkForteCardSetupStatus(String id) async {
    checks++;
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
Future<void> _ready(WidgetTester tester) async {
  for (var i = 0; i < 5; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void _cleanList() {
  expect(find.text('VISA •••• 3803'), findsOneWidget);
  expect(find.text('Добавить новую карту'), findsOneWidget);
  expect(find.text('Продолжить добавление карты'), findsNothing);
  expect(find.text('Проверить статус'), findsNothing);
  expect(find.text('Проверяем карту'), findsNothing);
  expect(find.text('payment_methods_verification_hint'.tr), findsNothing);
  expect(find.byType(CircularProgressIndicator), findsNothing);
}

Future<void> _close(WidgetTester tester) async {
  await tester.tap(find.byTooltip('Закрыть'));
  await _ready(tester);
  await tester.pumpAndSettle();
  expect(find.byType(Dialog), findsNothing);
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    appLanguageNotifier.value = 'ru';
  });
  testWidgets('close cancels setup and next Add opens a fresh form', (
    tester,
  ) async {
    final api = _RecoveryApi();
    final bank = Completer<Map<String, dynamic>>();
    api.statusRequest = bank.future;
    await tester.pumpWidget(_host(api));
    await _ready(tester);
    _cleanList();
    await tester.tap(find.text('Добавить новую карту'));
    await _ready(tester);
    await _close(tester);
    _cleanList();
    expect(api.cancelledIds, ['setup-1']);
    expect(await PendingCardSetupStore.load(api), isNull);
    await tester.tap(find.text('Добавить новую карту'));
    await _ready(tester);
    expect(api.creates, 2);
    expect(api.resumes, 0);
    expect(await PendingCardSetupStore.load(api), 'setup-2');
    await _close(tester);
    expect(api.cancelledIds, ['setup-1', 'setup-2']);
    bank.complete({'paymentStatus': 'pending'});
    await _ready(tester);
    _cleanList();
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
  });
  testWidgets('unknown cancellation blocks a second hold until acknowledged', (
    tester,
  ) async {
    final api = _RecoveryApi();
    final bank = Completer<Map<String, dynamic>>();
    api.statusRequest = bank.future;
    await tester.pumpWidget(_host(api));
    await _ready(tester);
    await tester.tap(find.text('Добавить новую карту'));
    await _ready(tester);
    api.cancelError = ApiException('offline');
    await _close(tester);
    _cleanList();
    expect(await PendingCardSetupStore.load(api), 'setup-1');
    expect(
      await PendingCardSetupStore.isCancellationRequested(api, 'setup-1'),
      isTrue,
    );
    await tester.tap(find.text('Добавить новую карту'));
    await _ready(tester);
    expect(api.creates, 1);
    expect(api.resumes, 0);
    api.cancelError = null;
    await tester.tap(find.text('Добавить новую карту'));
    await _ready(tester);
    expect(api.creates, 2);
    await _close(tester);
    bank.complete({'paymentStatus': 'pending'});
    await _ready(tester);
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
  });
  testWidgets('restored stale form is silently retired with a clean list', (
    tester,
  ) async {
    final api = _RecoveryApi();
    await PendingCardSetupStore.save(api, 'old-expired-token');
    await tester.pumpWidget(_host(api));
    await tester.pumpAndSettle();
    _cleanList();
    expect(api.cancelledIds, ['old-expired-token']);
    expect(api.resumes, 0);
    expect(api.creates, 0);
    expect(await PendingCardSetupStore.load(api), isNull);
    await tester.tap(find.text('Добавить новую карту'));
    await _ready(tester);
    expect(api.creates, 1);
    await _close(tester);
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
  });
  testWidgets('cancellation timeout does not hide the saved cards', (
    tester,
  ) async {
    final api = _RecoveryApi();
    final cancellation = Completer<Map<String, dynamic>>();
    api.cancelRequest = cancellation.future;
    await PendingCardSetupStore.save(api, 'old-setup');
    await tester.pumpWidget(_host(api));
    await _ready(tester);
    _cleanList();
    await tester.pump(const Duration(seconds: 9));
    await _ready(tester);
    _cleanList();
    expect(await PendingCardSetupStore.load(api), 'old-setup');
    expect(
      await PendingCardSetupStore.isCancellationRequested(api, 'old-setup'),
      isTrue,
    );
    cancellation.complete(api.ack('old-setup'));
    await _ready(tester);
    expect(await PendingCardSetupStore.load(api), 'old-setup');
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
  });
  testWidgets('already saved card wins a close race without a new setup', (
    tester,
  ) async {
    final api = _RecoveryApi()..cardSaved = true;
    api.methods.add({
      'id': 'new-card',
      'brand': 'mastercard',
      'lastFour': '1328',
      'isDefault': false,
    });
    await PendingCardSetupStore.save(api, 'paid-setup');
    await tester.pumpWidget(_host(api));
    await tester.pumpAndSettle();
    _cleanList();
    expect(find.text('MASTERCARD •••• 1328'), findsOneWidget);
    expect(await PendingCardSetupStore.load(api), isNull);
    expect(api.creates, 0);
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
  });
  testWidgets('unresponsive card list stops loading and refreshes', (
    tester,
  ) async {
    final api = _RecoveryApi();
    final response = Completer<List<Map<String, dynamic>>>();
    api.methodsRequest = response.future;
    await tester.pumpWidget(_host(api));
    await _ready(tester);
    await tester.pump(const Duration(seconds: 9));
    await _ready(tester);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('Добавить новую карту'), findsOneWidget);
    expect(
      find.text('Не удалось загрузить сохранённые карты.'),
      findsOneWidget,
    );
    api.methodsRequest = null;
    await tester
        .widget<RefreshIndicator>(find.byType(RefreshIndicator))
        .onRefresh();
    await _ready(tester);
    expect(find.text('VISA •••• 3803'), findsOneWidget);
    response.complete([]);
    await _ready(tester);
    expect(find.text('VISA •••• 3803'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
  });
  testWidgets('typed missing setup clears only its local reference', (
    tester,
  ) async {
    final api = _RecoveryApi()
      ..cancelError = ApiException(
        'missing',
        statusCode: 404,
        code: 'FORTE_WIDGET_CARD_SETUP_NOT_FOUND',
      );
    await PendingCardSetupStore.save(api, 'missing-setup');
    await tester.pumpWidget(_host(api));
    await tester.pumpAndSettle();
    _cleanList();
    expect(await PendingCardSetupStore.load(api), isNull);
    expect(api.creates, 0);
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
  });
  testWidgets('late verified setup refresh waits for saved-card deletion', (
    tester,
  ) async {
    final verification = Completer<Map<String, dynamic>>(),
        deletion = Completer<void>();
    final api = _RecoveryApi()
      ..cancelRequest = verification.future
      ..removal = deletion;
    await PendingCardSetupStore.save(api, 'setup-one');
    await tester.pumpWidget(_host(api));
    await _ready(tester);
    await tester.tap(find.byType(PopupMenuButton<String>));
    await _ready(tester);
    await tester.tap(find.text('Удалить карту'));
    await _ready(tester);
    await tester.tap(find.widgetWithText(TextButton, 'Удалить'));
    await _ready(tester);
    expect(find.text('VISA •••• 3803'), findsNothing);
    verification.complete({
      'success': true,
      'operationId': 'setup-one',
      'paymentStatus': 'paid',
      'cardSaved': true,
      'canResume': false,
    });
    await _ready(tester);
    expect(api.methodLoads, 1);
    expect(find.text('VISA •••• 3803'), findsNothing);
    deletion.complete();
    await _ready(tester);
    expect(api.methodLoads, 2);
    expect(find.text('VISA •••• 3803'), findsNothing);
    expect(await PendingCardSetupStore.load(api), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
  });
  for (final route in ['header', 'cancelled', 'returned', 'completed']) {
    testWidgets('native card $route exit never leaves a checking modal', (
      tester,
    ) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      const id = '00000000-0000-4000-8000-000000000001';
      final api = _RecoveryApi(), bank = Completer<Map<String, dynamic>>();
      api.statusRequest = bank.future;
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
                        operationId: id,
                        cardSetup: true,
                        redirectUrl:
                            'https://bulka.com.kz/payments/forte-widget#test-token',
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
      await _ready(tester);
      expect(onReturn, isNotNull);
      if (route == 'header') {
        await _close(tester);
        onReturn!(
          Uri.parse(
            'https://bulka.com.kz/profile?payment=forte&setup=$id&status=cancelled',
          ),
        );
      } else {
        onReturn!(
          Uri.parse(
            'https://bulka.com.kz/profile?payment=forte&setup=$id&status=$route',
          ),
        );
      }
      await _ready(tester);
      if (route == 'returned' || route == 'completed') {
        expect(find.text('Проверяем карту'), findsNothing);
        await tester.pump(const Duration(seconds: 3));
        await _ready(tester);
      }
      expect(tester.takeException(), isNull);
      expect(find.text('open-card-form'), findsOneWidget);
      expect(result?.outcome, FortePaymentOutcome.pending);
      expect(result?.cancelCardSetup, isTrue);
      expect(result?.operationId, id);
      expect(
        await PendingCardSetupStore.isCancellationRequested(api, id),
        isTrue,
      );
      bank.complete({'paymentStatus': 'pending'});
      await _ready(tester);
      await tester.pumpWidget(const SizedBox.shrink());
      api.dispose();
      debugDefaultTargetPlatformOverride = null;
    });
  }
  testWidgets('successful bank return is verified before cancellation intent', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    const id = '00000000-0000-4000-8000-000000000001';
    final api = _RecoveryApi();
    ValueChanged<Uri>? onReturn;
    FortePaymentResult? result;
    await PendingCardSetupStore.save(api, id);
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: FilledButton(
              onPressed: () async {
                result = await Navigator.of(context).push<FortePaymentResult>(
                  MaterialPageRoute(
                    builder: (_) => FortePaymentScreen(
                      api: api,
                      operationId: id,
                      cardSetup: true,
                      redirectUrl:
                          'https://bulka.com.kz/payments/forte-widget#test-token',
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
    await _ready(tester);
    api.cardSaved = true;
    onReturn!(
      Uri.parse(
        'https://bulka.com.kz/profile?payment=forte&setup=$id&status=completed',
      ),
    );
    await _ready(tester);
    expect(result?.outcome, FortePaymentOutcome.paid);
    expect(result?.cancelCardSetup, isFalse);
    expect(api.cancelledIds, isEmpty);
    expect(
      await PendingCardSetupStore.isCancellationRequested(api, id),
      isFalse,
    );
    expect(find.text('Проверяем карту'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
    debugDefaultTargetPlatformOverride = null;
  });
  testWidgets(
    'late bank success refreshes cards after the cancelled form exits',
    (tester) async {
      final api = _RecoveryApi();
      await PendingCardSetupStore.save(api, 'late-setup');
      await tester.pumpWidget(_host(api));
      await tester.pumpAndSettle();
      expect(await PendingCardSetupStore.load(api), isNull);
      expect(api.cancelledIds, ['late-setup']);
      _cleanList();
      final response = Completer<List<Map<String, dynamic>>>();
      api.methodsRequest = response.future;
      api.events.add({'type': 'payment.methods.updated'});
      await _ready(tester);
      _cleanList();
      response.complete([
        ...api.methods,
        {
          'id': 'late-saved-card',
          'brand': 'mastercard',
          'lastFour': '1328',
          'isDefault': false,
        },
      ]);
      await tester.pumpAndSettle();
      _cleanList();
      expect(find.text('MASTERCARD •••• 1328'), findsOneWidget);
      expect(api.creates, 0);
      await tester.pumpWidget(const SizedBox.shrink());
      api.dispose();
    },
  );

  testWidgets('clean saved cards screen at 430 pixels', (tester) async {
    tester.view.physicalSize = const Size(430, 932);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _RecoveryApi();
    await PendingCardSetupStore.save(api, 'old-pending-record');
    await tester.runAsync(() async {
      for (final entry in {
        'MontserratBold': 'assets/fonts/Montserrat-Bold-subset.ttf',
        'Montserrat': 'assets/fonts/Montserrat-Regular-subset.ttf',
        'MaterialIcons': 'assets/fonts/BulkaIcons.ttf',
      }.entries) {
        final loader = FontLoader(entry.key)
          ..addFont(rootBundle.load(entry.value));
        await loader.load();
      }
    });
    await tester.pumpWidget(
      RepaintBoundary(key: const ValueKey('capture'), child: _host(api)),
    );
    await tester.pumpAndSettle();
    _cleanList();
    if (const String.fromEnvironment('BULKA_UI_CAPTURE_DIR').isNotEmpty) {
      final boundary = tester.renderObject<RenderRepaintBoundary>(
        find.byKey(const ValueKey('capture')),
      );
      await tester.runAsync(() async {
        final image = await boundary.toImage();
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final file = File(
          '${const String.fromEnvironment('BULKA_UI_CAPTURE_DIR')}/saved-cards-430.png',
        );
        await file.parent.create(recursive: true);
        await file.writeAsBytes(bytes!.buffer.asUint8List());
        image.dispose();
      });
    }
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
  });
}

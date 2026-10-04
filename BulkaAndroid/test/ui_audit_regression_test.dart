import 'dart:async';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _customer = Customer(
  id: 'audit-customer',
  name: 'Алия',
  phone: '77000000000',
  balance: 1200,
  totalSpent: 24000,
  createdAt: '2026-01-01T00:00:00Z',
  isVip: false,
  cashbackPercent: 5,
  vipThreshold: 300000,
  tier: null,
  emailVerified: true,
);

class _Api extends BulkaApiClient {
  Completer<void>? profileSave;
  final savedNames = <String?>[];
  bool qrUnavailable = false;
  @override
  Future<String> getQrToken(String phone) async {
    if (qrUnavailable) throw StateError('offline');
    return 'audit-only-qr';
  }

  @override
  Future<List<City>> getCities() async => [
    const City(id: 'test', name: 'Уральск'),
  ];
  @override
  Future<void> updateProfile({
    required String phone,
    String? name,
    String? lastName,
    String? gender,
    String? birthDate,
    String? email,
    String? region,
    String? avatarKey,
  }) async {
    savedNames.add(name);
    await profileSave?.future;
  }
}

class _KitchenApi extends StaffApiClient {
  final bus = StreamController<Map<String, dynamic>>.broadcast();
  final mutations = <Map<String, dynamic>>[];
  final order = <String, dynamic>{
    'id': 'audit-order',
    'number': 100012,
    'branch': 'Тест',
    'items': [
      {'name': 'Пирог', 'quantity': 2},
    ],
    'kitchenStatus': 'queued',
    'fulfillmentType': 'pickup',
    'createdAt': '2026-09-08T08:00:00Z',
  };
  @override
  Stream<Map<String, dynamic>> events({String? lastEventId}) => bus.stream;
  @override
  Future<dynamic> request(
    String endpoint, {
    String method = 'GET',
    Object? body,
    bool authenticated = true,
    Map<String, String> headers = const {},
    Map<String, String> query = const {},
  }) async {
    if (endpoint == '/scope') {
      return {'locations': <Map<String, dynamic>>[], 'selectedBranchId': null};
    }
    if (method != 'GET') {
      final mutation = Map<String, dynamic>.from(body as Map);
      mutations.add(mutation);
      order['kitchenStatus'] = mutation['status'];
      return {'order': Map<String, dynamic>.from(order)};
    }
    return {
      'orders': [Map<String, dynamic>.from(order)],
    };
  }
}

Widget _app(Widget child, {double scale = 1}) => MaterialApp(
  theme: buildBulkaTheme(),
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
    child: child!,
  ),
  home: child,
);
void _viewport(WidgetTester tester, {Size size = const Size(390, 1000)}) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Widget _login({
  Future<OtpRequestResult> Function(String, String, String)? start,
  Future<String?> Function(String, String)? verify,
  Future<OtpRequestResult> Function(String, String)? recover,
  Future<String?> Function(String, String, String)? reset,
}) => _app(
  LoginScreen(
    onLogin: (_, _) async => null,
    onStartRegistration:
        start ??
        (_, _, _) async => const OtpRequestResult(
          deliveryMode: 'automatic',
          channel: 'sms',
          codeLength: 6,
        ),
    onVerifyRegistration: verify ?? (_, _) async => null,
    onStartPasswordReset: recover ?? (_, _) async => const OtpRequestResult(),
    onResetPassword: reset ?? (_, _, _) async => null,
  ),
);
Future<void> _tap(
  WidgetTester tester,
  Finder finder, {
  bool settle = true,
}) async {
  await tester.pump();
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
  }
}

Future<void> _startRegistration(
  WidgetTester tester, {
  bool settle = false,
}) async {
  await _tap(tester, find.byKey(const ValueKey('create-account-button')));
  await tester.enterText(
    find.byKey(const ValueKey('auth-phone-field')),
    '7012345678',
  );
  await tester.enterText(
    find.byKey(const ValueKey('auth-password-field')),
    'Register2026',
  );
  await tester.enterText(
    find.byKey(const ValueKey('auth-confirm-password-field')),
    'Register2026',
  );
  await _tap(tester, find.text('Подтвердить номер'), settle: settle);
}

Widget _profile(_Api api, {VoidCallback? back}) => PersonalDataScreen(
  api: api,
  customer: _customer,
  onBack: back ?? () {},
  onLogout: () async {},
  onProfileUpdated: () async {},
);

void main() {
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({'staffKitchenSound': false});
  });

  testWidgets(
    'cancelled registration cannot reopen OTP after a delayed response',
    (tester) async {
      _viewport(tester);
      final pending = Completer<OtpRequestResult>();
      await tester.pumpWidget(_login(start: (_, _, _) => pending.future));
      await _startRegistration(tester);
      await _tap(tester, find.text('Вернуться ко входу'));
      pending.complete(const OtpRequestResult());
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('auth-otp-field')), findsNothing);
      expect(
        find.byKey(const ValueKey('create-account-button')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('auth-confirm-password-field')),
        findsNothing,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'old registration response cannot stop or replace a new pending request',
    (tester) async {
      _viewport(tester);
      final old = Completer<OtpRequestResult>(),
          current = Completer<OtpRequestResult>();
      var calls = 0;
      await tester.pumpWidget(
        _login(start: (_, _, _) => ++calls == 1 ? old.future : current.future),
      );
      await _startRegistration(tester);
      await _tap(tester, find.text('Вернуться ко входу'));
      await _startRegistration(tester);
      old.complete(const OtpRequestResult(error: 'old failure'));
      await tester.pump();
      expect(find.byKey(const ValueKey('auth-otp-field')), findsNothing);
      expect(find.text('old failure'), findsNothing);
      expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('auth-phone-field')))
            .enabled,
        false,
      );
      current.complete(
        const OtpRequestResult(
          deliveryMode: 'automatic',
          channel: 'sms',
          codeLength: 6,
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('auth-otp-field')), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('changing phone cancels delayed OTP verification', (
    tester,
  ) async {
    _viewport(tester);
    final verification = Completer<String?>();
    await tester.pumpWidget(_login(verify: (_, _) => verification.future));
    await _startRegistration(tester, settle: true);
    final otpInput = find.descendant(
      of: find.byKey(const ValueKey('auth-otp-field')),
      matching: find.byType(EditableText),
    );
    await tester.enterText(otpInput, '123456');
    await tester.pump();
    await _tap(tester, find.text('Изменить номер'));
    await tester.enterText(
      find.byKey(const ValueKey('auth-phone-field')),
      '7010000000',
    );
    verification.complete(null);
    await tester.pumpAndSettle();
    expect(find.text('Подтвердить номер'), findsOneWidget);
    expect(find.byKey(const ValueKey('auth-otp-field')), findsNothing);
    expect(find.text('Согласен с условиями'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('cancelled recovery cannot reopen OTP after a delayed response', (
    tester,
  ) async {
    _viewport(tester);
    final pending = Completer<OtpRequestResult>();
    await tester.pumpWidget(_login(recover: (_, _) => pending.future));
    await _tap(tester, find.byKey(const ValueKey('forgot-password-button')));
    await tester.enterText(
      find.byKey(const ValueKey('auth-phone-field')),
      '7012345678',
    );
    final button = find.byType(GradientButton);
    await _tap(tester, button, settle: false);
    await _tap(tester, find.text('Вернуться ко входу'));
    pending.complete(const OtpRequestResult());
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('auth-otp-field')), findsNothing);
    expect(find.byKey(const ValueKey('create-account-button')), findsOneWidget);
  });

  testWidgets(
    'password reset submission prevents misleading cancellation and unlocks after error',
    (tester) async {
      _viewport(tester);
      final pending = Completer<String?>();
      await tester.pumpWidget(_login(reset: (_, _, _) => pending.future));
      await _tap(tester, find.byKey(const ValueKey('forgot-password-button')));
      await tester.enterText(
        find.byKey(const ValueKey('auth-phone-field')),
        '7012345678',
      );
      await _tap(tester, find.byType(GradientButton));
      final otpInput = find.descendant(
        of: find.byKey(const ValueKey('auth-otp-field')),
        matching: find.byType(EditableText),
      );
      await tester.enterText(otpInput, '1234');
      await tester.enterText(
        find.byKey(const ValueKey('auth-password-field')),
        'Reset2026',
      );
      await tester.enterText(
        find.byKey(const ValueKey('auth-confirm-password-field')),
        'Reset2026',
      );
      await _tap(tester, find.byType(GradientButton), settle: false);
      final changePhone = find.widgetWithText(TextButton, 'Изменить номер');
      expect(tester.widget<TextButton>(changePhone).onPressed, isNull);
      expect(
        tester
            .widget<TextField>(
              find.byKey(const ValueKey('auth-password-field')),
            )
            .enabled,
        false,
      );
      pending.complete('bad code');
      await tester.pumpAndSettle();
      expect(find.text('bad code'), findsOneWidget);
      expect(tester.widget<TextButton>(changePhone).onPressed, isNotNull);
      await _tap(tester, changePhone);
      expect(find.byKey(const ValueKey('auth-phone-field')), findsOneWidget);
      expect(find.byKey(const ValueKey('auth-otp-field')), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'profile Save locks edits and navigation, then preserves fields on failure',
    (tester) async {
      _viewport(tester);
      final pending = Completer<void>();
      final api = _Api()..profileSave = pending;
      var closed = 0;
      await tester.pumpWidget(_app(_profile(api, back: () => closed++)));
      await tester.pumpAndSettle();
      await _tap(tester, find.text('Сохранить'), settle: false);
      expect(api.savedNames, ['Алия']);
      for (final field in tester.widgetList<TextField>(
        find.byType(TextField),
      )) {
        expect(field.enabled, false);
      }
      expect(
        tester
            .widget<IconButton>(
              find.byKey(const ValueKey('personal-data-back')),
            )
            .onPressed,
        isNull,
      );
      expect(
        tester
            .widget<PopScope<void>>(
              find.byKey(const ValueKey('personal-data-pop-scope')),
            )
            .canPop,
        false,
      );
      pending.completeError(StateError('offline'));
      await tester.pumpAndSettle();
      expect(closed, 0);
      expect(
        tester
            .widget<IconButton>(
              find.byKey(const ValueKey('personal-data-back')),
            )
            .onPressed,
        isNotNull,
      );
      final name = find.byWidgetPredicate(
        (w) => w is TextField && w.controller?.text == 'Алия',
      );
      expect(tester.widget<TextField>(name).enabled, true);
      await tester.ensureVisible(name);
      await tester.enterText(name, 'Новое имя');
      api.profileSave = null;
      await _tap(tester, find.text('Сохранить'));
      expect(api.savedNames, ['Алия', 'Новое имя']);
      expect(closed, 1);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      api.dispose();
    },
  );

  testWidgets('profile completion after leaving cannot navigate again', (
    tester,
  ) async {
    _viewport(tester);
    final pending = Completer<void>();
    final api = _Api()..profileSave = pending;
    var closed = 0;
    await tester.pumpWidget(_app(_profile(api, back: () => closed++)));
    await tester.pumpAndSettle();
    await _tap(tester, find.text('Сохранить'), settle: false);
    await tester.pumpWidget(const SizedBox());
    pending.complete();
    await tester.pumpAndSettle();
    expect(closed, 0);
    expect(tester.takeException(), isNull);
    api.dispose();
  });

  for (final language in ['ru', 'kk', 'en']) {
    testWidgets('personal data fits 320px with 200 percent text in $language', (
      tester,
    ) async {
      _viewport(tester, size: const Size(320, 1000));
      appLanguageNotifier.value = language;
      final api = _Api();
      await tester.pumpWidget(_app(_profile(api), scale: 2));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final fields = find.byType(TextField);
      final nameRect = tester.getRect(fields.at(0)),
          surnameRect = tester.getRect(fields.at(1));
      expect(surnameRect.top, greaterThan(nameRect.bottom));
      for (var i = 0; i < fields.evaluate().length; i++) {
        final rect = tester.getRect(fields.at(i));
        expect(rect.left, greaterThanOrEqualTo(0));
        expect(rect.right, lessThanOrEqualTo(320));
      }
      await tester.pumpWidget(const SizedBox());
      api.dispose();
    });
  }

  for (final role in ['operator', 'editor', 'cashier']) {
    testWidgets(
      '$role workspace accepts kitchen orders without kitchen cancellation',
      (tester) async {
        _viewport(tester);
        final api = _KitchenApi();
        await tester.pumpWidget(
          _app(
            StaffWorkspace(
              api: api,
              user: {
                'username': 'Fixture',
                'role': role,
                'actions': ['*'],
              },
              onLogout: () async {},
            ),
          ),
        );
        await tester.pumpAndSettle();
        final kitchen = tester.widget<StaffKitchen>(find.byType(StaffKitchen));
        expect(kitchen.canEdit, true);
        expect(kitchen.canCancel, false);
        expect(kitchen.canReviewDelivery, role == 'cashier');
        if (role == 'cashier') {
          expect(staffCanCancelOrders(role), true);
        }
        expect(find.widgetWithText(TextButton, 'Отменить'), findsNothing);
        await _tap(tester, find.widgetWithText(FilledButton, 'Принять заказ'));
        expect(find.byType(AlertDialog), findsOneWidget);
        await tester.enterText(find.byType(TextFormField), '20');
        await _tap(
          tester,
          find.descendant(
            of: find.byType(AlertDialog),
            matching: find.byType(FilledButton),
          ),
        );
        expect(api.mutations.single, {
          'status': 'preparing',
          'preparationMinutes': 20,
        });
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        await api.bus.close();
        api.close();
      },
    );
  }

  testWidgets(
    'kitchen cannot review delivery resolution without the review permission',
    (tester) async {
      _viewport(tester);
      final api = _KitchenApi();
      api.order['deliveryResolution'] = {
        'id': 'resolution',
        'status': 'pickup_pending_approval',
      };
      await tester.pumpWidget(
        _app(
          Scaffold(
            body: StaffKitchen(
              api: api,
              canEdit: true,
              canReviewDelivery: false,
              canCancel: true,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.widgetWithText(FilledButton, 'Принять заказ'), findsNothing);
      expect(api.mutations, isEmpty);
      for (final button in tester.widgetList<FilledButton>(
        find.byType(FilledButton),
      )) {
        expect(button.onPressed, isNull);
      }
      await tester.pumpWidget(const SizedBox());
      await api.bus.close();
      api.close();
    },
  );

  for (final size in [const Size(844, 390), const Size(320, 700)]) {
    testWidgets(
      'QR remains readable and Wallet reachable at $size with large text',
      (tester) async {
        _viewport(tester, size: size);
        final api = _Api();
        await tester.pumpWidget(
          _app(
            Scaffold(
              body: QrDialog(api: api, customer: _customer, heroTag: 'audit'),
            ),
            scale: 2,
          ),
        );
        await tester.pump(const Duration(milliseconds: 300));
        expect(tester.takeException(), isNull);
        expect(
          tester.getSize(find.byKey(const ValueKey('customer-qr-code'))).width,
          greaterThanOrEqualTo(180),
        );
        expect(find.byType(QrImageView), findsOneWidget);
        expect(
          find.byWidgetPredicate(
            (w) =>
                w is Image &&
                w.image is AssetImage &&
                (w.image as AssetImage).assetName == 'assets/brand/qr_logo.png',
          ),
          findsOneWidget,
        );
        final wallet = find.textContaining('Google Wallet');
        await tester.ensureVisible(wallet);
        await tester.pump();
        expect(
          tester.getRect(wallet).bottom,
          lessThanOrEqualTo(size.height - 24),
        );
        expect(
          tester.getRect(find.byIcon(Icons.close_rounded)).top,
          greaterThanOrEqualTo(0),
        );
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        api.dispose();
      },
    );
  }

  testWidgets('QR failure and retry fit landscape with large text', (
    tester,
  ) async {
    _viewport(tester, size: const Size(844, 390));
    final api = _Api()..qrUnavailable = true;
    await tester.pumpWidget(
      _app(
        Scaffold(
          body: QrDialog(api: api, customer: _customer, heroTag: 'audit'),
        ),
        scale: 2,
      ),
    );
    await tester.pump(const Duration(milliseconds: 300));
    expect(tester.takeException(), isNull);
    api.qrUnavailable = false;
    await _tap(tester, find.widgetWithText(TextButton, 'Повторить'));
    expect(find.byType(QrImageView), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    api.dispose();
  });
}

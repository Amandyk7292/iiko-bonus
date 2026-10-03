import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:bulka_bonus/core/cashier_invite.dart';
import 'package:bulka_bonus/core/cashier_qr_decoder.dart';
import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:bulka_bonus/core/referral_link.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:image/image.dart' as img;
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:zxing2/qrcode.dart';

const token =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const inviteUrl = 'https://bulka.com.kz/cashier-register?cashier=$token';

class _InvitationShellApi extends BulkaApiClient {
  _InvitationShellApi({this.authenticated = false})
    : super(
        client: MockClient((_) async => http.Response('{"success":true}', 200)),
      );

  final bool authenticated;

  @override
  bool get isAuthenticated => authenticated;

  @override
  Stream<Map<String, dynamic>> get customerEvents => const Stream.empty();
}

img.Image qrPhoto(String content) {
  final matrix = Encoder.encode(content, ErrorCorrectionLevel.h).matrix!;
  const scale = 6;
  const quiet = 4;
  final image = img.Image(
    width: (matrix.width + quiet * 2) * scale,
    height: (matrix.height + quiet * 2) * scale,
  );
  img.fill(image, color: img.ColorRgb8(255, 255, 255));
  for (var y = 0; y < matrix.height; y++) {
    for (var x = 0; x < matrix.width; x++) {
      if (matrix.get(x, y) == 1) {
        img.fillRect(
          image,
          x1: (x + quiet) * scale,
          y1: (y + quiet) * scale,
          x2: (x + quiet + 1) * scale - 1,
          y2: (y + quiet + 1) * scale - 1,
          color: img.ColorRgb8(0, 0, 0),
        );
      }
    }
  }
  return image;
}

Future<void> registrationForm(WidgetTester tester) async {
  await tester.ensureVisible(
    find.byKey(const ValueKey('create-account-button')),
  );
  await tester.tap(find.byKey(const ValueKey('create-account-button')));
  await tester.pumpAndSettle();
  await tester.enterText(
    find.byKey(const ValueKey('auth-phone-field')),
    '7001234567',
  );
  await tester.enterText(
    find.byKey(const ValueKey('auth-password-field')),
    'Register2026',
  );
  await tester.enterText(
    find.byKey(const ValueKey('auth-confirm-password-field')),
    'Register2026',
  );
  await tester.ensureVisible(find.text('Подтвердить номер'));
  await tester.tap(find.text('Подтвердить номер'));
  await tester.pumpAndSettle();
  await tester.enterText(find.byKey(const ValueKey('auth-otp-field')), '1234');
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

Widget loginApp({
  required ValueChanged<String?> onSubmitted,
  Future<CashierInviteDetails> Function(String)? lookup,
  Future<String?> Function()? scan,
  Future<String?> Function(String, String)? verify,
  double textScale = 1,
  bool startRegistration = false,
}) => MaterialApp(
  theme: buildBulkaTheme(),
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(
      context,
    ).copyWith(textScaler: TextScaler.linear(textScale)),
    child: child!,
  ),
  home: LoginScreen(
    startRegistration: startRegistration,
    onLogin: (_, _) async => null,
    onStartRegistration: (_, _, _) async => const OtpRequestResult(),
    onVerifyRegistration: verify ?? (_, _) async => null,
    onStartPasswordReset: (_, _) async => const OtpRequestResult(),
    onResetPassword: (_, _, _) async => null,
    onScanCashierInvite: scan,
    onLookupCashierInvite: lookup,
    onRegister:
        ({
          required phone,
          required name,
          surname,
          gender,
          birthdate,
          email,
          cashierInviteToken,
        }) async {
          onSubmitted(cashierInviteToken);
          return null;
        },
  ),
);

Future<void> submitProfile(WidgetTester tester) async {
  final name = find.widgetWithText(TextField, 'Имя');
  await tester.ensureVisible(name);
  await tester.enterText(name, 'Покупатель');
  await tester.ensureVisible(find.byType(CheckboxListTile));
  await tester.tap(find.byType(CheckboxListTile));
  await tester.ensureVisible(find.text('Далее'));
  await tester.tap(find.text('Далее'));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    PendingCashierInvite.tokenNotifier.value = null;
    appLanguageNotifier.value = 'ru';
    clientRouteNotifier.value = Uri(path: '/');
  });

  tearDown(() => clientRouteNotifier.value = Uri(path: '/'));

  test(
    'invitation parser accepts the web-only path and preserves trusted profile compatibility',
    () {
      expect(PendingCashierInvite.tokenFromUri(Uri.parse(inviteUrl)), token);
      expect(
        PendingCashierInvite.tokenFromUri(
          Uri.parse('https://bulka.com.kz/profile?cashier=$token'),
        ),
        token,
      );
      expect(
        PendingCashierInvite.tokenFromUri(
          Uri.parse('bulka://profile?cashier=$token'),
        ),
        token,
      );
      for (final invalid in [
        'http://bulka.com.kz/profile?cashier=$token',
        'https://evil.example/profile?cashier=$token',
        'https://bulka.com.kz.evil.example/profile?cashier=$token',
        'https://bulka.com.kz:444/profile?cashier=$token',
        'https://someone@bulka.com.kz/profile?cashier=$token',
        'https://bulka.com.kz/catalog?cashier=$token',
        'https://bulka.com.kz/profile?cashier=123',
        'https://bulka.com.kz/profile?cashier=$token&cashier=$token',
        'http://bulka.com.kz/cashier-register?cashier=$token',
        'https://evil.example/cashier-register?cashier=$token',
        'https://bulka.com.kz/cashier-register/extra?cashier=$token',
        'https://bulka.com.kz/cashier-register?cashier=$token&cashier=$token',
      ]) {
        expect(
          PendingCashierInvite.tokenFromUri(Uri.parse(invalid)),
          isNull,
          reason: invalid,
        );
      }
    },
  );

  testWidgets('cashier invitation can open directly in registration mode', (
    tester,
  ) async {
    await tester.pumpWidget(
      loginApp(onSubmitted: (_) {}, startRegistration: true),
    );
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('auth-confirm-password-field')),
      findsOneWidget,
    );
    expect(find.text('Подтвердить номер'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('cashier-registration-field')),
      findsNothing,
    );
    expect(tester.takeException(), isNull);
  });

  for (final scenario in [
    (name: 'guest', query: token, authenticated: false, opens: 1),
    (name: 'existing account', query: token, authenticated: true, opens: 0),
    (name: 'invalid token', query: 'invalid', authenticated: false, opens: 0),
  ]) {
    testWidgets(
      'web-only cashier route selects profile for ${scenario.name} and opens only valid guest registration',
      (tester) async {
        clientRouteNotifier.value = Uri.parse(
          'https://bulka.com.kz/cashier-register?cashier=${scenario.query}',
        );
        final api = _InvitationShellApi(
          authenticated: scenario.authenticated,
        );
        final cart = CartProvider();
        await cart.restored;
        addTearDown(() async {
          await tester.pumpWidget(const SizedBox.shrink());
          api.dispose();
          cart.dispose();
        });
        var authRequests = 0;
        await tester.pumpWidget(
          ChangeNotifierProvider.value(
            value: cart,
            child: MaterialApp(
              theme: buildBulkaTheme(),
              home: MainShell(
                api: api,
                customer: null,
                transactions: const [],
                onLogout: () async {},
                onRefreshProfile: () async {},
                onRequireAuth: () async {
                  authRequests++;
                  return false;
                },
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(authRequests, scenario.opens);
        expect(
          find.byKey(const PageStorageKey('guest-profile-tab')).hitTestable(),
          findsOneWidget,
        );
        expect(clientRouteNotifier.value.path, '/cashier-register');
        expect(tester.takeException(), isNull);
      },
    );
  }

  test(
    'pending attribution expires and never survives an existing account',
    () async {
      final now = DateTime.utc(2026, 10, 3, 12);
      await PendingCashierInvite.setToken(token, now: now);
      expect(
        await PendingCashierInvite.read(now: now.add(const Duration(days: 29))),
        token,
      );
      expect(
        await PendingCashierInvite.read(now: now.add(const Duration(days: 30))),
        isNull,
      );
      expect(
        (await SharedPreferences.getInstance()).containsKey(
          PendingCashierInvite.key,
        ),
        isFalse,
      );
      await PendingCashierInvite.capture(Uri.parse(inviteUrl));
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('phone', '+77001234567');
      expect(await PendingCashierInvite.read(), isNull);
      await PendingCashierInvite.capture(Uri.parse(inviteUrl));
      expect(prefs.containsKey(PendingCashierInvite.key), isFalse);
    },
  );

  test(
    'camera decoder reads a known PNG and rotated JPEG without a network',
    () {
      final image = qrPhoto(inviteUrl);
      expect(decodeCashierInviteQr(img.encodePng(image)), inviteUrl);
      expect(
        decodeCashierInviteQr(
          img.encodeJpg(img.copyRotate(image, angle: 90), quality: 90),
        ),
        inviteUrl,
      );
      expect(decodeCashierInviteQr(Uint8List.fromList([1, 2, 3])), isNull);
      expect(decodeCashierInviteQr(Uint8List(12 * 1024 * 1024 + 1)), isNull);
    },
  );

  test(
    'public lookup verifies returned identity and registration keeps referral types separate',
    () async {
      await PendingReferral.set('BULKA-ABCD1234');
      await PendingCashierInvite.setToken(token);
      Map<String, dynamic>? submitted;
      final api = BulkaApiClient(
        client: MockClient((request) async {
          if (request.url.path == '/api/public/cashier-invites/$token') {
            return http.Response(
              jsonEncode({
                'success': true,
                'inviteToken': token,
                'cashier': {
                  'name': 'Данияр',
                  'branchName': '19А',
                  'city': 'Актау',
                },
              }),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            );
          }
          expect(request.url.path, '/api/auth/register');
          submitted = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response(
            jsonEncode({'success': true, 'exists': false}),
            200,
          );
        }),
      );
      final cashier = await api.getCashierInvite(token);
      expect(cashier.name, 'Данияр');
      expect(cashier.location, 'Актау · 19А');
      await api.registerCustomer(
        phone: '+77001234567',
        name: 'Клиент',
        registrationToken: 'otp-proof',
        cashierInviteToken: cashier.token,
      );
      expect(submitted!['cashierInviteToken'], token);
      expect(submitted!['referralCode'], 'BULKA-ABCD1234');
      expect(await PendingCashierInvite.read(), isNull);
      api.dispose();
    },
  );

  testWidgets(
    'help is optional and appears only after a new account verifies OTP',
    (tester) async {
      String? submitted = 'not submitted';
      await tester.pumpWidget(
        loginApp(onSubmitted: (value) => submitted = value),
      );
      expect(
        find.byKey(const ValueKey('cashier-registration-field')),
        findsNothing,
      );
      await registrationForm(tester);
      expect(find.text('Мне помог сотрудник'), findsOneWidget);
      await submitProfile(tester);
      expect(submitted, isNull);
    },
  );

  testWidgets(
    'scanner selects a cashier and passes only the confirmed invite token',
    (tester) async {
      String? submitted;
      await tester.pumpWidget(
        loginApp(
          onSubmitted: (value) => submitted = value,
          scan: () async => inviteUrl,
          lookup: (value) async => CashierInviteDetails(
            token: value,
            name: 'Данияр',
            branchName: '19А',
            city: 'Актау',
          ),
        ),
      );
      await registrationForm(tester);
      await tester.ensureVisible(
        find.byKey(const ValueKey('cashier-invite-scan')),
      );
      await tester.tap(find.byKey(const ValueKey('cashier-invite-scan')));
      await tester.pumpAndSettle();
      expect(find.text('Данияр'), findsOneWidget);
      expect(find.text('Актау · 19А'), findsOneWidget);
      await submitProfile(tester);
      expect(submitted, token);
    },
  );

  testWidgets(
    'removal during lookup ignores the late reply and permits ordinary registration',
    (tester) async {
      final lookup = Completer<CashierInviteDetails>();
      String? submitted = 'not submitted';
      await PendingCashierInvite.setToken(token);
      await tester.pumpWidget(
        loginApp(
          onSubmitted: (value) => submitted = value,
          lookup: (_) => lookup.future,
        ),
      );
      await registrationForm(tester);
      await tester.ensureVisible(
        find.byKey(const ValueKey('cashier-invite-remove')),
      );
      await tester.tap(find.byKey(const ValueKey('cashier-invite-remove')));
      await tester.pump();
      lookup.complete(
        const CashierInviteDetails(token: token, name: 'Старый ответ'),
      );
      await tester.pumpAndSettle();
      expect(find.text('Старый ответ'), findsNothing);
      await submitProfile(tester);
      expect(submitted, isNull);
    },
  );

  testWidgets(
    'unavailable employee can be removed without blocking registration',
    (tester) async {
      String? submitted = 'not submitted';
      await tester.pumpWidget(
        loginApp(
          onSubmitted: (value) => submitted = value,
          scan: () async => inviteUrl,
          lookup: (_) async => throw ApiException('Archived'),
        ),
      );
      await registrationForm(tester);
      await tester.ensureVisible(
        find.byKey(const ValueKey('cashier-invite-scan')),
      );
      await tester.tap(find.byKey(const ValueKey('cashier-invite-scan')));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'QR сотрудника недоступен. Попробуйте снова или уберите его.',
        ),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const ValueKey('cashier-invite-remove')));
      await tester.pumpAndSettle();
      await submitProfile(tester);
      expect(submitted, isNull);
    },
  );

  testWidgets('existing-account OTP rejection cannot open referral selection', (
    tester,
  ) async {
    await tester.pumpWidget(
      loginApp(
        onSubmitted: (_) => fail('Existing account must not register'),
        verify: (_, _) async => 'Аккаунт уже существует',
      ),
    );
    await registrationForm(tester);
    expect(
      find.byKey(const ValueKey('cashier-registration-field')),
      findsNothing,
    );
    expect(find.text('Аккаунт уже существует'), findsWidgets);
  });

  testWidgets('cashier selector fits narrow screens and larger text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(loginApp(onSubmitted: (_) {}, textScale: 1.7));
    await registrationForm(tester);
    await tester.ensureVisible(
      find.byKey(const ValueKey('cashier-registration-field')),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    final bounds = tester.getRect(
      find.byKey(const ValueKey('cashier-registration-field')),
    );
    expect(bounds.left, greaterThanOrEqualTo(0));
    expect(bounds.right, lessThanOrEqualTo(320));
  });
}

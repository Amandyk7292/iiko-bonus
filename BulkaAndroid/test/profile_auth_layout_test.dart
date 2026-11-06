import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'catalog_availability_filter_test.dart' show capture, screenshot;

class ProfileApi extends BulkaApiClient {
  ProfileApi()
    : super(
        client: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'success': true,
              'items': [],
              'enabled': false,
              'balance': 0,
            }),
            200,
            headers: {'content-type': 'application/json'},
          ),
        ),
      ) {
    setSession(
      accessToken: 'fixture-token',
      refreshToken: 'fixture-refresh',
      cacheScope: 'profile-fixture',
    );
  }
  @override
  Stream<Map<String, dynamic>> get customerEvents => const Stream.empty();
}

void main() {
  for (final scale in [1.0, 1.8]) {
    testWidgets(
      'auth controls stay separated and profile prizes open, text $scale',
      (tester) async {
        appLanguageNotifier.value = 'ru';
        SharedPreferences.setMockInitialValues({});
        FlutterSecureStorage.setMockInitialValues({});
        tester.view.physicalSize = Size(scale == 1 ? 390 : 320, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        if (capture) {
          await tester.runAsync(() async {
            for (final entry in {
              'Montserrat': 'assets/fonts/Montserrat-Regular-subset.ttf',
              'MontserratBold': 'assets/fonts/Montserrat-Bold-subset.ttf',
              'MaterialIcons': 'assets/fonts/BulkaIcons.ttf',
            }.entries) {
              await (FontLoader(
                entry.key,
              )..addFont(rootBundle.load(entry.value))).load();
            }
          });
        }
        final boundary = GlobalKey();
        Widget app(Widget home) => RepaintBoundary(
          key: boundary,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: buildBulkaTheme(),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: TextScaler.linear(scale)),
              child: child!,
            ),
            home: home,
          ),
        );
        await tester.pumpWidget(
          app(
            LoginScreen(
              onLogin: (_, _) async => null,
              onStartRegistration: (_, _, _) async =>
                  throw StateError('unused'),
              onVerifyRegistration: (_, _) async => null,
              onStartPasswordReset: (_, _) async => throw StateError('unused'),
              onResetPassword: (_, _, _) async => null,
            ),
          ),
        );
        await tester.pumpAndSettle();
        final phone = find.byKey(const ValueKey('auth-method-phone'));
        final password = find.byKey(const ValueKey('auth-method-password'));
        expect(
          tester.getTopLeft(password).dx - tester.getTopRight(phone).dx,
          greaterThanOrEqualTo(8),
        );
        expect(tester.takeException(), isNull);
        await screenshot(tester, boundary, 'login-$scale');
        await tester.ensureVisible(find.text('Создать аккаунт'));
        await tester.tap(find.text('Создать аккаунт'));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await screenshot(tester, boundary, 'registration-$scale');

        await tester.pumpWidget(const SizedBox());
        final api = ProfileApi();
        addTearDown(api.dispose);
        await tester.pumpWidget(
          app(
            ProfileScreen(
              api: api,
              customer: Customer.fromJson({
                'id': 'fixture',
                'name': 'Амандык',
                'phone': '77000000000',
              }),
              transactions: const [],
              onBack: () {},
              onLogout: () async {},
              onRefreshProfile: () async {},
              onOpenOrders: () async {},
            ),
          ),
        );
        await tester.pumpAndSettle();
        final prizes = find.text('Мои призы');
        await tester.ensureVisible(prizes);
        await tester.pumpAndSettle();
        await screenshot(tester, boundary, 'profile-$scale');
        await tester.tap(prizes);
        await tester.pumpAndSettle();
        expect(find.text(fortuneText('empty')), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      },
    );
  }
}

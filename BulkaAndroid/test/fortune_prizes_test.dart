import 'dart:async';
import 'dart:convert';
import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';

const token = '0123456789abcdefghijklmnopqrstuvwxyz_ABCD';
const otherToken = 'OTHER_0123456789abcdefghijklmnopqrstuvwxyz';
const productCode = '00000000-0000-4000-8000-000000000004';
final link = Uri.parse(
  'https://bulka.com.kz/profile?register=1#fortune=$token',
);
final future = DateTime.now()
    .add(const Duration(days: 30))
    .toUtc()
    .toIso8601String();

http.Response response(Object body, [int status = 200]) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

class FortuneApi extends BulkaApiClient {
  FortuneApi(
    Future<http.Response> Function(http.Request) handler, {
    bool authenticated = true,
  }) : super(client: MockClient(handler)) {
    if (authenticated) {
      setSession(
        accessToken: 'customer-token',
        refreshToken: 'refresh',
        cacheScope: 'account-a',
      );
    }
  }
  @override
  Stream<Map<String, dynamic>> get customerEvents => const Stream.empty();
}

Future<void> mount(WidgetTester tester, BulkaApiClient api) async {
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox());
    api.dispose();
  });
  await tester.pumpWidget(
    MaterialApp(
      theme: buildBulkaTheme(),
      home: FortunePrizesScreen(api: api),
    ),
  );
  await tester.pumpAndSettle();
}

Map<String, Object?> prize({
  String kind = 'gift',
  String status = 'claimed',
}) => {
  'id': 'prize-1',
  'prizeLabel': kind == 'bonus' ? '100 бонусов' : 'Кофе в подарок',
  'prizeKind': kind,
  'status': status,
  'bonusAmount': kind == 'bonus' ? 100 : null,
  'expiresAt': future,
  'branchName': '19а ЖК Жасыл дала',
  'redemptionCode': kind == 'gift' ? productCode : null,
  if (status == 'redeemed')
    'redeemedAt': DateTime.now().toUtc().toIso8601String(),
};

void main() {
  setUp(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
    final previous = await PendingFortuneClaim.read();
    if (previous != null) await PendingFortuneClaim.clear(previous);
    appLanguageNotifier.value = 'ru';
  });
  tearDown(() async {
    final previous = await PendingFortuneClaim.read();
    if (previous != null) await PendingFortuneClaim.clear(previous);
  });

  test(
    'claim links accept only trusted fragment, preserve token without logs',
    () {
      expect(PendingFortuneClaim.tokenFromUri(link), token);
      expect(
        PendingFortuneClaim.tokenFromUri(
          Uri.parse('bulka://profile#fortune=$token'),
        ),
        token,
      );
      for (final candidate in [
        'https://other.example/profile#fortune=$token',
        'https://bulka.com.kz:444/profile#fortune=$token',
        'https://other@bulka.com.kz/profile#fortune=$token',
        'https://bulka.com.kz/profile?fortune=$token',
        'https://bulka.com.kz/catalog#fortune=$token',
        'https://bulka.com.kz/profile#fortune=$token&fortune=$otherToken',
        'https://bulka.com.kz/profile#fortune=short',
      ]) {
        expect(
          PendingFortuneClaim.tokenFromUri(Uri.parse(candidate)),
          isNull,
          reason: candidate,
        );
      }
    },
  );

  test('pending claim clear cannot discard a newer link', () async {
    await PendingFortuneClaim.capture(link);
    await PendingFortuneClaim.capture(
      Uri.parse('bulka://profile#fortune=$otherToken'),
    );
    await PendingFortuneClaim.clear(token);
    expect(await PendingFortuneClaim.read(), otherToken);
    await PendingFortuneClaim.clear(otherToken);
    expect(await PendingFortuneClaim.read(), isNull);
  });

  testWidgets(
    'claim stores prize in account and renders pickup code with deadline',
    (tester) async {
      await PendingFortuneClaim.capture(link);
      var claims = 0;
      final api = FortuneApi((request) async {
        if (request.url.path.endsWith('/claim')) {
          claims++;
          expect(request.headers['Authorization'], 'Bearer customer-token');
          expect(jsonDecode(request.body), {'claimToken': token});
          return response({'success': true, 'prize': prize()});
        }
        return response({
          'success': true,
          'items': [prize()],
        });
      });
      await mount(tester, api);
      expect(claims, 1);
      expect(await PendingFortuneClaim.read(), isNull);
      expect(find.text('Кофе в подарок'), findsOneWidget);
      expect(find.text(productCode), findsOneWidget);
      expect(find.byType(QrImageView), findsOneWidget);
      expect(find.textContaining('Заберите до'), findsOneWidget);
      expect(find.text('Бонусы начислены'), findsNothing);
    },
  );

  testWidgets('network failure retains claim and visible retry succeeds once', (
    tester,
  ) async {
    await PendingFortuneClaim.capture(link);
    var claims = 0;
    final api = FortuneApi((request) async {
      if (request.url.path.endsWith('/claim')) {
        claims++;
        if (claims == 1) {
          return response({
            'success': false,
            'code': 'FORTUNE_UNAVAILABLE',
            'error': 'Unavailable',
          }, 503);
        }
        return response({'success': true, 'prize': prize()});
      }
      return response({'success': true, 'items': []});
    });
    await mount(tester, api);
    expect(await PendingFortuneClaim.read(), token);
    expect(
      find.text('Не удалось сохранить подарок. Попробуйте ещё раз.'),
      findsOneWidget,
    );
    await tester.tap(find.text('Попробовать ещё раз'));
    await tester.pumpAndSettle();
    expect(claims, 2);
    expect(await PendingFortuneClaim.read(), isNull);
  });

  testWidgets('expired claim stops automatic retry and clears only its token', (
    tester,
  ) async {
    await PendingFortuneClaim.capture(link);
    final api = FortuneApi(
      (request) async => request.url.path.endsWith('/claim')
          ? response({
              'success': false,
              'code': 'FORTUNE_EXPIRED',
              'error': 'Expired',
            }, 409)
          : response({'success': true, 'items': []}),
    );
    await mount(tester, api);
    expect(await PendingFortuneClaim.read(), isNull);
    expect(find.text('Этот подарок больше недоступен.'), findsOneWidget);
  });

  testWidgets(
    'bonus voucher needs redemption, coalesces taps and then hides action',
    (tester) async {
      var redeems = 0;
      final done = Completer<http.Response>();
      final api = FortuneApi((request) async {
        if (request.url.path.endsWith('/redeem')) {
          redeems++;
          return done.future;
        }
        return response({
          'success': true,
          'items': [prize(kind: 'bonus')],
        });
      });
      await mount(tester, api);
      expect(find.text('Бонусы начислены'), findsNothing);
      await tester.tap(find.text('Получить 100 бонусов'));
      await tester.pump();
      await tester.tap(find.byType(ElevatedButton));
      await tester.pump();
      expect(redeems, 1);
      done.complete(
        response({
          'success': true,
          'prize': prize(kind: 'bonus', status: 'redeemed'),
        }),
      );
      await tester.pumpAndSettle();
      expect(find.text('Получить 100 бонусов'), findsNothing);
      expect(find.text('Бонусы начислены'), findsWidgets);
      expect(find.textContaining('Заберите до'), findsNothing);
    },
  );

  testWidgets('expired prize has no redemption button or usable product code', (
    tester,
  ) async {
    final expired = {
      ...prize(kind: 'bonus'),
      'status': 'expired',
      'expiresAt': '2020-01-01T00:00:00Z',
    };
    final api = FortuneApi(
      (_) async => response({
        'success': true,
        'items': [expired],
      }),
    );
    await mount(tester, api);
    expect(find.text('Срок истёк'), findsOneWidget);
    expect(find.byType(ElevatedButton), findsNothing);
  });

  testWidgets('expired product hides QR and pickup code', (tester) async {
    final expired = {...prize(), 'expiresAt': '2020-01-01T00:00:00Z'};
    final api = FortuneApi(
      (_) async => response({
        'success': true,
        'items': [expired],
      }),
    );
    await mount(tester, api);
    expect(find.text('Срок истёк'), findsOneWidget);
    expect(find.byType(QrImageView), findsNothing);
    expect(find.text(productCode), findsNothing);
  });

  testWidgets(
    'guest claim link authenticates once and opens saved account prize',
    (tester) async {
      await PendingFortuneClaim.capture(link);
      clientRouteNotifier.value = normalizedClientUri(link);
      var claims = 0;
      var authentications = 0;
      final api = FortuneApi((request) async {
        if (request.url.path.endsWith('/fortune/claim')) {
          claims++;
          expect(request.headers['Authorization'], 'Bearer customer-token');
          return response({'success': true, 'prize': prize()});
        }
        if (request.url.path.endsWith('/fortune/prizes')) {
          return response({
            'success': true,
            'items': [prize()],
          });
        }
        return response({
          'success': true,
          'cities': [],
          'locations': [],
          'orders': [],
          'products': [],
          'items': [],
          'promotions': [],
          'banners': [],
          'stories': [],
          'categories': [],
          'notifications': [],
          'unreadCount': 0,
        });
      }, authenticated: false);
      final cart = CartProvider();
      await cart.restored;
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        clientRouteNotifier.value = Uri(path: '/');
        api.dispose();
        cart.dispose();
      });
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: cart,
          child: MaterialApp(
            theme: buildBulkaTheme(),
            home: MainShell(
              initialTab: 4,
              api: api,
              customer: null,
              transactions: const [],
              onLogout: () async {},
              onRefreshProfile: () async {},
              onRequireAuth: () async {
                authentications++;
                api.setSession(
                  accessToken: 'customer-token',
                  refreshToken: 'refresh',
                  cacheScope: 'account-a',
                );
                return true;
              },
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(authentications, 1);
      expect(claims, 1);
      expect(find.byType(FortunePrizesScreen), findsOneWidget);
      expect(find.text('Кофе в подарок'), findsOneWidget);
      expect(await PendingFortuneClaim.read(), isNull);
      expect(tester.takeException(), isNull);
    },
  );
}

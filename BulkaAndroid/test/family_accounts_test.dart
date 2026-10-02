import 'dart:async';
import 'dart:convert';
import 'dart:io' as io;
import 'dart:ui' as ui;
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _childId = 'bd648ffb-b4a3-4bf4-9c1e-582663f1f171';
const _childPhone = 'family:$_childId';
const _captureUi = bool.fromEnvironment('BULKA_FAMILY_UI_CAPTURE');
// Production token shape with a deliberate fake signature; cannot authorize a sale.
const _childQrProof =
    'BULKA-FAMILY:$_childId:1:l:1790935500:0123456789abcdef0123456789abcdef';
Map<String, dynamic> _childJson() => {
  'id': _childId,
  'phone': _childPhone,
  'name': 'Алина',
  'balance': 1800,
  'isFamilyChild': true,
  'family': {
    'ownerName': 'Амандық',
    'memberId': _childId,
    'relation': 'child',
    'dailyLimit': 2000,
    'remainingToday': 1500,
  },
};
http.Response _json(Object body, {int status = 200}) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);
Widget _app(Widget home, {double scale = 1}) => MaterialApp(
  theme: buildBulkaTheme(),
  home: home,
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
    child: child!,
  ),
);

Future<void> _loadCaptureFonts(WidgetTester tester) async {
  if (!_captureUi) return;
  await tester.runAsync(() async {
    final regular = FontLoader('Montserrat')
      ..addFont(rootBundle.load('assets/fonts/Montserrat-Regular-subset.ttf'));
    final bold = FontLoader('MontserratBold')
      ..addFont(rootBundle.load('assets/fonts/Montserrat-Bold-subset.ttf'));
    final configFile = io.File('.dart_tool/package_config.json').absolute;
    final config = jsonDecode(await configFile.readAsString()) as Map;
    final flutterPackage = (config['packages'] as List).cast<Map>().firstWhere(
      (package) => package['name'] == 'flutter',
    );
    final packageRoot = flutterPackage['rootUri'] as String;
    final flutterRoot = configFile.uri.resolve(
      packageRoot.endsWith('/') ? packageRoot : '$packageRoot/',
    );
    final iconFile = io.File.fromUri(
      flutterRoot.resolve(
        '../../bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
      ),
    );
    final icons = FontLoader('MaterialIcons')
      ..addFont(iconFile.readAsBytes().then(ByteData.sublistView));
    await regular.load();
    await bold.load();
    await icons.load();
  });
}

Future<void> _captureFamilyUi(
  WidgetTester tester,
  GlobalKey boundaryKey,
  String filename,
) async {
  if (!_captureUi) return;
  await tester.runAsync(() async {
    final context = boundaryKey.currentContext!;
    await Future.wait([
      precacheImage(
        const AssetImage('assets/brand/loyalty_background.jpg'),
        context,
      ),
      precacheImage(const AssetImage('assets/brand/qr_logo.png'), context),
    ]);
  });
  await tester.pumpAndSettle();
  await tester.runAsync(() async {
    final image =
        await (boundaryKey.currentContext!.findRenderObject()!
                as RenderRepaintBoundary)
            .toImage(pixelRatio: 2);
    final png = await image.toByteData(format: ui.ImageByteFormat.png);
    await io.Directory('outputs').create(recursive: true);
    await io.File('outputs/$filename').writeAsBytes(png!.buffer.asUint8List());
    image.dispose();
  });
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
  });

  test(
    'child identity and family wallet metadata survive cache and tier copy',
    () {
      final customer = Customer.fromJson(_childJson());
      final restored = Customer.fromJson(
        jsonDecode(jsonEncode(customer.copyWith().toJson())),
      );
      expect(restored.isFamilyChild, isTrue);
      expect(restored.phone, _childPhone);
      expect(restored.family?['remainingToday'], 1500);
      expect(
        matchesCurrentAvatarSave(
          currentCustomer: restored,
          savedPhone: _childPhone,
          apiSessionPhone: _childPhone,
          customerId: _childId,
          phone: _childId.replaceAll(RegExp(r'\D'), ''),
        ),
        isFalse,
      );
    },
  );

  test(
    'child uses dedicated profile and QR endpoints; no orders, cards, referrals, events or FCM calls',
    () async {
      final paths = <String>[];
      final api = BulkaApiClient(
        client: MockClient((request) async {
          paths.add(request.url.path);
          if (request.url.path == '/api/family-child/profile') {
            expect(request.method, 'GET');
            return _json({
              'success': true,
              'exists': true,
              'customer': _childJson(),
            });
          }
          expect(request.url.path, '/api/family-child/qr');
          expect(jsonDecode(request.body)['purpose'], 'payment');
          return _json({
            'success': true,
            'token': 'BULKA-FAMILY:proof',
            'expiresAt': DateTime.now()
                .add(const Duration(minutes: 4))
                .millisecondsSinceEpoch,
          });
        }),
      );
      api.setSession(
        accessToken: 'child-token',
        refreshToken: 'FCH-refresh',
        cacheScope: _childPhone,
      );
      addTearDown(api.dispose);
      final events = api.customerEvents.listen((_) {});
      addTearDown(events.cancel);
      expect(
        (await api.getProfile(_childPhone)).customer?.isFamilyChild,
        isTrue,
      );
      expect(
        (await api.getProfileWithoutRefresh(_childPhone)).customer?.phone,
        _childPhone,
      );
      await api.getFamilyQr(payment: true);
      await api.recordAnalyticsEvents([
        {'type': 'app_open'},
      ]);
      await api.registerFcmToken(
        'token',
        platform: 'ios',
        installationId: 'test',
      );
      await api.clearFcmToken(installationId: 'test');
      await PushNotifications.register(api);
      await PushNotifications.requestCustomerPermissionAfterSignIn(api);
      expect(await PushNotifications.unregister(api), isTrue);
      await expectLater(
        api.getCustomerOrders(),
        throwsA(
          isA<ApiException>().having(
            (e) => e.code,
            'code',
            'FAMILY_CHILD_RESTRICTED',
          ),
        ),
      );
      await expectLater(
        api.getFortePaymentMethods(),
        throwsA(
          isA<ApiException>().having(
            (e) => e.code,
            'code',
            'FAMILY_CHILD_RESTRICTED',
          ),
        ),
      );
      await Future<void>.delayed(const Duration(milliseconds: 5));
      expect(paths, [
        '/api/family-child/profile',
        '/api/family-child/profile',
        '/api/family-child/qr',
      ]);
    },
  );

  test(
    'child refresh preserves family alias and retries only the child profile',
    () async {
      var expired = true;
      final api = BulkaApiClient(
        useCookieSessionTransport: false,
        client: MockClient((request) async {
          if (request.url.path == '/api/auth/refresh') {
            expect(jsonDecode(request.body)['refreshToken'], 'FCH-refresh');
            expired = false;
            return _json({
              'accessToken': 'renewed',
              'refreshToken': 'FCH-refresh',
              'sessionIdentity': {'id': _childId, 'phone': _childPhone},
            });
          }
          expect(request.url.path, '/api/family-child/profile');
          return expired
              ? _json({'error': 'expired'}, status: 401)
              : _json({
                  'success': true,
                  'exists': true,
                  'customer': _childJson(),
                });
        }),
      );
      api.setSession(
        accessToken: 'expired',
        refreshToken: 'FCH-refresh',
        cacheScope: _childPhone,
      );
      addTearDown(api.dispose);
      final profile = await api.getProfile(_childPhone);
      expect(profile.customer?.id, _childId);
      expect(api.sessionPhone, _childPhone);
      expect(api.isFamilyChildSession, isTrue);
      expect(api.accessToken, 'renewed');
    },
  );

  testWidgets(
    'expired family QR disappears immediately while replacement is loading',
    (tester) async {
      var now = DateTime(2026, 10, 2, 10);
      var calls = 0;
      final replacement = Completer<http.Response>();
      final api = BulkaApiClient(
        client: MockClient((request) async {
          calls++;
          return calls == 1
              ? _json({
                  'success': true,
                  'token': 'BULKA-FAMILY:first',
                  'expiresAt': now
                      .add(const Duration(seconds: 2))
                      .millisecondsSinceEpoch,
                })
              : replacement.future;
        }),
      );
      addTearDown(api.dispose);
      await tester.pumpWidget(
        _app(
          Scaffold(
            body: FamilyQrWidget(api: api, now: () => now),
          ),
        ),
      );
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const ValueKey('BULKA-FAMILY:first')), findsOneWidget);
      now = now.add(const Duration(seconds: 3));
      await tester.pump(const Duration(seconds: 1));
      expect(find.byType(QrImageView), findsNothing);
      await tester.pump(const Duration(seconds: 10));
      expect(calls, 2);
      replacement.complete(
        _json({
          'success': true,
          'token': 'BULKA-FAMILY:new',
          'expiresAt': now
              .add(const Duration(minutes: 3))
              .millisecondsSinceEpoch,
        }),
      );
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const ValueKey('BULKA-FAMILY:new')), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'unavailable QR stays hidden and does not retry every timer tick',
    (tester) async {
      var calls = 0;
      final api = BulkaApiClient(
        client: MockClient((request) async {
          calls++;
          return _json({'error': 'unavailable'}, status: 503);
        }),
      );
      addTearDown(api.dispose);
      await tester.pumpWidget(_app(Scaffold(body: FamilyQrWidget(api: api))));
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 30));
      expect(calls, 1);
      expect(find.byType(QrImageView), findsNothing);
      await tester.tap(find.text('Обновить QR'));
      await tester.pumpAndSettle();
      expect(calls, 2);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'child screen has only cashier QR and wallet allowance on narrow phone in RU and KK',
    (tester) async {
      await _loadCaptureFonts(tester);
      tester.view.physicalSize = const Size(320, 780);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = BulkaApiClient(
        client: MockClient(
          (request) async => _json({
            'success': true,
            'token': _childQrProof,
            'expiresAt': DateTime.now()
                .add(const Duration(minutes: 3))
                .millisecondsSinceEpoch,
          }),
        ),
      );
      addTearDown(api.dispose);
      api.setSession(accessToken: 'child', cacheScope: _childPhone);
      for (final lang in ['ru', 'kk']) {
        final boundaryKey = GlobalKey();
        appLanguageNotifier.value = lang;
        await tester.pumpWidget(
          _app(
            RepaintBoundary(
              key: boundaryKey,
              child: FamilyChildScreen(
                key: ValueKey(lang),
                api: api,
                customer: Customer.fromJson(_childJson()),
                onLogout: () async {},
                onRefresh: () async {},
              ),
            ),
            scale: 1.3,
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byType(BottomNavigationBar), findsNothing);
        expect(find.text('Заказы'), findsNothing);
        expect(find.text('Каталог'), findsNothing);
        expect(find.byType(QrImageView), findsOneWidget);
        expect(tester.takeException(), isNull);
        await _captureFamilyUi(
          tester,
          boundaryKey,
          'family-child-320-$lang.png',
        );
      }
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'owner dashboard shows shared bonus, adults, child and pending invitation on narrow phone in RU and KK',
    (tester) async {
      await _loadCaptureFonts(tester);
      tester.view.physicalSize = const Size(320, 780);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final paths = <String>[];
      final api = BulkaApiClient(
        client: MockClient((request) async {
          paths.add(request.url.path);
          expect(request.method, 'GET');
          expect(request.url.path, '/api/customer/family');
          return _json({
            'success': true,
            'groupId': 'proof-family',
            'isOwner': true,
            'ownerName': 'Амандық',
            'sharedBalance': 8500,
            'members': [
              {
                'id': 'proof-adult-one',
                'name': 'Мария',
                'relation': 'wife',
                'isChild': false,
                'dailyLimit': 5000,
                'blocked': false,
              },
              {
                'id': 'proof-adult-two',
                'name': 'Болат',
                'relation': 'father',
                'isChild': false,
                'dailyLimit': 0,
                'blocked': true,
              },
              {
                'id': 'proof-child',
                'name': 'Алина',
                'relation': 'child',
                'isChild': true,
                'login': 'Alina.proof',
                'dailyLimit': 2000,
                'blocked': false,
              },
            ],
            'invitations': [],
            'sentInvitations': [
              {
                'id': 'proof-invitation',
                'name': 'Айгүл',
                'relation': 'sister',
                'status': 'pending',
              },
            ],
          });
        }),
      );
      addTearDown(api.dispose);
      for (final lang in ['ru', 'kk']) {
        final boundaryKey = GlobalKey();
        appLanguageNotifier.value = lang;
        await tester.pumpWidget(
          _app(
            RepaintBoundary(
              key: boundaryKey,
              child: FamilyScreen(
                key: ValueKey(lang),
                api: api,
                onRefreshProfile: () async {},
              ),
            ),
            scale: 1.3,
          ),
        );
        await tester.pumpAndSettle();
        expect(find.textContaining('8 500'), findsOneWidget);
        expect(
          find.text(lang == 'ru' ? 'Общие бонусы' : 'Ортақ бонустар'),
          findsOneWidget,
        );
        expect(find.byKey(const ValueKey('family-invite')), findsOneWidget);
        expect(find.byKey(const ValueKey('family-add-child')), findsOneWidget);
        expect(find.byType(QrImageView), findsNothing);
        expect(
          find.text(lang == 'ru' ? 'Выйти из семьи' : 'Отбасынан шығу'),
          findsNothing,
        );
        expect(tester.takeException(), isNull);
        await _captureFamilyUi(
          tester,
          boundaryKey,
          'family-owner-320-$lang.png',
        );
        for (final name in ['Мария', 'Болат', 'Алина', 'Айгүл']) {
          await tester.ensureVisible(find.text(name));
          await tester.pumpAndSettle();
          expect(find.text(name), findsOneWidget);
          expect(tester.takeException(), isNull);
        }
        expect(find.textContaining('2000 ₸'), findsOneWidget);
        expect(
          find.textContaining(
            lang == 'ru' ? 'Ожидает ответа' : 'Жауап күтілуде',
          ),
          findsOneWidget,
        );
        await _captureFamilyUi(
          tester,
          boundaryKey,
          'family-owner-members-320-$lang.png',
        );
      }
      expect(paths, ['/api/customer/family', '/api/customer/family']);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'recipient accepts invitation from existing account with clear shared bonus consent',
    (tester) async {
      var accepted = false;
      var profileRefreshes = 0;
      final api = BulkaApiClient(
        client: MockClient((request) async {
          if (request.method == 'POST') {
            expect(
              request.url.path,
              '/api/customer/family/invitations/invitation-id/answer',
            );
            expect(jsonDecode(request.body)['decision'], 'accept');
            accepted = true;
            return _json({'success': true, 'status': 'accepted'});
          }
          return _json({
            'success': true,
            'groupId': accepted ? 'group' : null,
            'isOwner': false,
            'ownerName': 'Амандық',
            'memberId': accepted ? 'member' : null,
            'members': [],
            'invitations': accepted
                ? []
                : [
                    {
                      'id': 'invitation-id',
                      'ownerName': 'Амандық',
                      'relation': 'sister',
                      'dailyLimit': 0,
                    },
                  ],
          });
        }),
      );
      addTearDown(api.dispose);
      await tester.pumpWidget(
        _app(
          FamilyScreen(
            api: api,
            onRefreshProfile: () async {
              profileRefreshes++;
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Принять'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Ваши прежние бонусы сохранятся отдельно'),
        findsOneWidget,
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Принять').last);
      await tester.pumpAndSettle();
      expect(accepted, isTrue);
      expect(profileRefreshes, 1);
      expect(find.text('Выйти из семьи'), findsOneWidget);
      expect(find.text('Пригласить взрослого'), findsNothing);
    },
  );

  testWidgets(
    'adult invite is phone plus role; no login or password is created',
    (tester) async {
      Map? sent;
      final api = BulkaApiClient(
        client: MockClient((request) async {
          sent = jsonDecode(request.body) as Map;
          return _json({'success': true});
        }),
      );
      addTearDown(api.dispose);
      await tester.pumpWidget(_app(FamilyFormScreen(api: api)));
      expect(find.text('Пароль'), findsNothing);
      await tester.enterText(
        find.byKey(const ValueKey('family-invite-phone')),
        '+7 700 123 45 67',
      );
      await tester.ensureVisible(find.text('Отправить приглашение'));
      await tester.tap(find.text('Отправить приглашение'));
      await tester.pumpAndSettle();
      expect(sent, {
        'phone': '+77001234567',
        'relation': 'wife',
        'dailyLimit': 0,
      });
    },
  );

  testWidgets(
    'parent creates child credentials and daily allowance without a customer phone',
    (tester) async {
      Map? sent;
      final api = BulkaApiClient(
        client: MockClient((request) async {
          expect(request.url.path, '/api/customer/family/children');
          sent = jsonDecode(request.body) as Map;
          return _json({'success': true});
        }),
      );
      addTearDown(api.dispose);
      await tester.pumpWidget(_app(FamilyFormScreen(api: api, child: true)));
      final fields = find.byType(TextFormField);
      await tester.enterText(fields.at(0), 'Алина');
      await tester.enterText(fields.at(1), 'Alina.bulka');
      await tester.enterText(fields.at(2), 'alina@example.test');
      await tester.enterText(fields.at(3), 'ChildPassword2026');
      await tester.enterText(fields.at(4), '2500');
      final submit = find.widgetWithText(FilledButton, 'Добавить ребёнка');
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(sent, {
        'name': 'Алина',
        'login': 'Alina.bulka',
        'email': 'alina@example.test',
        'password': 'ChildPassword2026',
        'dailyLimit': 2500,
      });
      expect(sent!.containsKey('phone'), isFalse);
      expect(sent!.containsKey('ownerCustomerId'), isFalse);
    },
  );

  testWidgets(
    'owner can block adult and set limit without changing their password',
    (tester) async {
      Map? sent;
      final api = BulkaApiClient(
        client: MockClient((request) async {
          expect(request.method, 'PATCH');
          expect(request.url.path, '/api/customer/family/members/adult-member');
          sent = jsonDecode(request.body) as Map;
          return _json({'success': true});
        }),
      );
      addTearDown(api.dispose);
      await tester.pumpWidget(
        _app(
          FamilyFormScreen(
            api: api,
            member: {
              'id': 'adult-member',
              'name': 'Мария',
              'relation': 'mother',
              'isChild': false,
              'dailyLimit': 5000,
              'blocked': false,
            },
          ),
        ),
      );
      expect(find.text('Новый пароль ребёнка'), findsNothing);
      await tester.enterText(find.byType(TextFormField), '3000');
      await tester.tap(find.byType(SwitchListTile));
      await tester.tap(find.text('Сохранить'));
      await tester.pumpAndSettle();
      expect(sent, {'dailyLimit': 3000, 'blocked': true});
    },
  );

  testWidgets('child login uses parent-issued username, not OTP or phone', (
    tester,
  ) async {
    List<String>? credentials;
    await tester.pumpWidget(
      _app(
        FamilyChildLoginScreen(
          onBack: () {},
          onLogin: (login, password) async {
            credentials = [login, password];
            return null;
          },
        ),
      ),
    );
    await tester.enterText(find.byType(TextFormField).at(0), 'Alina.bulka');
    await tester.enterText(
      find.byType(TextFormField).at(1),
      'ChildPassword2026',
    );
    expect(find.text('Телефон'), findsNothing);
    expect(find.text('Код подтверждения'), findsNothing);
    await tester.tap(find.text('Войти'));
    await tester.pumpAndSettle();
    expect(credentials, ['Alina.bulka', 'ChildPassword2026']);
  });

  testWidgets(
    'missing adult account is explained in selected language, not as network error',
    (tester) async {
      appLanguageNotifier.value = 'kk';
      final api = BulkaApiClient(
        client: MockClient(
          (request) async => _json({
            'error': 'По этому номеру нет аккаунта Bulka.',
            'code': 'FAMILY_RECIPIENT_MISSING',
          }, status: 409),
        ),
      );
      addTearDown(api.dispose);
      await tester.pumpWidget(_app(FamilyFormScreen(api: api)));
      await tester.enterText(
        find.byKey(const ValueKey('family-invite-phone')),
        '+77001234567',
      );
      await tester.ensureVisible(find.text('Шақыру жіберу'));
      await tester.tap(find.text('Шақыру жіберу'));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Бұл нөмірге Bulka аккаунты тіркелмеген. Алдымен тіркеліңіз.',
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets('family QR is invalidated when session identity changes', (
    tester,
  ) async {
    var calls = 0;
    final next = Completer<http.Response>();
    final api = BulkaApiClient(
      client: MockClient((request) async {
        calls++;
        return calls == 1
            ? _json({
                'success': true,
                'token': 'BULKA-FAMILY:old-account',
                'ttlSeconds': 300,
                'expiresAt': 0,
              })
            : next.future;
      }),
    );
    addTearDown(api.dispose);
    api.setSession(accessToken: 'first', cacheScope: _childPhone);
    await tester.pumpWidget(_app(Scaffold(body: FamilyQrWidget(api: api))));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('BULKA-FAMILY:old-account')),
      findsOneWidget,
    );
    api.setSession(
      accessToken: 'second',
      cacheScope: 'family:48c2d1e7-e6c6-4108-b2e3-5900c853dd98',
    );
    await tester.pump(const Duration(seconds: 1));
    expect(find.byType(QrImageView), findsNothing);
    next.complete(
      _json({
        'success': true,
        'token': 'BULKA-FAMILY:new-account',
        'ttlSeconds': 200,
        'expiresAt': 0,
      }),
    );
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('BULKA-FAMILY:new-account')),
      findsOneWidget,
    );
    await tester.pumpWidget(const SizedBox());
  });
}

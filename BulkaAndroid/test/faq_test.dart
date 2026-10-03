import 'dart:async';
import 'dart:convert';
import 'dart:ui' show Tristate;

import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _ruItems = [
  {
    'id': 'bonus',
    'question': 'Как начисляются бонусы?',
    'answer': 'Бонусы начисляются после покупки.\nПроверьте баланс в профиле.',
    'sortOrder': 2,
  },
  {
    'id': 'level',
    'question': 'Как повышается уровень?',
    'answer': 'Условия уровня зависят от ваших покупок.',
    'sortOrder': 1,
  },
];

const _kkItems = [
  {
    'id': 'bonus',
    'question': 'Бонустар қалай есептеледі?',
    'answer': 'Бонустар сатып алғаннан кейін есептеледі.',
    'sortOrder': 1,
  },
];

http.Response _response(List<Map<String, Object>> items) =>
    _json({'success': true, 'items': items});

http.Response _json(Map<String, Object> body, {int status = 200}) =>
    http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );

class _FaqShellApi extends BulkaApiClient {
  _FaqShellApi(http.Client superClient) : super(client: superClient);

  @override
  Stream<Map<String, dynamic>> get customerEvents => const Stream.empty();
}

Future<void> _pumpFaq(
  WidgetTester tester,
  BulkaApiClient api, {
  double textScale = 1,
  bool reducedMotion = false,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: buildBulkaTheme(),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(textScale),
          disableAnimations: reducedMotion,
        ),
        child: child!,
      ),
      home: FaqScreen(api: api),
    ),
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    appLanguageNotifier.value = 'ru';
    clientRouteNotifier.value = Uri(path: '/');
  });

  tearDown(() {
    appLanguageNotifier.value = 'ru';
    clientRouteNotifier.value = Uri(path: '/');
  });

  test(
    'public FAQ is guest-readable, sorted and cached per language',
    () async {
      final requests = <http.Request>[];
      final api = BulkaApiClient(
        client: MockClient((request) async {
          requests.add(request);
          return _response(
            request.url.queryParameters['lang'] == 'kk' ? _kkItems : _ruItems,
          );
        }),
      );
      addTearDown(api.dispose);

      final first = await api.getPublicFaq(language: 'ru');
      expect(first.map((item) => item.id), ['level', 'bonus']);
      expect(await api.getPublicFaq(language: 'ru'), same(first));
      expect(requests.length, 1);
      expect(requests.single.url.path, '/api/public/faq');
      expect(requests.single.url.queryParameters, {'lang': 'ru'});
      expect(requests.single.headers.containsKey('Authorization'), isFalse);
      expect(api.isAuthenticated, isFalse);

      expect(
        (await api.getPublicFaq(language: 'kk')).single.question,
        'Бонустар қалай есептеледі?',
      );
      expect(requests.length, 2);
      await api.getPublicFaq(language: 'en');
      expect(requests.length, 2);
      await api.getPublicFaq(language: 'ru', refresh: true);
      expect(requests.length, 3);
    },
  );

  test(
    'public FAQ shares concurrent reads and retries a failed request',
    () async {
      var reads = 0;
      var failure = true;
      final gate = Completer<void>();
      final api = BulkaApiClient(
        client: MockClient((_) async {
          reads++;
          await gate.future;
          if (failure) return _json({'success': false});
          return _response(_ruItems);
        }),
      );
      addTearDown(api.dispose);
      final first = api.getPublicFaq();
      final second = api.getPublicFaq();
      final firstCheck = expectLater(first, throwsA(isA<ApiException>()));
      final secondCheck = expectLater(second, throwsA(isA<ApiException>()));
      gate.complete();
      await Future.wait([firstCheck, secondCheck]);
      expect(reads, 1);
      failure = false;
      expect(await api.getPublicFaq(), hasLength(2));
      expect(reads, 2);
    },
  );

  test(
    'public FAQ errors cannot log a family child out or trigger refresh',
    () async {
      final requests = <http.Request>[];
      final api = BulkaApiClient(
        client: MockClient((request) async {
          requests.add(request);
          return _json({'success': false}, status: 401);
        }),
        useCookieSessionTransport: true,
      );
      addTearDown(api.dispose);
      api.setSession(
        accessToken: 'test-child-session',
        cacheScope: 'family:12345678-1234-1234-1234-123456789012',
      );
      await expectLater(api.getPublicFaq(), throwsA(isA<ApiException>()));
      expect(requests, hasLength(1));
      expect(requests.single.headers.containsKey('Authorization'), isFalse);
      expect(api.isFamilyChildSession, isTrue);
      expect(api.accessToken, 'test-child-session');
      await expectLater(api.getPersonalAccount(), throwsA(isA<ApiException>()));
      expect(requests, hasLength(1));
    },
  );

  testWidgets(
    'FAQ loads asynchronously, expands and collapses readable answers',
    (tester) async {
      final gate = Completer<http.Response>();
      final api = BulkaApiClient(client: MockClient((_) => gate.future));
      addTearDown(api.dispose);
      await _pumpFaq(tester, api);
      await tester.pump();
      expect(find.text('Загружаем вопросы…'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      gate.complete(_response(_ruItems));
      await tester.pumpAndSettle();
      expect(find.text('Частые вопросы'), findsOneWidget);
      expect(find.text('Как повышается уровень?'), findsOneWidget);
      expect(find.byKey(const ValueKey('faq-answer-level')), findsNothing);
      final semantics = tester.ensureSemantics();
      final question = find.byKey(const ValueKey('faq-question-level'));
      final semanticsKey = find.byKey(
        const ValueKey('faq-question-semantics-level'),
      );
      expect(tester.getSize(question).height, greaterThanOrEqualTo(44));
      expect(
        tester.getSemantics(semanticsKey).flagsCollection.isExpanded,
        Tristate.isFalse,
      );
      await tester.tap(question);
      await tester.pumpAndSettle();
      expect(
        find.text('Условия уровня зависят от ваших покупок.'),
        findsOneWidget,
      );
      expect(
        tester.getSemantics(semanticsKey).flagsCollection.isExpanded,
        Tristate.isTrue,
      );
      expect(find.byIcon(Icons.remove_rounded), findsOneWidget);
      await tester.tap(question);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('faq-answer-level')), findsNothing);
      expect(tester.takeException(), isNull);
      semantics.dispose();
    },
  );

  testWidgets('FAQ failure retries and refresh reloads current admin content', (
    tester,
  ) async {
    var reads = 0;
    var failure = true;
    var items = _ruItems;
    final api = BulkaApiClient(
      client: MockClient((_) async {
        reads++;
        return failure
            ? _json({'success': false}, status: 503)
            : _response(items);
      }),
    );
    addTearDown(api.dispose);
    await _pumpFaq(tester, api);
    await tester.pumpAndSettle();
    expect(
      find.text('Не удалось загрузить вопросы. Попробуйте ещё раз.'),
      findsOneWidget,
    );
    failure = false;
    await tester.tap(find.byKey(const ValueKey('faq-retry')));
    await tester.pumpAndSettle();
    expect(find.text('Как начисляются бонусы?'), findsOneWidget);
    expect(reads, 2);
    items = [];
    await tester.tap(find.byKey(const ValueKey('faq-refresh')));
    await tester.pumpAndSettle();
    expect(reads, 3);
    expect(find.text('Вопросов пока нет.'), findsOneWidget);
    expect(find.text('Как начисляются бонусы?'), findsNothing);
    items = _ruItems;
    await tester.tap(find.byKey(const ValueKey('faq-retry')));
    await tester.pumpAndSettle();
    expect(find.text('Как начисляются бонусы?'), findsOneWidget);
    expect(reads, 4);
  });

  testWidgets('language change fetches KK and ignores an older RU response', (
    tester,
  ) async {
    final russian = Completer<http.Response>();
    final kazakh = Completer<http.Response>();
    final reads = <String>[];
    final api = BulkaApiClient(
      client: MockClient((request) {
        final language = request.url.queryParameters['lang']!;
        reads.add(language);
        return language == 'kk' ? kazakh.future : russian.future;
      }),
    );
    addTearDown(api.dispose);
    await _pumpFaq(tester, api);
    appLanguageNotifier.value = 'kk';
    await tester.pump();
    kazakh.complete(_response(_kkItems));
    await tester.pumpAndSettle();
    expect(find.text('Жиі қойылатын сұрақтар'), findsOneWidget);
    expect(find.text('Бонустар қалай есептеледі?'), findsOneWidget);
    russian.complete(_response(_ruItems));
    await tester.pumpAndSettle();
    expect(find.text('Как начисляются бонусы?'), findsNothing);
    expect(reads, ['ru', 'kk']);
    await tester.tap(find.byKey(const ValueKey('faq-question-bonus')));
    await tester.pumpAndSettle();
    expect(
      find.text('Бонустар сатып алғаннан кейін есептеледі.'),
      findsOneWidget,
    );
    await tester.pumpWidget(const SizedBox.shrink());
  });

  for (final language in ['ru', 'kk']) {
    testWidgets('$language FAQ and loyalty link fit 320px with 200% text', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(320, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      appLanguageNotifier.value = language;
      final api = BulkaApiClient(
        client: MockClient(
          (_) async => _response(language == 'kk' ? _kkItems : _ruItems),
        ),
      );
      addTearDown(api.dispose);
      await _pumpFaq(tester, api, textScale: 2, reducedMotion: true);
      await tester.pumpAndSettle();
      final question = find.byKey(
        ValueKey('faq-question-${language == 'kk' ? 'bonus' : 'level'}'),
      );
      await tester.ensureVisible(question);
      await tester.tap(question);
      await tester.pump();
      expect(
        find.byKey(
          ValueKey('faq-answer-${language == 'kk' ? 'bonus' : 'level'}'),
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);

      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: Scaffold(
            body: MediaQuery(
              data: const MediaQueryData(textScaler: TextScaler.linear(2)),
              child: SingleChildScrollView(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: LoyaltyTierCard(onLearnMoreTap: () {}),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final link = find.byKey(const ValueKey('loyalty-learn-more'));
      final account = find.byKey(const ValueKey('loyalty-personal-account'));
      expect(tester.getSize(link).height, greaterThanOrEqualTo(44));
      expect(
        tester.getBottomLeft(link).dy,
        lessThanOrEqualTo(tester.getTopLeft(account).dy),
      );
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets(
    'profile loyalty link opens FAQ and keeps account action below it',
    (tester) async {
      final api = BulkaApiClient(
        client: MockClient(
          (request) async => request.url.path == '/api/public/faq'
              ? _response(_ruItems)
              : _json({'success': true, 'balance': 0}),
        ),
      );
      addTearDown(api.dispose);
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: ProfileScreen(
            api: api,
            customer: const Customer(
              id: 'customer',
              name: 'Амандык',
              phone: '77762003590',
              balance: 990148,
              totalSpent: 0,
              createdAt: '2026-09-27',
              isVip: false,
              cashbackPercent: 5,
              vipThreshold: 100000,
              tier: null,
            ),
            transactions: const [],
            onBack: () {},
            onLogout: () async {},
            onRefreshProfile: () async {},
            onOpenOrders: () async {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      final link = find.byKey(const ValueKey('loyalty-learn-more'));
      await tester.ensureVisible(link);
      final account = find.byKey(const ValueKey('loyalty-personal-account'));
      expect(
        tester.getBottomLeft(link).dy,
        lessThanOrEqualTo(tester.getTopLeft(account).dy),
      );
      await tester.tap(link);
      await tester.pumpAndSettle();
      expect(find.byType(FaqScreen), findsOneWidget);
      expect(find.text('Как начисляются бонусы?'), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.byType(FaqScreen), findsNothing);
      expect(find.byType(ProfileScreen), findsOneWidget);
    },
  );

  testWidgets(
    'direct FAQ route opens for guest and follows external back/forward',
    (tester) async {
      clientRouteNotifier.value = Uri(path: '/faq');
      final api = _FaqShellApi(
        MockClient(
          (request) async => request.url.path == '/api/public/faq'
              ? _response(_ruItems)
              : _json({'success': true}),
        ),
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
      expect(find.byType(FaqScreen), findsOneWidget);
      expect(authRequests, 0);
      applyExternalClientRoute(Uri(path: '/profile'));
      await tester.pumpAndSettle();
      expect(find.byType(FaqScreen), findsNothing);
      applyExternalClientRoute(Uri(path: '/faq'));
      await tester.pumpAndSettle();
      expect(find.byType(FaqScreen), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.byType(FaqScreen), findsNothing);
      expect(authRequests, 0);
      expect(tester.takeException(), isNull);
    },
  );
}

import 'dart:async';
import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  const cardJson = {
    'id': 'card-1',
    'displayMode': 'standard',
    'titles': {'ru': 'Булка', 'kk': 'Бөлке', 'en': 'Bulka'},
    'iconKey': 'bulka',
    'actions': [
      {
        'id': 'action-1',
        'type': 'phone',
        'labels': {'ru': 'Позвонить', 'kk': 'Қоңырау шалу', 'en': 'Call'},
        'target': '+77000000000',
        'iconKey': 'phone',
      },
    ],
  };
  const compactCardJson = {
    'id': 'card-compact',
    'displayMode': 'compact',
    'titles': {'ru': 'Дополнительно', 'kk': 'Қосымша', 'en': 'More contacts'},
    'iconKey': 'bulka',
    'actions': [
      {
        'id': 'action-instagram',
        'type': 'instagram',
        'labels': {'ru': 'Instagram', 'kk': 'Instagram', 'en': 'Instagram'},
        'target': 'https://instagram.com/bulka',
        'iconKey': 'instagram',
      },
      {
        'id': 'action-whatsapp',
        'type': 'whatsapp',
        'labels': {'ru': 'WhatsApp', 'kk': 'WhatsApp', 'en': 'WhatsApp'},
        'target': 'https://wa.me/77000000000',
        'iconKey': 'whatsapp',
      },
      {
        'id': 'action-telegram',
        'type': 'telegram',
        'labels': {'ru': 'Telegram', 'kk': 'Telegram', 'en': 'Telegram'},
        'target': 'https://t.me/bulka',
        'iconKey': 'telegram',
      },
    ],
  };

  test('headings stay Golos Text while descriptions use Montserrat', () {
    final theme = buildBulkaTheme();
    final textTheme = theme.textTheme;
    final headingStyles = <TextStyle?>[
      textTheme.displayLarge,
      textTheme.displayMedium,
      textTheme.displaySmall,
      textTheme.headlineLarge,
      textTheme.headlineMedium,
      textTheme.headlineSmall,
      textTheme.titleLarge,
      textTheme.titleMedium,
      textTheme.titleSmall,
    ];
    final descriptionStyles = <TextStyle?>[
      textTheme.bodyLarge,
      textTheme.bodyMedium,
      textTheme.bodySmall,
      textTheme.labelLarge,
      textTheme.labelMedium,
      textTheme.labelSmall,
    ];

    expect(headingStyles, everyElement(isNotNull));
    expect(
      headingStyles.map((style) => style?.fontFamily),
      everyElement('GolosText'),
    );
    expect(descriptionStyles, everyElement(isNotNull));
    expect(
      descriptionStyles.map((style) => style?.fontFamily),
      everyElement('Montserrat'),
    );

    final style = theme.appBarTheme.titleTextStyle;

    expect(style?.fontFamily, 'GolosText');
    expect(style?.fontSize, BulkaTypeScale.pageTitle);
    expect(style?.fontWeight, FontWeight.w400);
  });

  test('contact cards parse, localize, and round-trip cache data', () {
    final card = AppContactCard.fromJson(cardJson);

    expect(card.titleFor('kk'), 'Бөлке');
    expect(card.titleFor('de'), 'Булка');
    expect(card.actions.single.labelFor('en'), 'Call');
    expect(AppContactCard.fromJson(card.toJson()).toJson(), cardJson);
  });

  test('contact action URI builder allows only expected safe schemes', () {
    AppContactAction action(String type, String target) => AppContactAction(
      id: 'action',
      type: type,
      labels: const {'ru': 'Тест', 'kk': 'Тест', 'en': 'Test'},
      target: target,
      iconKey: 'link',
    );

    expect(
      contactActionUri(action('phone', '+7 700 000 00 00'))?.scheme,
      'tel',
    );
    expect(
      contactActionUri(action('email', 'hello@bulka.kz'))?.scheme,
      'mailto',
    );
    expect(
      contactActionUri(action('website', 'https://bulka.com.kz/help'))?.scheme,
      'https',
    );
    expect(contactActionUri(action('website', 'http://bulka.com.kz')), isNull);
    expect(
      contactActionUri(action('custom_url', 'javascript:alert(1)')),
      isNull,
    );
    expect(
      contactActionUri(action('custom_url', 'https://user:pass@example.com')),
      isNull,
    );
  });

  test(
    'contact repository falls back to the last valid public cache',
    () async {
      SharedPreferences.setMockInitialValues({
        'contact_center_cache_v1': jsonEncode([cardJson]),
      });
      final preferences = await SharedPreferences.getInstance();
      final client = MockClient((_) async => http.Response('offline', 503));
      final repository = ContactCenterRepository(
        api: BulkaApiClient(client: client),
        preferences: preferences,
      );

      final cards = await repository.load();

      expect(cards, hasLength(1));
      expect(cards.single.id, 'card-1');
    },
  );

  test(
    'notification payload resolves only known destinations and safe URLs',
    () {
      AppNotification notification(String type, Map<String, dynamic> payload) =>
          AppNotification(
            id: 'notification',
            title: 'Title',
            body: 'Body',
            createdAt: '2026-07-18T10:00:00Z',
            isRead: false,
            type: type,
            payload: payload,
          );

      final exactOrder = resolveNotificationTarget(
        notification('order_status', {'orderId': 'order-1'}),
      );
      expect(exactOrder.kind, NotificationTargetKind.order);
      expect(exactOrder.resourceId, 'order-1');
      expect(
        resolveNotificationTarget(
          notification('broadcast', {'destination': 'promos'}),
        ).kind,
        NotificationTargetKind.promos,
      );
      expect(
        resolveNotificationTarget(
          notification('support_reply', {'supportId': 'support-1'}),
        ).kind,
        NotificationTargetKind.support,
      );
      expect(
        resolveNotificationTarget(
          notification('broadcast', {'url': 'https://bulka.com.kz/news'}),
        ).uri?.host,
        'bulka.com.kz',
      );
      expect(
        resolveNotificationTarget(
          notification('broadcast', {'url': 'javascript:alert(1)'}),
        ).kind,
        NotificationTargetKind.notifications,
      );
    },
  );

  test(
    'system notifications localize existing history in all three languages',
    () {
      final ready = AppNotification.fromJson({
        'id': 'notification-ready',
        'title': 'Заказ готов',
        'body': 'Заказ №100016 готов к выдаче.',
        'type': 'order',
        'payload': {'orderNumber': 100016},
        'created_at': '2026-07-18T10:00:00Z',
        'is_read': false,
      });
      final bonus = AppNotification.fromJson({
        'id': 'notification-bonus',
        'title': 'Начислены бонусы',
        'body': 'Баланс Bulka пополнен',
        'type': 'bonus',
        'payload': const <String, dynamic>{},
        'created_at': '2026-07-18T10:00:00Z',
        'is_read': false,
      });

      expect(ready.titleFor('kk'), 'Тапсырыс дайын');
      expect(ready.bodyFor('kk'), '№100016 тапсырыс алып кетуге дайын.');
      expect(ready.titleFor('en'), 'Order is ready');
      expect(ready.bodyFor('en'), 'Order #100016 is ready for pickup.');
      expect(bonus.titleFor('kk'), 'Бонустар қосылды');
      expect(bonus.bodyFor('en'), 'Your Bulka balance was updated');
    },
  );

  test('notification payload translations override the legacy system copy', () {
    final notification = AppNotification.fromJson({
      'id': 'notification-localized',
      'title': 'Русский заголовок',
      'body': 'Русский текст',
      'type': 'broadcast',
      'payload': {
        'i18n': {
          'titles': {'ru': 'RU', 'kk': 'KK', 'en': 'EN'},
          'bodies': {'ru': 'Текст RU', 'kk': 'Мәтін KK', 'en': 'Text EN'},
        },
      },
      'created_at': '2026-07-18T10:00:00Z',
      'is_read': false,
    });

    expect(notification.titleFor('kk'), 'KK');
    expect(notification.bodyFor('en'), 'Text EN');
  });

  testWidgets('guest can open admin-managed contacts without authentication', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    SharedPreferences.setMockInitialValues({'app_lang_code': 'ru'});
    await AppLang.init();
    final client = MockClient((request) async {
      expect(request.url.path, '/api/public/contact-center');
      return http.Response(
        jsonEncode({
          'success': true,
          'cards': [cardJson, compactCardJson],
        }),
        200,
        headers: {'content-type': 'application/json'},
      );
    });

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: NotificationsScreen(api: BulkaApiClient(client: client)),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Войдите, чтобы увидеть уведомления'), findsOneWidget);
    final notificationsTab = tester.getRect(
      find.byKey(const ValueKey('notification-tab-notifications')),
    );
    final contactsTab = tester.getRect(
      find.byKey(const ValueKey('notification-tab-contacts')),
    );
    expect(contactsTab.left - notificationsTab.right, greaterThanOrEqualTo(10));
    await tester.tap(find.text('Контакты'));
    await tester.pumpAndSettle();

    expect(find.text('Булка'), findsOneWidget);
    expect(find.text('+77000000000'), findsOneWidget);
    expect(find.text('Дополнительно'), findsOneWidget);
    expect(find.text('Instagram'), findsOneWidget);
    expect(find.text('WhatsApp'), findsOneWidget);
    expect(find.text('Telegram'), findsOneWidget);
    final instagramTile = tester.getRect(
      find.byKey(const ValueKey('compact-contact-tile-action-instagram')),
    );
    final whatsappTile = tester.getRect(
      find.byKey(const ValueKey('compact-contact-tile-action-whatsapp')),
    );
    final telegramTile = tester.getRect(
      find.byKey(const ValueKey('compact-contact-tile-action-telegram')),
    );
    expect(instagramTile.height, 108);
    expect(instagramTile.width, lessThan(120));
    expect(whatsappTile.top, instagramTile.top);
    expect(telegramTile.top, instagramTile.top);
    final standardPhoneIcon = tester.widget<Container>(
      find.byKey(const ValueKey('contact-action-icon-action-1')),
    );
    final compactInstagramIcon = tester.widget<Container>(
      find.byKey(const ValueKey('contact-action-icon-action-instagram')),
    );
    expect(standardPhoneIcon.constraints?.minWidth, 42);
    expect(standardPhoneIcon.constraints?.minHeight, 42);
    expect(compactInstagramIcon.constraints, standardPhoneIcon.constraints);
    final standardIconDecoration =
        standardPhoneIcon.decoration! as BoxDecoration;
    final compactIconDecoration =
        compactInstagramIcon.decoration! as BoxDecoration;
    expect(compactIconDecoration.color, standardIconDecoration.color);
    expect(
      compactIconDecoration.borderRadius,
      standardIconDecoration.borderRadius,
    );
    expect(
      find.image(const AssetImage('assets/brand/bulka_logo.png')),
      findsOneWidget,
    );
    expect(
      find.image(const AssetImage('assets/brand/app_icon_foreground.png')),
      findsNothing,
    );
    final additionalHeading = tester.widget<Text>(find.text('Дополнительно'));
    expect(additionalHeading.style?.fontSize, BulkaTypeScale.title);
    expect(
      find.byKey(const ValueKey('contact-social-icon-instagram')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('contact-social-icon-whatsapp')),
      findsOneWidget,
    );
  });

  testWidgets(
    'long notification center title keeps the catalog typography without truncation',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      SharedPreferences.setMockInitialValues({'app_lang_code': 'kk'});
      await AppLang.init();
      final client = MockClient(
        (_) async => http.Response(
          jsonEncode({
            'success': true,
            'cards': [cardJson, compactCardJson],
          }),
          200,
          headers: {'content-type': 'application/json'},
        ),
      );

      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(2)),
            child: child!,
          ),
          home: NotificationsScreen(api: BulkaApiClient(client: client)),
        ),
      );
      await tester.pumpAndSettle();

      final titleHost = find.byKey(const ValueKey('notification-center-title'));
      final titleFinder = find.descendant(
        of: titleHost,
        matching: find.text('Хабарламалар орталығы'),
      );
      final title = tester.widget<Text>(titleFinder);

      expect(title.style?.fontFamily, 'GolosText');
      expect(title.style?.fontSize, BulkaTypeScale.pageTitle);
      expect(title.style?.fontWeight, FontWeight.w400);
      expect(title.maxLines, 2);
      expect(title.softWrap, isTrue);
      expect(title.overflow, TextOverflow.ellipsis);
      expect(
        find.descendant(of: titleHost, matching: find.byType(FittedBox)),
        findsNothing,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('mark all notifications updates before the server responds', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({'app_lang_code': 'ru'});
    await AppLang.init();
    final response = Completer<http.Response>();
    var markAllStarted = false;
    final client = MockClient((request) async {
      if (request.url.path == '/api/public/contact-center') {
        return http.Response(
          jsonEncode({'success': true, 'cards': const []}),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      if (request.url.path == '/api/customer/notifications') {
        return http.Response(
          jsonEncode({
            'success': true,
            'notifications': [
              {
                'id': 'notification-1',
                'title': 'Заказ готов',
                'body': 'Можно забирать',
                'createdAt': '2026-08-03T12:00:00Z',
                'isRead': false,
              },
            ],
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      if (request.url.path == '/api/customer/notifications/read-all') {
        markAllStarted = true;
        return response.future;
      }
      return http.Response('{}', 404);
    });
    final api = BulkaApiClient(client: client)
      ..setSession(accessToken: 'access-token', refreshToken: 'refresh-token');

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: NotificationsScreen(api: api),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Прочитать все'), findsOneWidget);

    await tester.tap(find.text('Прочитать все'));
    await tester.pump();

    expect(markAllStarted, isTrue);
    expect(find.text('Прочитать все'), findsNothing);

    response.complete(
      http.Response(
        '{"success":true}',
        200,
        headers: {'content-type': 'application/json'},
      ),
    );
    await tester.pumpAndSettle();
    api.dispose();
  });
}
